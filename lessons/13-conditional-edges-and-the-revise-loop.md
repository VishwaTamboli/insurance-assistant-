# 13. Conditional edges and the revise loop

> **Roadmap step 3, piece 3** · Files: [`src/graph/graph.ts`](../src/graph/graph.ts),
> [`src/graph/edges/`](../src/graph/edges/), [`src/graph/nodes/`](../src/graph/nodes/),
> [`src/graph/state.ts`](../src/graph/state.ts) · Run: `npm run try:graph`

## What we built and why

The graph now has the whole shape of the guide's flow (B.2): every agent, the early exit, the
revise loop and the hand-off to a person.

```
START → classify ──(out of scope)──▶ END
           │
           ▼
        expand → retrieve → research → auditDraft ──(pass)─────────────────▶ synthesize → END
                               ▲          │                                       ▲
                               └─(revise)─┤                                       │
                                          └─(reject, or 2 revisions spent)─▶ humanReview
```

The new agents are fakes with fixed rules. Their rules are simple, but they take the same input and
return the same output as the real ones in step 4. `humanReview` is a placeholder until step 7. The
parallel `retrieve` comes in step 5.

## New ideas

### Conditional edge

A fixed edge always goes to the same node. A **conditional edge** runs a small function on the state,
and the function returns the name of the next node:

```ts
.addConditionalEdges('classify', afterClassify, ['expand', END])
```

| Function (in `edges/`) | Runs after | Returns |
|---|---|---|
| `afterClassify` | `classify` | `END` if the question is out of scope, otherwise `'expand'` |
| `afterAudit` | `auditDraft` | `'synthesize'` on pass; `'research'` on revise, if fewer than 2 revisions so far; otherwise `'humanReview'` |

The list at the end names every node the function may return. `compile()` checks those nodes exist. A
typo such as `'synthesise'` stops it with ``Found edge ending at unknown node `synthesise` ``. Page 14
draws the graph from these lists.

A routing function only **chooses**: it returns a node name and doesn't change the state.

### A loop is an edge back

`auditDraft → research` points backwards, so the graph can run `research` again. Nothing else is
needed: LangGraph just follows the edges.

The auditor's feedback travels through the state. `auditDraft` writes `audit.issues` (which claims are
wrong and why), and on its next run `research` reads them and fixes those claims.

### The `revisions` counter

```ts
revisions: Annotation<number>({ reducer: (current, update) => current + update, default: () => 0 }),
```

`research` returns `revisions: 1` when it runs after an audit (a revision), and `0` for the first
draft. The reducer adds that to the running total, so the node only says "one more" and never has to
read the count first.

`afterAudit` stops the loop: after 2 revisions, a draft that still fails goes to a person. Without that
check, an auditor that's never satisfied would send the draft back forever. Page 14 shows LangGraph's
own backstop for that, `recursionLimit`.

### `audit: null`

`research` also returns `audit: null`. The old verdict was about the previous draft, so it's cleared
while the new draft waits for its audit. That's why the field's type is `Audit | null`.

### A node can't share a name with a state field

The guide (C.6) calls the auditor node `audit`, and the state field it writes is also `audit`. LangGraph
refuses that when the graph is built:

```
Error: audit is already being used as a state attribute (a.k.a. a channel), cannot also be used as a node name.
```

So the node is `auditDraft`, and the field keeps the guide's name, `audit`.

### What the fakes do

| Node | Fixed rule |
|---|---|
| `research` | one claim per evidence chunk; the quote is the chunk's first sentence, or, for a claim the auditor flagged, the whole first paragraph. The claim's text is the quote itself |
| `auditDraft` | no claims → **reject**; a quote that stops before the end of its paragraph → **revise** (the rest of the paragraph may hold a condition, such as "An excess of €150 applies to each claim for treatment abroad"); otherwise **pass** |
| `humanReview` | changes nothing yet |
| `synthesize` | after a pass: the claims as a numbered list. Otherwise: "I couldn't confirm this from your policy…" |

## Packages

No new package.

| Package method | What it does |
|---|---|
| `.addConditionalEdges(from, fn, targets)` | after `from`, run `fn(state)` and go to the node it returns; `targets` lists the nodes it may return |
| `END` as a target | a routing function can end the run early |

## Our code

| Part | What it does |
|---|---|
| `state.ts` | the types `Claim`, `Draft`, `Audit`, `Final`, and the fields `draft`, `audit`, `revisions` (with its reducer) and `final` |
| `nodes/research.ts` | fake researcher; returns `draft`, `audit: null` and `revisions` (1 for a revision, else 0) |
| `nodes/audit-draft.ts` | fake auditor: reject / revise / pass by the rules above |
| `nodes/human-review.ts` | placeholder for step 7 |
| `nodes/synthesize.ts` | fake synthesizer; returns `final` |
| `nodes/chunk-text.ts` | `firstParagraph` and `firstSentence`, the fakes' way of picking a quote out of a chunk |
| `edges/after-classify.ts`, `edges/after-audit.ts` | the two routing functions; `MAX_REVISIONS = 2` |
| `edges/route.ts` | `route()`: prints which way an edge went (`↳ afterAudit → research …`) and returns the node name |
| `graph.ts` | all the nodes and edges |
| `try-graph.ts` | three runs, one for each path: the loop, the early exit, the hand-off to a person |

