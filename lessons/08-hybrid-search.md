# 08. Vector, keyword and hybrid search

> **Roadmap step 2, piece 6** · Files: [`src/retrieval/search.ts`](../src/retrieval/search.ts),
> [`src/retrieval/try-search.ts`](../src/retrieval/try-search.ts) · Run: `npm run try:search`

## What we built and why

Three ways to search one policy's chunks. Each of the first two fails where the other works, so
the third merges them:

- **Vector search** finds the same *meaning* in different words ("prior authorization" ≈
  "pre-authorisation"). It's weak on exact details like "day 91".
- **Keyword search** finds the *exact words*, after cutting them to stems. It fails on a different
  spelling, and it needs **every** word of the query to be present.
- **Hybrid search** runs both and merges the two lists with **RRF** (Reciprocal Rank Fusion).

Later, `findPolicyInForce` (page 07) plus `hybridSearch` is the whole `retrieve` node of the graph.

## New ideas

### Reciprocal Rank Fusion (RRF)

Each search gives every chunk points based on its position in that search's list,
**points = 1 / (60 + rank)**, and the points are added up. The highest total wins.

A real example, "day 91" on Gold FR 2026:

| Rank | Vector list (by meaning) | Keyword list (by exact words) |
|---|---|---|
| 1 | Title chunk | **3.1 Emergency treatment** |
| 2 | 6. Maternity | (only one chunk has both "day" and "91") |
| 3 | 9. Making a claim | |
| 4 | **3.1 Emergency treatment** | |
| 5 | 2. Hospital benefits | |

| Chunk | Vector points | Keyword points | Total |
|---|---|---|---|
| 3.1 Emergency | rank 4 → 1/64 = 0.0156 | rank 1 → 1/61 = 0.0164 | **0.0320** |
| Title | rank 1 → 1/61 = 0.0164 | not in list | 0.0164 |
| Maternity | rank 2 → 1/62 = 0.0161 | not in list | 0.0161 |
| Making a claim | rank 3 → 1/63 = 0.0159 | not in list | 0.0159 |
| Hospital | rank 5 → 1/65 = 0.0154 | not in list | 0.0154 |

Being found by **both** searches roughly doubles a chunk's score, so the chunks both agree on win.

### Why ranks, not scores

The vector score for 3.1 is 0.565 and its keyword score is 0.100, but they're on different scales.
Similarity here always lands between about 0.5 and 0.75; `ts_rank_cd` grows with how often the words
appear and can be 0.1 or 3. Adding them is like adding cm to kg. Ranks mean the same in both lists.

### The constant `RRF_K = 60`

Why not just 1/rank? Compare two chunks under each rule:

| | k = 0 (points = 1/rank) | k = 60 (points = 1/(60+rank)) |
|---|---|---|
| #1 in one list only | 1/1 = **1.000** | 1/61 = 0.0164 |
| #3 in both lists | 1/3 + 1/3 = 0.667 | 1/63 + 1/63 = **0.0317** |
| Who wins | first place in one list | the chunk found by both |

With k = 0, points fall fast (1, 0.5, 0.33…), so first place in one list beats everything. With 60
they fall slowly (0.0164, 0.0161, 0.0159…), so *how many lists* a chunk appears in matters more than
its exact position. 60 comes from the 2009 paper that introduced RRF; 50 or 70 would give almost the
same results.

### The constant `CANDIDATES = 40`

How many results each search hands to the merge, before cutting to the final 5. A chunk can be low
in one list and still deserve first place: 3.1 is 4th in the vector list above. If each search handed
over only its top 3, 3.1 would lose its vector points (0 + 0.0164) and merely tie with the title chunk.
Our documents have only 10–14 chunks, so 40 means "all of them"; it matters on big documents.

## Packages

None new. These are pgvector and Postgres features, used through `pg`.

| SQL / JS piece | What it does |
|---|---|
| `embedding <=> $2::vector` | pgvector's **cosine distance** (0 = same direction); `1 - distance` is the similarity from page 05 |
| `$2::vector` | turns the `'[0.1,…]'` text into a pgvector value |
| `websearch_to_tsquery('english', $2)` | turns the query into search terms like a search box does: stems words, drops small ones, and requires all the rest. `"day 91"` becomes `'day' & '91'` |
| `content_tsv @@ terms` | "does this chunk contain all the terms?" |
| `ts_rank_cd(content_tsv, terms)` | the keyword score: higher when the terms appear more often and closer together |
| `FROM policy_chunks, websearch_to_tsquery(…) AS terms` | computes the terms once and names them, so `WHERE` and `SELECT` can both use them |
| `metadata->>'section'` | reads one field of the `jsonb` column as text |
| `Promise.all([a, b])` | runs both searches at the same time |

## Our code

| Function | What it does |
|---|---|
| `vectorSearch(documentId, query, limit)` | embeds the query and returns that document's closest chunks |
| `keywordSearch(documentId, query, limit)` | returns that document's chunks that contain every word |
| `hybridSearch(documentId, query, limit)` | runs both (40 candidates each), adds up RRF points in a `Map` keyed by chunk id, sorts, keeps the top `limit` |
| `try-search.ts` | runs 4 cases and prints the top 5 of each search side by side |

