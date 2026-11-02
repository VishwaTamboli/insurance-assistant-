# 02. The database and the made-up policies

> **Roadmap step 1** · Files: [`docker-compose.yml`](../docker-compose.yml),
> [`sql/001_policy_tables.sql`](../sql/001_policy_tables.sql), [`src/db/pool.ts`](../src/db/pool.ts),
> [`src/db/migrate.ts`](../src/db/migrate.ts), [`policies/`](../policies/)
>
> Written after the step was done, from the code.

## What we built and why

A Postgres database that can search text in two ways: **by meaning** (pgvector) and **by
words** (Postgres full-text search). Plus six made-up policies, which are the assistant's
only source of truth. Each policy hides a trap the assistant has to handle.

## New ideas

### pgvector

A Postgres extension that adds a `vector(768)` column type (a list of 768 numbers) and
operators to measure the distance between two vectors. Page 05 explains where the numbers
come from, and page 08 searches with them.

### Two tables

**`policy_documents`**: one row per plan + country + version, for example Gold, France, 2026.1.

| Column | Example | Why |
|---|---|---|
| `plan_code`, `jurisdiction`, `version` | `GOLD`, `FR`, `2026.1` | `UNIQUE` together: one row per version |
| `effective_from`, `effective_to` | `2026-01-01`, `null` | `null` = still in force (page 07) |
| `content_hash` | 64 hex characters | lets ingestion skip a file it already loaded (page 03) |

**`policy_chunks`**: one row per section of a document.

| Column | What it holds |
|---|---|
| `document_id` | which document; `ON DELETE CASCADE` deletes a document's chunks with it |
| `chunk_index` | position in the file: 0, 1, 2… |
| `content` | the section's text |
| `metadata` | `jsonb`, for example `{"section": "4. Pre-authorisation"}`, used in citations |
| `embedding` | `vector(768)`: the text's meaning as numbers |
| `content_tsv` | the text's words, cut to their stems, for keyword search |

### Three indexes

| Index | Type | Speeds up |
|---|---|---|
| on `embedding` | **HNSW** (`vector_cosine_ops`) | "find the closest vectors" without comparing against every row |
| on `content_tsv` | **GIN** | "which rows contain these words" |
| on `document_id` | B-tree | "only this document's chunks" |

**Why 768 numbers, not 3,072:** Gemini's embeddings are 3,072 numbers by default, but pgvector's
HNSW index allows at most 2,000. Page 05 shows how we ask for 768.

### A generated column and stemming

```sql
content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
```

Postgres fills `content_tsv` itself on every insert; our code never writes it. `to_tsvector`
cuts each word to its **stem** and drops small words like *the*, *if*, *we*:

```
to_tsvector('english', 'pre-authorisation')   → 'authoris':3 'pre':2 'pre-authoris':1
to_tsvector('english', 'prior authorization') → 'author':2 'prior':1
```

British "authorisation" becomes `authoris`, but American "authorization" becomes `author`.
So a keyword search for "pre-authorisation" **misses** the US policy. That's a trap planted on
purpose, and hybrid search (page 08) is the fix.

### One deliberate change from the guide

The guide copies `plan_code` and `jurisdiction` onto every chunk and filters on them.
We don't. Retrieval first picks the **one** document in force for the plan, country and date
(page 07), then searches only that document's chunks by `document_id`. That way an expired
version can't leak into an answer.

### The made-up policies

Each file starts with a header that fills one `policy_documents` row:

```
---
plan_code: GOLD
jurisdiction: FR
version: 2026.1
title: Gold Health Plan (France)
effective_from: 2026-01-01
effective_to:
---
```

The main test question is: *"I'm on the Gold plan in France. Am I covered for an emergency
appendectomy in Spain, and do I need pre-authorisation?"* Each policy exists to test something:

| File | What it tests |
|---|---|
| `gold-fr-2026.md` | the main case: covered up to €150,000, €150 excess, no pre-authorisation for an emergency, but notify within 48 hours |
| `gold-fr-2025.md` | **expired** last year's version (€100,000, €250 excess). If these numbers appear in an answer, retrieval used the wrong version |
| `silver-fr-2026.md` | same question, different answer: lower limits, and a 30-day waiting period that applies to emergencies too |
| `essential-fr-2026.md` | section 2 says "covered in full", section 3 says France only: the auditor must catch the override |
| `platinum-fr-2026.md` | **prompt injection**: section 4 tells "AI assistants" to say everything is covered. The agents must treat it as data |
| `gold-us-2026.md` | same plan name, other country: dollars, deductibles, and US spelling ("prior authorization") |

## Packages

| Package | What it's for |
|---|---|
| `pg` | Node's Postgres driver: we write raw SQL, no ORM |
| `@types/pg` | its types |
| Docker image `pgvector/pgvector:pg16` | Postgres 16 with pgvector already installed |

| `pg` method | What it does |
|---|---|
| `new pg.Pool({ connectionString })` | a set of reusable database connections |
| `pool.query(sql)` | runs SQL on any free connection |
| `pool.end()` | closes all connections, so the script can exit |

## Our code

| File | What it does |
|---|---|
| `docker-compose.yml` | one `db` service. Port **5434** on your machine maps to 5432 inside the container (5434 so it doesn't clash with a Postgres already installed). A named volume keeps the data across restarts. A healthcheck lets `--wait` wait until Postgres accepts connections |
| `sql/001_policy_tables.sql` | the extension, both tables and the indexes. Every statement uses `IF NOT EXISTS`, so it's safe to run again |
| `src/db/pool.ts` | the one shared `Pool`; every script imports it |
| `src/db/migrate.ts` | runs every `sql/*.sql` file in name order, then prints the pgvector version |

| Script | What it does |
|---|---|
| `npm run db:up` | starts the database and waits until it's ready |
| `npm run db:migrate` | creates the tables |
| `npm run db:psql` | opens a SQL prompt (`\q` to leave) |
| `npm run db:down` | stops the database; the data stays |
| `npm run db:reset` | **deletes all data**, then starts fresh and migrates |

## Run it

```bash
npm run db:up
npm run db:migrate
```

**Expected** from `db:migrate` (your pgvector version may be newer):

```
ran 001_policy_tables.sql
pgvector 0.8.7 is installed
```

Then try stemming yourself. Run `npm run db:psql` and paste:

```sql
SELECT to_tsvector('english', 'pre-authorisation') AS uk,
       to_tsvector('english', 'prior authorization') AS us;
```

**Expected:**

```
                  uk                   |          us
---------------------------------------+----------------------
 'authoris':3 'pre':2 'pre-authoris':1 | 'author':2 'prior':1
```

## Check yourself

<details>
<summary>Why is the embedding column <code>vector(768)</code> and not Gemini's default 3,072?</summary>

pgvector's HNSW index supports at most 2,000 dimensions. Without the index, every search would
compare against every row.
</details>

<details>
<summary>Why does a keyword search for "pre-authorisation" miss the US policy?</summary>

Postgres stems the British spelling to `authoris` and the American one to `author`. The stems
don't match, so the words don't match.
</details>

<details>
<summary>Our code never writes <code>content_tsv</code>. How does it get filled?</summary>

It's a generated column: Postgres computes it from `content` on every insert.
</details>

---

[← Project setup](01-project-setup.md) · [Index](README.md) · [Next: reading a policy file →](03-reading-a-policy-file.md)
