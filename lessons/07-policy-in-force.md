# 07. Finding the policy in force

> **Roadmap step 2, piece 5** · Files: [`src/retrieval/policy-in-force.ts`](../src/retrieval/policy-in-force.ts),
> [`src/retrieval/try-policy-in-force.ts`](../src/retrieval/try-policy-in-force.ts) · Run: `npm run try:in-force`

## What we built and why

Before searching, pick the **one** document that applies to this plan, country and date. Gold FR has
two versions, and their section 3.1 reads almost word for word the same:

| Gold FR §3.1 | 2025.1 (expired) | 2026.1 (in force) |
|---|---|---|
| Limit | €100,000 | €150,000 |
| Excess | €250 | €150 |
| Longest trip | 60 days | 90 days |

If we searched both versions, the two 3.1 chunks would get nearly the same vector and rank side by
side. The Researcher could quote the wrong one, and nothing would look wrong. So we pick the document
first and search only its chunks.

## New ideas

**In force** means: `effective_from <= date` and (`effective_to` is empty or `>= date`).

The date is the **date of treatment**, which isn't always today. A claim for treatment in June 2025
must use the 2025 wording.

## Packages

None new: plain `pg` and SQL.

| Bit | What it does |
|---|---|
| `pool.query<PolicyDocument>(sql, values)` | `<PolicyDocument>` tells TypeScript the shape of each row (TypeScript only; `pg` doesn't check it) |
| `plan_code AS "planCode"` | renames the column to camelCase, so rows match our interface with no mapping code |
| `effective_from::text` | keeps the date as `"2026-01-01"`; without it `pg` returns a JS `Date` at local midnight, which can shift the day |

## Our code

| Part | What it does |
|---|---|
| `findPolicyInForce(plan, country, date)` | returns the one document in force, or `null` if there's none |
| the `rows.length > 1` check | throws if two versions are in force on the same day: overlapping dates in the files are a data mistake, so it stops instead of guessing |
| `try-policy-in-force.ts` | runs 5 cases and prints which document each gets |

**Where it fits later:** the `retrieve` node calls `findPolicyInForce` once, then searches only that
document's chunks (page 08). If the result is `null`, the assistant should say "no policy found"
rather than guess.

## Run it

```bash
npm run try:in-force
```

Reads the database only; no Gemini call. **Expected:**

```
GOLD FR, 2026-10-27      → Gold Health Plan (France), version 2026.1      (today)
GOLD FR, 2025-06-15      → Gold Health Plan (France), version 2025.1      (a claim for treatment last June)
GOLD US, 2026-10-27      → Gold PPO Plan (United States), version 2026.1  (same plan name, other country)
SILVER FR, 2025-06-15    → none                                           (Silver starts on 2026-01-01)
PLATINUM DE, 2026-10-27  → none                                           (no German policies at all)
```

- The same plan on two dates gives two different versions.
- The same plan name in another country gives a different document.
- `none` is a real answer, and the assistant has to handle it.

## The query, line by line

The call `findPolicyInForce('GOLD', 'FR', '2026-10-27')` fills `$1 = 'GOLD'`, `$2 = 'FR'`, `$3 = '2026-10-27'`:

```sql
SELECT id, plan_code AS "planCode", jurisdiction, version, title,
       effective_from::text AS "effectiveFrom",
       effective_to::text   AS "effectiveTo"
FROM policy_documents
WHERE plan_code = $1                                   -- 'GOLD'
  AND jurisdiction = $2                                -- 'FR'
  AND effective_from <= $3                             -- started on or before 2026-10-27
  AND (effective_to IS NULL OR effective_to >= $3)     -- hasn't ended, or ends on/after 2026-10-27
```

| Part | What it does |
|---|---|
| `plan_code AS "planCode"` | the quotes matter: Postgres lowercases unquoted names, so `AS planCode` would come back as `plancode` |
| `plan_code = $1 AND jurisdiction = $2` | keeps only Gold in France |
| `effective_from <= $3` | the policy had already started on that date |
| `effective_to IS NULL OR effective_to >= $3` | it hasn't ended: no end date, or the end date is on or after that date |

Which rows survive for `GOLD`, `FR`, `2026-10-27`:

| Document | GOLD? | FR? | started? | not ended? | Kept |
|---|---|---|---|---|---|
| Gold FR 2025.1 (2025-01-01 → 2025-12-31) | ✓ | ✓ | ✓ | ✗ ended 2025-12-31 | no |
| **Gold FR 2026.1** (2026-01-01 → empty) | ✓ | ✓ | ✓ | ✓ no end date | **yes** |
| Gold US 2026.1 | ✓ | ✗ | | | no |

For `2025-06-15` the result flips: 2025.1 is kept (it ran from 2025-01-01 to 2025-12-31), and 2026.1
is dropped (it hadn't started yet).

Three details worth knowing:

1. **`IS NULL`, not `= NULL`.** In SQL, `NULL = anything` is "unknown", never true, so
   `effective_to = NULL` would match nothing. MSSQL works the same way.
2. **The parentheses around the `OR` are essential.** `AND` is evaluated before `OR`. Without them,
   Postgres reads `(GOLD AND FR AND started AND effective_to IS NULL) OR (effective_to >= $3)`, and the
   right-hand side ignores plan and country. Then `findPolicyInForce('SILVER', 'FR', '2025-06-15')`
   would return **Gold FR 2025.1**.
3. **No `LIMIT 1`, on purpose.** We fetch every match, so the code can see when there are two and
   throw instead of quietly picking one.

The boundaries are inclusive (`<=`, `>=`): on 2025-12-31 version 2025.1 applies, and on 2026-01-01
version 2026.1 applies, with no gap.

## How a `try:` script runs

`npm run try:in-force` passes no parameters on the command line: they're inside the script file.

1. **`npm run try:in-force`** looks up `"try:in-force": "tsx src/retrieval/try-policy-in-force.ts"` in
   `package.json` and runs it. It's only a shortcut.
2. **`tsx` runs the file from top to bottom**, like a script. There's no `main()` and no framework
   calling your code.
3. **The file holds the parameters and makes the calls:**

```ts
const cases = [
  { plan: 'GOLD', country: 'FR', date: '2026-10-27', why: 'today' },   // ← the parameters
  …
];

for (const { plan, country, date, why } of cases) {
  const policy = await findPolicyInForce(plan, country, date);         // ← the call
  …
}

await pool.end();   // close connections, or Node keeps running for about 10 more seconds
```

Unlike NestJS, where the framework calls your controller method, here the script file **is** the
caller, like a seed script. To pass values from the command line instead, read `process.argv`:
`preview.ts` does that with `npm run ingest:preview -- gold-fr-2026`.

## Check yourself

<details>
<summary>What does <code>findPolicyInForce('GOLD', 'FR', '2025-12-31')</code> return? And <code>'2026-01-01'</code>?</summary>

Version 2025.1 on 2025-12-31 (its last day, because `>=` is inclusive), and version 2026.1 on
2026-01-01 (its first day).
</details>

<details>
<summary>Why not add <code>LIMIT 1</code> to the query?</summary>

It would hide a data mistake. If two versions' dates overlap, we want an error, not a random pick.
</details>

---

[← The ingest script](06-ingest.md) · [Index](README.md) · [Next: vector, keyword and hybrid search →](08-hybrid-search.md)
