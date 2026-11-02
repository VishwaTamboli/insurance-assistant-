# 04. Chunking

> **Roadmap step 2, piece 2** · File: [`src/ingestion/chunk.ts`](../src/ingestion/chunk.ts)
> · Run: `npm run ingest:preview -- gold-fr-2026`

## What we built and why

A **chunk** is one piece of a policy. Each chunk becomes one row in `policy_chunks`, gets its own
embedding, and is the unit the agents read and cite. We cut each policy into **one chunk per
section**, with the section's heading path at the top.

How big should a piece be?

- **The whole policy is too big.** An embedding squeezes a text's meaning into one point. Gold FR
  2026 covers hospitals, maternity, exclusions and travel, so as one point it means roughly
  "a health policy". It would match every question equally badly.
- **One sentence is too small.** *"An excess of €150 applies to each claim for treatment abroad"*
  on its own no longer says that it belongs to emergencies inside the EU (section 3.1).
- **One section is about right.** The policy's authors already grouped related rules under
  headings, so we cut where they did.

## New ideas

### The chunk-boundary problem

The guide's basic splitter cuts every 1,000 characters, with no idea where headings are.
On Gold FR 2026 it cuts like this:

| Blind piece | Contains |
|---|---|
| 2 | 3.2, 3.3, 3.4, and the **first half** of §4 Pre-authorisation ("planned surgery needs pre-authorisation…") |
| 3 | the **second half** of §4 ("Emergency admissions do not need pre-authorisation… notify within 48 hours"), then §5 and §6 |

The rule our Spain question depends on ends up in a piece whose headings are Out-patient and
Maternity. The `## 4. Pre-authorisation` heading is in a different piece. Cutting by section avoids that.

### The heading path goes into the chunk text

Gold FR 2026, section 3.4, as a chunk:

```
3. Treatment abroad > 3.4 Medical repatriation

If our medical team decides it is medically necessary, we organise and pay for your
transport back to a hospital in France, without limit.
```

The body never says "repatriation" and never says "abroad". Without the heading line, a keyword
search for "repatriation" would miss this chunk, and its embedding would look like "transport
to a French hospital", not "something that happens abroad".

### The fallback splitter

A section longer than 1,000 characters is cut again by LangChain's `RecursiveCharacterTextSplitter`.
"Recursive" means it tries to cut at blank lines first, then at line breaks, then at spaces.
Neighbouring pieces share up to 150 characters ("overlap"), so a sentence cut at a boundary is
still whole somewhere.

**None of our sections is that long** (the longest, Gold FR 2026's Definitions, is 674 characters),
so with our policies it never cuts. It's there for PDFs: extracted PDF text has no `##` markers, so the whole policy
becomes one "section" and the splitter does the cutting.

## Packages

| Package | What it's for |
|---|---|
| `@langchain/textsplitters` | LangChain's ready-made text cutters |
| `@langchain/core` | the base every LangChain package plugs into. It's a **peer dependency**: installed once and shared, so the Gemini package and LangGraph use the same copy |

| Package method | What it does |
|---|---|
| `new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 150 })` | creates a cutter: pieces of at most 1,000 characters, neighbours sharing up to 150 |
| `.splitText(text)` | returns an array of pieces; text of 1,000 characters or less comes back as one piece |

## Our code

| Function | What it does |
|---|---|
| `splitIntoSections(body)` | walks the policy line by line and returns one `{ headings, text }` per heading |
| `chunkPolicy(body)` | returns the chunks: `{ content, metadata: { section } }`, with the heading path at the top of `content` |
| `preview.ts gold-fr-2026` | also prints every chunk of that file in full |

Lines worth a closer look in `splitIntoSections`:

- `line.match(/^(#{1,3}) (.+)$/)` spots heading lines: `## 4. Pre-authorisation` gives `['##', '4. Pre-authorisation']`.
- This line decides the heading path. A `###` keeps its `##` parent; a `#` or `##` starts fresh:
  ```ts
  headings = heading[1] === '###' ? [headings[0], heading[2]] : [heading[2]];
  ```
  So 3.4 gets `['3. Treatment abroad', '3.4 Medical repatriation']`.
- A heading with no text of its own is skipped. In Gold FR 2026, `## 3. Treatment abroad` is
  followed straight by `### 3.1`. Its title still appears in every 3.x heading path. That's why the
  file has 15 headings but makes **14 chunks**.

`metadata: { section }` keeps the same path as a separate field, so the Synthesizer can later
cite "Gold Health Plan (France), 3.4 Medical repatriation" without parsing the text.

## Run it

```bash
npm run ingest:preview -- gold-fr-2026
```

The `--` tells npm to pass `gold-fr-2026` on to our script instead of reading it itself.

**Expected:** the six lines from page 03 (65 chunks in total), with Gold FR 2026's 14 chunks
printed in full under its line. Check these:

- `chunk 0 (193 chars)` is the title and the "made-up policy" note.
- `chunk 1 (690 chars)` is `1. Definitions`, the longest.
- `chunk 3 (462 chars)` starts with `3. Treatment abroad > 3.1 Emergency treatment in the territorial area`
  and contains €150,000, the €150 excess and 90 days.
- `chunk 7 (487 chars)` is `4. Pre-authorisation`, with **both** halves (planned and emergency) together.
- There's no chunk that is just `3. Treatment abroad`.

## One chunk, end to end

One chunk is one section of one policy: a short text plus a label saying where
it came from. Chunk 3 of `gold-fr-2026.md`:

```ts
{
  content: `3. Treatment abroad > 3.1 Emergency treatment in the territorial area

If you have an emergency while temporarily travelling in the territorial area outside France,
we pay for emergency in-patient and out-patient treatment, including emergency surgery, up to
€150,000 per policy year. An excess of €150 applies to each claim for treatment abroad.

Cover applies to trips of up to 90 consecutive days. Treatment needed on day 91 or later of a
trip is not covered.`,
  metadata: { section: '3. Treatment abroad > 3.1 Emergency treatment in the territorial area' },
}
```

After ingestion (page 06) it becomes one row of `policy_chunks`:

| Column | Value for this chunk |
|---|---|
| `id` | a new UUID |
| `document_id` | the id of the Gold FR 2026 row |
| `chunk_index` | `3`: 0 is the title, 1 is Definitions, 2 is Hospital benefits, 3 is this one |
| `content` | the text above |
| `metadata` | `{"section": "3. Treatment abroad > 3.1 Emergency treatment in the territorial area"}` |
| `embedding` | 768 numbers from Gemini |
| `content_tsv` | filled in by Postgres: the words cut to their stems |

Everything works with chunks: search returns chunks, the Researcher quotes a sentence from one,
and a citation points at one ("Gold Health Plan (France), 3.1").

## Check yourself

<details>
<summary>Why does Gold FR 2026 have 15 headings but only 14 chunks?</summary>

`## 3. Treatment abroad` has no text of its own (it's followed straight by `### 3.1`), so it makes
no chunk. Its title lives on in the heading paths of 3.1 to 3.4.
</details>

<details>
<summary>Why put the heading path in <code>content</code>, not only in <code>metadata</code>?</summary>

Both searches read `content`. Section 3.4 never says "repatriation" in its body; only its heading
does. Without the heading in `content`, neither search could match it on that word.
</details>

---

[← Reading a policy file](03-reading-a-policy-file.md) · [Index](README.md) · [Next: embeddings →](05-embeddings.md)