## Run it

```bash
npm run try:graph
```

**Expected:** only the first run calls Gemini (three query embeddings).

```
=== Gold FR member, the main question: the revise loop runs once ===
→ classify  returns {"intent":{"topic":"coverage","outOfScope":false},"treatmentDate":"2026-10-27"}
  ↳ afterClassify → expand (coverage)
→ expand    returns {"queries":["emergency surgery abroad","emergency admission notification","waiting period for an emergency"]}
→ retrieve  searches Gold Health Plan (France) 2026.1
    "emergency surgery abroad"           3.1 | 8. | 3.2
    "emergency admission notification"   4. | 7. | 10.
    "waiting period for an emergency"    7. | 4. | 3.1
            returns 9 chunks
→ research  returns a draft of 6 claims (3.1, 8., 3.2, 4., 7., 10.), first sentences only; revisions +0
→ auditDraft returns revise (confidence 0.5), claims 0, 3, 4, 5: the quote stops mid-paragraph
  ↳ afterAudit → research (revise, revisions so far: 0)
→ research  returns a draft of 6 claims (3.1, 8., 3.2, 4., 7., 10.), quoting whole paragraphs for claims 0, 3, 4, 5; revisions +1
→ auditDraft returns pass (confidence 0.9)
  ↳ afterAudit → synthesize (pass, revisions so far: 1)
→ synthesize returns an answer with 6 citations

revisions: 1, confidence: 0.9
  [1] If you have an emergency while temporarily travelling in the territorial area outside Franc…
  [2] We do not pay for:
  [3] Emergency treatment in the rest of the world, excluding the United States of America, is co…
  [4] All planned in-patient admissions and all planned surgery need pre-authorisation. Ask for i…
  [5] There is no waiting period for accidents or emergencies. Planned surgery has a waiting peri…
  [6] This document describes your cover. It is not a guarantee of payment for any particular tre…

=== Medical advice: out of scope, stops after classify ===
→ classify  returns {"intent":{"topic":"medical advice","outOfScope":true},"treatmentDate":"2026-10-27"}
  ↳ afterClassify → END (out of scope: medical advice)
No answer: the app shows a polite refusal.

=== A plan we hold no policy for: audit rejects, a person reviews ===
→ classify  returns {"intent":{"topic":"coverage","outOfScope":false},"treatmentDate":"2026-10-27"}
  ↳ afterClassify → expand (coverage)
→ expand    returns {"queries":["emergency surgery abroad","emergency admission notification","waiting period for an emergency"]}
→ retrieve  no BRONZE FR policy in force on 2026-10-27
→ research  returns a draft of 0 claims, no evidence to quote; revisions +0
→ auditDraft returns reject (confidence 0)
  ↳ afterAudit → humanReview (reject, revisions so far: 0)
→ humanReview returns nothing yet (step 7 pauses here for a person; audit was "reject")
→ synthesize returns an answer saying the policy couldn't confirm it

revisions: 0, confidence: 0
  I couldn't confirm this from your policy. A member of our team will look at your question.
```

### What to notice

1. **The loop ran once.** `research` ran twice, and `revisions` went from 0 to 1 because the reducer
   added the second run's `1`. The script cuts the answer lines at 96 characters. In full, claim [1]
   now ends with "An excess of €150 applies to each claim for treatment abroad.": the condition the
   first draft left out.
2. **The revision changed only the flagged claims** (0, 3, 4, 5). Claims 1 and 2 were already whole
   paragraphs. `research` knew which ones to fix only from `audit.issues` in the state.
3. **The out-of-scope run stops after `classify`.** `expand`, `retrieve` and the other agents never
   run, so there's no Gemini call and no cost.
4. **The run with no policy makes no Gemini call either.** `retrieve` stops at the policy lookup, the
   empty draft is rejected, and the run goes through `humanReview` to `synthesize`.
5. **The 2-revision limit isn't reached here**, because the fake auditor is satisfied after one
   revision. Page 14 uses an auditor that's never satisfied.

## Check yourself

<details>
<summary>If the auditor said "revise" every time, how many times would <code>research</code> run, and where would the run go next?</summary>

Three times: the first draft, then 2 revisions. After the third audit, `revisions` is 2, so `afterAudit`
sends the draft to `humanReview`.
</details>

<details>
<summary>Why does <code>research</code> return <code>revisions: 1</code> and not <code>state.revisions + 1</code>?</summary>

The reducer adds the update to the current value. Returning `state.revisions + 1` would count twice:
the second revision would return 2, and the total would become 1 + 2 = 3.
</details>

<details>
<summary>Why is the auditor node called <code>auditDraft</code> and not <code>audit</code>?</summary>

The state already has a field called `audit`, and LangGraph won't let a node have the same name as a
state field.
</details>

---

[← Reducers and a real retrieve node](12-reducers-and-retrieve.md) · [Index](README.md)
