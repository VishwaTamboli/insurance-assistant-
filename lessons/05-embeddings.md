# 05. Embeddings

> **Roadmap step 2, piece 3** · Files: [`src/llm/embeddings.ts`](../src/llm/embeddings.ts),
> [`src/llm/try-embeddings.ts`](../src/llm/try-embeddings.ts) · Run: `npm run try:embeddings`
> · First Gemini call

## What we built and why

The code that turns text into **embeddings**, plus a demo that does vector search by hand. In the
final assistant, this is how the retriever finds "4. Pre-authorisation" when a US member types
"prior authorization": keyword search can't, because the stems differ (`authoris` vs `author`).

## New ideas

### Embedding

A list of numbers (768 in our case) that places a text on a **map of meaning**. Texts that mean
similar things land close together, even when they share no words.

Think of GPS coordinates, but with 768 of them instead of 2. No single number means anything you
could name; only the position as a whole means something.

### Cosine similarity

To compare two texts, measure the **angle** between their vectors: 1 means they point the same way
(same meaning), 0 means unrelated. pgvector's `<=>` operator (page 08) returns 1 minus this,
the "cosine distance".

### 768, not 3,072

Gemini returns 3,072 numbers by default, but pgvector's HNSW index allows at most 2,000. Gemini was
trained so the **first** numbers carry the most meaning ("Matryoshka" training, after the nesting
dolls), so asking for 768 gives a shorter version of the same map, not a different map.

Changing the model or the size means embedding every chunk again: vectors from different models
live on different maps, and comparing them is meaningless.

### Task types

A question and the passage that answers it look different:

- "Do I need prior authorization?"
- "All planned in-patient admissions … need pre-authorisation."

Gemini was trained to place a `RETRIEVAL_QUERY` near the `RETRIEVAL_DOCUMENT`s that answer it, so
chunks and questions are each embedded with their own task type.

## Packages

| Package | What it's for |
|---|---|
| `@langchain/google-genai` | LangChain's connector to Google Gemini: embeddings now, chat models in step 4 |

| Package method | What it does |
|---|---|
| `new GoogleGenerativeAIEmbeddings({ apiKey, model, taskType, outputDimensionality })` | creates an embedder for one job (chunk or query) and one size (768) |
| `.embedDocuments(texts)` | returns one vector per text, sending up to 100 texts per request |
| `.embedQuery(text)` | returns one vector for one text |

## Our code

| Part | What it does |
|---|---|
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | `gemini-embedding-001` at 768; must match `vector(768)` in the SQL |
| `chunkEmbedder` / `queryEmbedder` | two embedders: one with `RETRIEVAL_DOCUMENT`, one with `RETRIEVAL_QUERY` (the wrapper fixes the task type per object) |
| `embedChunks(texts)` | embeds chunks, then checks each vector's size |
| `embedQuery(text)` | embeds one search text, then checks its size |
| `checkSize(vector)` | throws if a vector isn't 768 numbers (see the trap below) |
| `cosineSimilarity(a, b)` in `try-embeddings.ts` | how close two vectors are; it divides by both lengths because at 768 dimensions Gemini's vectors aren't length 1 |
| `try-embeddings.ts` | embeds Gold FR 2026's 14 chunks and 3 questions, then prints the 5 closest chunks for each |

**The `TaskType` line.** The wrapper types `taskType` with an enum from Google's older SDK and
doesn't re-export it, so a plain `'RETRIEVAL_DOCUMENT'` string fails the type check. This borrows
the type from the wrapper's own options instead:

```ts
type TaskType = NonNullable<GoogleGenerativeAIEmbeddingsParams['taskType']>;
```

**The trap `checkSize` guards against.** In the wrapper's source
(`node_modules/@langchain/google-genai/dist/embeddings.js`), a failed batch request (for example a
rate limit) **doesn't throw**: it returns an empty vector for every text in the batch. Without our
check you'd only find out at insert time, from a confusing pgvector error. Lesson: when a library's
behaviour matters, read its source. Page 06 shows this trap firing for real.

## Run it

```bash
npm run try:embeddings
```

Four Gemini requests, about 1,500 tokens. **Expected** (running it twice gives identical numbers):