The guide (B.3) does RRF in one big SQL query. We merge in TypeScript instead: same maths, easier to
read and to print. The merge, line by line:

```ts
for (const hits of [vectorHits, keywordHits]) {                // runs twice: vector list, then keyword list
  hits.forEach((hit, index) => {
    const rank = index + 1;                                    // arrays start at 0, ranks start at 1
    const entry = merged.get(hit.id) ?? { ...hit, score: 0 };  // seen this chunk before? reuse it : start at 0
    entry.score += 1 / (RRF_K + rank);                         // add this list's points
    merged.set(hit.id, entry);                                 // one entry per chunk id
  });
}
return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
```

For "day 91": the vector pass creates 14 entries; the keyword pass finds 3.1 already in the Map and
adds 0.0164 to it; then the sort puts 3.1 first.

## Run it

```bash
npm run try:search
```

8 small Gemini calls (2 per case). **Expected:**

```
Gold Health Plan (France) 2026.1: "emergency surgery abroad"
     vector (similarity)                 keyword (ts_rank_cd)                hybrid (RRF)
  1  3.1 Emergency treatment in 0.726    3.1 Emergency treatment in 0.009    3.1 Emergency treatment in 0.0328
  2  8. Exclusions              0.697                                        8. Exclusions              0.0161
  3  3.2 Emergency treatment ou 0.695                                        3.2 Emergency treatment ou 0.0159
  4  4. Pre-authorisation       0.693                                        4. Pre-authorisation       0.0156
  5  2. Hospital benefits in Fr 0.676                                        2. Hospital benefits in Fr 0.0154

Gold Health Plan (France) 2026.1: "day 91"
     vector (similarity)                 keyword (ts_rank_cd)                hybrid (RRF)
  1  Harbourline Health — Gold  0.575    3.1 Emergency treatment in 0.100    3.1 Emergency treatment in 0.0320
  2  6. Maternity               0.568                                        Harbourline Health — Gold  0.0164
  3  9. Making a claim          0.567                                        6. Maternity               0.0161
  4  3.1 Emergency treatment in 0.565                                        9. Making a claim          0.0159
  5  2. Hospital benefits in Fr 0.560                                        2. Hospital benefits in Fr 0.0154

Gold PPO Plan (United States) 2026.1: "pre-authorisation"
     vector (similarity)                 keyword (ts_rank_cd)                hybrid (RRF)
  1  5. Prior authorization     0.641    (no matches)                        5. Prior authorization     0.0164
  2  1. Definitions             0.599                                        1. Definitions             0.0161
  3  9. Important information   0.585                                        9. Important information   0.0159
  4  7. Waiting periods         0.569                                        7. Waiting periods         0.0156
  5  Harbourline Health — Gold  0.567                                        Harbourline Health — Gold  0.0154

Gold Health Plan (France) 2026.1: "Am I covered for surgery in Spain?"
     vector (similarity)                 keyword (ts_rank_cd)                hybrid (RRF)
  1  8. Exclusions              0.712    (no matches)                        8. Exclusions              0.0164
  2  2. Hospital benefits in Fr 0.703                                        2. Hospital benefits in Fr 0.0161
  3  3.1 Emergency treatment in 0.688                                        3.1 Emergency treatment in 0.0159
  4  3.2 Emergency treatment ou 0.688                                        3.2 Emergency treatment ou 0.0156
  5  3.3 Planned treatment abro 0.684                                        3.3 Planned treatment abro 0.0154
```

### What to notice, one lesson per case

1. **Both searches agree.** 3.1 is first in both lists: 1/61 + 1/61 = **0.0328**, twice anything else.
2. **"day 91": keyword rescues vector.** "91" means little to an embedding, so vector ranks 3.1 only
   4th. Keyword finds the exact words, and in RRF 3.1 wins with 0.0320. Exact numbers, codes and names
   are keyword search's strength.
3. **"pre-authorisation" on the US policy: vector rescues keyword.** The stems differ (`authoris` vs
   `author`), so keyword finds nothing. Vector still finds "Prior authorization", and hybrid keeps it first.
4. **The member's whole question.** Keyword needs *every* word and no chunk says "Spain", so it finds
   nothing and hybrid is just vector: the right chunk comes 3rd. Case 1 is the same question reworded
   the way the `expand` node will reword it, and there both searches find 3.1.

The vector scores (0.726, 0.712) match page 05's exactly: Postgres did the same maths we did by hand.

## Check yourself

<details>
<summary>For "emergency surgery abroad", 3.1 is 1st in both lists. What's its hybrid score?</summary>

1/61 + 1/61 = 0.0328, the number in the output.
</details>

<details>
<summary>Why does keyword search find nothing for "Am I covered for surgery in Spain?"</summary>

`websearch_to_tsquery` requires every word (after dropping small ones like "am", "I", "for", "in"),
and no chunk contains "Spain".
</details>

<details>
<summary>With <code>RRF_K = 0</code>, which wins: a chunk 1st in one list only, or a chunk 3rd in both?</summary>

The chunk 1st in one list: 1/1 = 1.0 beats 1/3 + 1/3 = 0.667. With 60, the chunk found by both wins.
</details>

---

[← Finding the policy in force](07-policy-in-force.md) · [Index](README.md) · [Next: the recall check →](09-recall-check.md)
