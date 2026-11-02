# 12. Reducers and a real retrieve node

> **Roadmap step 3, piece 2** · Files: [`src/graph/state.ts`](../src/graph/state.ts),
> [`src/graph/nodes/retrieve.ts`](../src/graph/nodes/retrieve.ts), [`src/graph/graph.ts`](../src/graph/graph.ts),
> [`src/graph/try-graph.ts`](../src/graph/try-graph.ts) · Run: `npm run try:graph`

## What we built and why

The graph now searches the policy. A third node, `retrieve`, runs after `expand`:

```
START → classify → expand → retrieve → END
```

`retrieve` is **real**, not fake: it needs no LLM, only the search from step 2. It finds the policy in
force, runs the hybrid search once for each of `expand`'s queries, and writes the chunks it finds into a
new state field, `evidence`. In step 4 the researcher reads `evidence` to write its answer.

`evidence` is the first field with a **reducer**, because chunks should add up instead of replacing
each other.

## New ideas

### Reducer

A rule for merging an update into a field: `reducer(current value, update) => new value`.

| Field | Rule | A node returns | Stored |
|---|---|---|---|
| `queries` (no reducer) | the update replaces the value | `['a', 'b']` | `['a', 'b']`, whatever was there before |
| `evidence` (reducer) | `dedupeById([...current, ...update])` | 9 chunks | what was there **plus** the 9, each chunk once |

`default: () => []` gives the value before any node has written to the field, so the first merge has a
`current` to add to.

Page 11 showed where the merge happens: after each node, LangGraph calls `channel.update(...)` for each
field it returned. For a field with a reducer, that's a `BinaryOperatorAggregate` channel, which calls
our reducer instead of replacing the value.

### Our run, through the reducer

`retrieve` asks for the top 3 chunks of each query:

| Query | Top 3 sections |
|---|---|
| "emergency surgery abroad" | 3.1, 8., 3.2 |
| "emergency admission notification" | 4., 7., 10. |
| "waiting period for an emergency" | 7., 4., 3.1 |

It returns all 9. The reducer gets `current = []` (the default) and `update` = those 9, and stores 6:
3.1, 4. and 7. were found twice, and only their first copy is kept.

### Why the reducer removes the repeats, not `retrieve`

Today `retrieve` loops over the queries itself, so it could remove the repeats. In step 5 the loop goes
away: LangGraph runs **one `retrieve` per query, in parallel**, and each returns only its own 3 chunks in
the same step. None of them sees the others' chunks; only the reducer gets all of them.

Without a reducer, that same step fails. A field with no reducer is a `LastValue` channel, and it throws
`LastValue can only receive one value per step` (in `dist/channels/last_value.js`) because it can't
choose which branch's value to keep.

### A node can be anything

`retrieve` is `async`, queries Postgres and calls Gemini (to embed each query for the vector search).
LangGraph awaits it like any other node. A node is just "state in, update out"; the graph doesn't care
whether it's a fake, an LLM call or SQL.

### Where `retrieve`'s inputs come from

| Input | Comes from |
|---|---|
| `planCode`, `jurisdiction` | the `invoke` input: the member's account |
| `treatmentDate` | `classify` |
| `queries` | `expand` |

It calls `findPolicyInForce(planCode, jurisdiction, treatmentDate)` (page 07) and searches only that
document's chunks. If no version is in force on that date, it returns no evidence.

## Packages

No new package.

| Package method | What it does |
|---|---|
| `Annotation<T>({ reducer, default })` | a field of type `T` whose updates are merged with `reducer`, starting from `default()` |

## Our code

| Part | What it does |
|---|---|
| `state.ts` | adds `evidence` (search hits, with the reducer) and `dedupeById`, which keeps the first copy of each chunk id |
| `nodes/retrieve.ts` | `retrieve`: finds the policy in force, runs `hybridSearch` with each query (top 3), prints what each query found, returns all the hits |
| `graph.ts` | adds the `retrieve` node and the edges `expand → retrieve → END` |
| `try-graph.ts` | prints the final state with `evidence` shortened to one section per line, then closes the database pool |

## Run it

The database must be running (`npm run db:up`) and hold the policies from `npm run ingest`.

```bash
npm run try:graph
```

**Expected:**

```
→ classify  returns {"intent":{"topic":"coverage","outOfScope":false},"treatmentDate":"2026-10-27"}
→ expand    returns {"queries":["emergency surgery abroad","emergency admission notification","waiting period for an emergency"]}
→ retrieve  searches Gold Health Plan (France) 2026.1
    "emergency surgery abroad"           3.1 | 8. | 3.2
    "emergency admission notification"   4. | 7. | 10.
    "waiting period for an emergency"    7. | 4. | 3.1
            returns 9 chunks

Final state:
{
  question: 'Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?',
  planCode: 'GOLD',
  jurisdiction: 'FR',
  intent: { topic: 'coverage', outOfScope: false },
  treatmentDate: '2026-10-27',
  queries: [
    'emergency surgery abroad',
    'emergency admission notification',
    'waiting period for an emergency'
  ]
}
evidence: 6 chunks
  3. Treatment abroad > 3.1 Emergency treatment in the territorial area
  8. Exclusions
  3. Treatment abroad > 3.2 Emergency treatment outside the territorial area
  4. Pre-authorisation
  7. Waiting periods
  10. Important information
```

### What to notice

1. **9 returned, 6 stored.** `retrieve` returned the repeats; the reducer dropped them.
2. **The order is the order of arrival**: the first query's chunks first, and each chunk where it was
   first found.
3. **`1. Definitions` is missing**, yet it's where the policy says acute appendicitis counts as an
   emergency. The fake `expand` always sends the same three queries, and none asks for it. The real
   expander in step 4 writes queries from the question; the recall check (page 09) will measure whether
   they find it.

## Check yourself

<details>
<summary>Why does <code>evidence</code> need <code>default: () => []</code>?</summary>

The reducer adds the update to the current value. Before any node has written to the field there is no
current value, so `default()` provides the empty list to start from.
</details>

<details>
<summary>If <code>retrieve</code> ran twice, returning the same 9 chunks each time, how many would <code>evidence</code> hold?</summary>

Still 6. The second run's chunks are added to the 6 already there, and `dedupeById` drops every one of
them as a repeat.
</details>

<details>
<summary>Why is dedupe in the reducer rather than in <code>retrieve</code>?</summary>

From step 5, each query gets its own `retrieve` running in parallel. No single branch sees all the
chunks; the reducer does.
</details>

---

[← The first graph](11-first-graph.md) · [Index](README.md) · [Next: conditional edges and the revise loop →](13-conditional-edges-and-the-revise-loop.md)
