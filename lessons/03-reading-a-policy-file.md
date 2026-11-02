# 03. Reading a policy file

> **Roadmap step 2, piece 1** · Files: [`src/ingestion/policy-file.ts`](../src/ingestion/policy-file.ts),
> [`src/ingestion/preview.ts`](../src/ingestion/preview.ts) · Run: `npm run ingest:preview`

## What step 2 builds

Each agent in the final graph can only answer from the text retrieval hands it. If the right
paragraph never reaches the Researcher, it can't cite it, and the Auditor can't notice it's
missing. As the guide puts it: *if retrieval is bad, no agent can fix it.* So step 2 builds
retrieval and measures it before any LLM writes an answer.

**Ingestion** runs once per policy file, before anyone asks anything:

```
gold-fr-2026.md → header + text → chunks (one per section) → embeddings → rows in Postgres
```

**Search** runs for every question. Later it becomes the `retrieve` node in the graph:

```
GOLD + FR + date → the ONE document in force → best chunks by meaning (vectors)
                                             → best chunks by exact words (full-text)
                                             → merged into one list (RRF)
```

## What we built in this piece, and why

The first step of ingestion: split a policy file into its **header** (plan, country, dates),
which fills one `policy_documents` row, and its **body**, which page 04 cuts into chunks.
Then fingerprint the file, so an unchanged file can be skipped next time.

## New ideas

### Front-matter

Metadata written at the top of a Markdown file between two `---` lines (see page 02). We read it
with a small regular expression:

```
^---\n([\s\S]*?)\n---\n
```

- `^---\n`: the file must start with a `---` line.
- `([\s\S]*?)`: capture everything, line breaks included. The `?` makes it stop at the **first**
  closing `---`. Without it, a `---` divider further down the policy text would pull half the
  policy into the header.

Each header line is cut at its **first** colon, so `title: Gold: Family Edition` would still work.
No YAML library: our header is flat `key: value` lines, and ten readable lines beat a dependency.

### The content hash

SHA-256 turns any text into a 64-character fingerprint. For `gold-fr-2026.md` it starts `a1be5bdeda50…`.

- The same bytes always give the same fingerprint.
- Changing one character gives a completely different one.

Ingestion costs time and money (one embedding per chunk). So the ingest script (page 06) compares
each file's hash with the one stored in the database and skips unchanged files. Running it
twice does the work only once; that property is called **idempotent**.

We hash the **whole file, header included**, on purpose. When someone later sets
`effective_to: 2026-12-31` on Gold 2026, the policy text hasn't changed but the header has,
and the database needs to know.

### Dates stay strings

Postgres reads `'2026-01-01'` straight into a `date` column. In JavaScript,
`new Date('2026-01-01')` means midnight UTC, which is still 31 December in New York, so a
date can quietly move by a day. Keeping dates as strings avoids that.

## Packages

None. Node's built-in modules are enough.

| Built-in method | What it does |
|---|---|
| `readdir(dir)` | lists the file names in a folder |
| `readFile(path, 'utf8')` | reads a file as text |
| `createHash('sha256').update(text).digest('hex')` | turns text into a 64-character fingerprint |

## Our code

| Function | What it does |
|---|---|
| `listPolicyFiles()` | returns the full path of every `.md` file in `policies/`, sorted |
| `readPolicyFile(path)` | returns `{ header, body, contentHash }` for one file |
| `splitHeader()` | cuts the `--- … ---` block off the top and turns its `key: value` lines into an object |
| `required(key)` | throws `…/silver-fr-2026.md: header is missing "plan_code"` if a field is missing, instead of a confusing Postgres error later |
| `preview.ts` | a dry run: prints one line per policy file, with no Gemini call and no database |

`PolicyHeader.effectiveTo` is `string | null`. In `gold-fr-2025.md` it's `2025-12-31`; in the
other five files it's empty, which becomes `null`: "still in force". That one field is what keeps
last year's €100,000 limit out of answers (page 07).

## Run it

```bash
npm run ingest:preview
```

**Expected** (the chunk counts at the end come from page 04):

```
essential-fr-2026.md   ESSENTIAL FR 2026.1  2026-01-01 → still in force    hash 6aad05a56b12…  10 chunks
gold-fr-2025.md        GOLD FR 2025.1       2025-01-01 → 2025-12-31        hash 1319b21c097d…  11 chunks
gold-fr-2026.md        GOLD FR 2026.1       2026-01-01 → still in force    hash a1be5bdeda50…  14 chunks
gold-us-2026.md        GOLD US 2026.1       2026-01-01 → still in force    hash a00581421193…  10 chunks
platinum-fr-2026.md    PLATINUM FR 2026.1   2026-01-01 → still in force    hash 67925205e7b1…  9 chunks
silver-fr-2026.md      SILVER FR 2026.1     2026-01-01 → still in force    hash d0d747431457…  11 chunks
```

Check two things:
- Only `gold-fr-2025` has an end date.
- The hash prefixes match. They come from the file bytes, so a mismatch means a file has changed.

## Check yourself

<details>
<summary>You fix a typo in <code>silver-fr-2026.md</code> and run ingestion. Which files get embedded again?</summary>

Only Silver. Its hash changed; the other five hashes are already in the database, so they're skipped.
</details>

<details>
<summary>Why hash the header too, not just the policy text?</summary>

A header change, such as adding an end date, must reach the database even when the text is
unchanged. Hashing only the body would skip that file.
</details>

---

[← The database and the made-up policies](02-database-and-policies.md) · [Index](README.md) · [Next: chunking →](04-chunking.md)
