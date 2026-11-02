# 06. The ingest script

> **Roadmap step 2, piece 4** · File: [`src/ingestion/ingest.ts`](../src/ingestion/ingest.ts)
> · Run: `npm run ingest`

## What we built and why

The script that runs pages 03–05 in a row and saves the result: **read → chunk → embed → save**.
After it runs, the database holds 6 documents and 65 chunks, ready to search. Two ideas make it
safe to run again and again:

- **Transaction:** each policy is saved all-or-nothing, so a half-loaded policy can never exist.
- **Idempotent:** an unchanged file (same hash) is skipped, so a second run costs nothing.

## New ideas

### Transaction

`BEGIN`, then several statements, then `COMMIT` saves them all at once. If anything fails, `ROLLBACK`
undoes everything since `BEGIN`. A transaction has to stay on **one** connection, which is why we
borrow one from the pool with `pool.connect()` instead of using `pool.query()`.

### Embed before `BEGIN`

The Gemini call can take seconds or fail. A transaction shouldn't sit open waiting on the network,
so we embed first. If Gemini fails, nothing has been written yet.

### Replace, don't duplicate

`DELETE` the old copy of the same plan + country + version, then `INSERT`. A changed file (or
`--force`) replaces its old rows instead of crashing on the `UNIQUE` constraint, and
`ON DELETE CASCADE` removes the old chunks too.

## Packages

None new. `pg` (page 02) does it all.

| `pg` method | What it does |
|---|---|
| `pool.query(sql, [values])` | runs one statement on any free connection |
| `pool.connect()` | borrows one connection that stays yours until you release it |
| `client.query('BEGIN' / 'COMMIT' / 'ROLLBACK')` | starts, saves or undoes a transaction |
| `client.release()` | gives the connection back to the pool |
| `pool.end()` | closes all connections so the script can exit |
| `$1, $2…` | placeholders: values travel separately from the SQL, so there's no quoting to get wrong and no SQL injection |

If you know TypeORM: `dataSource.transaction(...)` does the same `BEGIN` / `COMMIT` / `ROLLBACK` for you.

## Our code

| Part | What it does |
|---|---|
| main loop | for each file: read → skip if unchanged → chunk → embed → store → print one line |
| `--force` | skips the "unchanged" check and stores every file again (for example after changing the chunking) |
| `isStored(hash)` | `SELECT 1 FROM policy_documents WHERE content_hash = $1`: true if this exact file is already loaded |
| `store(policy, chunks, vectors)` | in one transaction: delete the old copy, insert the document, insert each chunk |

Two lines worth a closer look:

1. **`RETURNING id`** makes the insert hand back the new document's UUID, which becomes each chunk's
   `document_id`.
2. **`JSON.stringify(vectors[index])`**: `pg` sends a JS array as a Postgres array, `{0.1,0.2}`, but
   pgvector wants `[0.1,0.2]`, which is exactly what `JSON.stringify` produces.

## Run it

**1. Load everything** (65 embedding texts):

```bash
npm run ingest
```

**Expected:**

```
essential-fr-2026.md: stored 10 chunks
gold-fr-2025.md: stored 11 chunks
gold-fr-2026.md: stored 14 chunks
gold-us-2026.md: stored 10 chunks
platinum-fr-2026.md: stored 9 chunks
silver-fr-2026.md: stored 11 chunks
```

**2. Run it again.** No Gemini call this time. **Expected:** six lines ending in `unchanged, skipped`.

**3. Look at the data.** Run `npm run db:psql`, then paste:

```sql
SELECT d.plan_code, d.jurisdiction, d.version, d.effective_to, count(c.id) AS chunks
FROM policy_documents d JOIN policy_chunks c ON c.document_id = d.id
GROUP BY d.id ORDER BY 1, 2, 3;
```

**Expected:**

```
 plan_code | jurisdiction | version | effective_to | chunks
-----------+--------------+---------+--------------+--------
 ESSENTIAL | FR           | 2026.1  |              |     10
 GOLD      | FR           | 2025.1  | 2025-12-31   |     11
 GOLD      | FR           | 2026.1  |              |     14
 GOLD      | US           | 2026.1  |              |     10
 PLATINUM  | FR           | 2026.1  |              |      9
 SILVER    | FR           | 2026.1  |              |     11
```

Then see what keyword search will see for the repatriation chunk:

```sql
SELECT content_tsv FROM policy_chunks
WHERE metadata->>'section' = '3. Treatment abroad > 3.4 Medical repatriation';
```

**Expected:**

```
 '3':1 '3.4':4 'abroad':3 'back':23 'decid':11 'franc':28 'hospit':26 'limit':30 'medic':5,9,14
 'necessari':15 'organis':17 'pay':19 'repatri':6 'team':10 'transport':22 'treatment':2 'without':29
```

- Every word is cut to its stem: `decides` → `decid`, `France` → `franc`.
- Small words (*if, our, we, to, a*) are dropped. The numbers are word positions.
- `'repatri':6` and `'abroad':3` come only from the **heading line** that page 04 added.

Type `\q` to leave psql.

## What broke, and how the cause was found

Testing the script in a throwaway database:

1. **Symptom.** Run 1 stored everything and run 2 skipped everything. Run 3 (`--force`) stopped at
   `gold-us-2026.md` with our own guard's error: `Got an embedding of 0 numbers instead of 768`.
2. **Follow the error message's advice.** Calling `embedQuery()` on one text (it throws, unlike the
   batch call) showed the real error: `429 Too Many Requests … Embed content requests per minute
   limit exceeded on Free Tier … limit: 100`.
3. **Check the numbers.** Run 1 sent 65 texts. Run 3 sent 10 + 11 + 14 = 35 before failing. That's
   exactly 100, so **each text counts as one request**, not each batch.
4. **Check the damage.** None: still 6 documents and 65 chunks. Gold US failed before its transaction
   began. Thanks to the transaction and the hash check, the fix is just "wait a minute and run again".

**The rule:** on the free tier, one full ingest per minute. Don't run `--force` straight after an ingest.

## Check yourself

<details>
<summary>Why call Gemini before <code>BEGIN</code>, not inside the transaction?</summary>

A transaction shouldn't stay open while waiting on the network. And if Gemini fails, nothing has
been written, so there's nothing to undo.
</details>

<details>
<summary>The script crashes halfway through inserting Silver's chunks. What's in the database for Silver?</summary>

The old Silver rows, if there were any, or nothing. `ROLLBACK` undoes the delete and the partial
inserts together, so there's never a half-loaded policy.
</details>

<details>
<summary>Why <code>JSON.stringify</code> the vector before inserting it?</summary>

`pg` would send a JS array as `{0.1,0.2}` (Postgres array syntax). pgvector expects `[0.1,0.2]`.
</details>

---

[← Embeddings](05-embeddings.md) · [Index](README.md) · [Next: finding the policy in force →](07-policy-in-force.md)