```
Embedded 14 chunks. Each is 768 numbers: [-0.0049, 0.0313, 0.0002, -0.0699, …]

"Am I covered for surgery in Spain?" (top 5 of 14)
  0.712  8. Exclusions
  0.703  2. Hospital benefits in France
  0.688  3. Treatment abroad > 3.1 Emergency treatment in the territorial area
  0.688  3. Treatment abroad > 3.2 Emergency treatment outside the territorial area
  0.684  3. Treatment abroad > 3.3 Planned treatment abroad

"emergency surgery abroad" (top 5 of 14)
  0.726  3. Treatment abroad > 3.1 Emergency treatment in the territorial area
  0.697  8. Exclusions
  0.695  3. Treatment abroad > 3.2 Emergency treatment outside the territorial area
  0.693  4. Pre-authorisation
  0.676  2. Hospital benefits in France

"Do I need prior authorization?" (top 5 of 14)
  0.691  4. Pre-authorisation
  0.661  1. Definitions
  0.635  3. Treatment abroad > 3.3 Planned treatment abroad
  0.614  7. Waiting periods
  0.610  10. Important information
```

### What to notice

1. **"prior authorization" finds "4. Pre-authorisation" first.** Not one word matches exactly
   (prior/pre, z/s); meaning still wins.
2. **The member's own question ranks the right chunk (3.1) only third.** "Exclusions" wins because
   it's full of "surgery", "treatment" and "covered". Embeddings match wording and topic; they don't
   reason "Spain is in the EU, and the EU is the territorial area".
3. **Reworded in the policy's own terms, 3.1 comes first.** That's why the graph has an `expand` node
   before `retrieve`, which rewrites the question into several search queries. Working out that Spain
   counts is the LLM agents' job.
4. **Every score is between about 0.6 and 0.73**, because every chunk is about health insurance. Only
   the order counts, so never write a rule like "similarity above 0.7 means relevant".

## Chunk embeddings vs query embeddings

A query embedding is the search text turned into 768 numbers, made the same way as a chunk's
embedding but at question time. It's **stored nowhere**: it lives in memory for one search and is thrown away.

```
INGESTION: once per policy               SEARCH: every time someone searches
chunk text                               "emergency surgery abroad"
   │ embedChunks()                          │ embedQuery()
   ▼                                        ▼
768 numbers ── STORED in                 768 numbers ── kept in memory only
               policy_chunks.embedding                  │
                       ▲                                 │
                       └──── pgvector compares them ─────┘
                             (the closest chunks win)
```

| | Chunk embedding | Query embedding |
|---|---|---|
| Made from | a chunk's `content` | a search text |
| Task type | `RETRIEVAL_DOCUMENT` | `RETRIEVAL_QUERY` |
| Made when | once, by the ingest script | for every search |
| Stored? | yes, in `policy_chunks.embedding` | no |

Later, the `expand` node turns one question into 3–5 search queries, and `retrieve` embeds and
searches each one. The graph's state keeps the query **texts** and the **chunks found**, never the
query vectors. The query must use the same model and size as the chunks, or the two sit on
different maps.

### One text = one string

Whatever its length, each string in gives back exactly one vector of 768 numbers.

| Call | One text is… | Example |
|---|---|---|
| `embedDocuments(texts)` | one chunk's `content` | chunk 3: 462 characters |
| `embedQuery(text)` | one search query | `"emergency surgery abroad"`, 24 characters |

- **Length doesn't change the vector's size.** A longer text gets its meaning squeezed into the same
  768 numbers. That's why a whole policy as one text would blur, and one section stays sharp.
- **There's a maximum:** about 2,048 tokens (roughly 8,000 characters) per text. Our biggest chunk is 690.
- **"Up to 100 texts per request"** is about network calls: 14 chunks fit in 1 request; 250 chunks
  would take 3 requests (100 + 100 + 50) and still give 250 vectors.

## Check yourself

<details>
<summary>Why are there two embedder objects, not one?</summary>

Chunks and queries use different task types (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`), and the
wrapper fixes the task type per object.
</details>

<details>
<summary>A batch request fails. What does the wrapper return, and what stops us storing it?</summary>

An empty vector (`[]`) for every text in that batch, with no error. `checkSize` sees 0 numbers instead
of 768 and throws.
</details>

<details>
<summary>Is a similarity of 0.70 "relevant"?</summary>

You can't tell from the number. All our chunks score between about 0.6 and 0.73; only the ranking
means something.
</details>

---

[← Chunking](04-chunking.md) · [Index](README.md) · [Next: the ingest script →](06-ingest.md)
