# 09. The recall check

> **Roadmap step 2, piece 7** · Files: [`src/eval/retrieval-questions.ts`](../src/eval/retrieval-questions.ts),
> [`src/eval/recall.ts`](../src/eval/recall.ts) · Run: `npm run eval:recall`

## What we built and why

A small test that puts a number on retrieval quality. Each question is labelled with the section(s)
an expert would need to answer it, and the script counts how many of those land in each search's
top 3. The guide's rule: **measure retrieval before building agents**. If the right chunk never
reaches the Researcher, no prompt can fix it.

This number is also a safety net. When you later change the chunking, the embedding model or the
search, run it again: if it drops, you broke something, even though no error appeared.

## New ideas

### Recall@K

Of all the chunks the questions need, the share that a search puts in its top K.

```
recall@3 = (needed chunks found in the top 3) / (all needed chunks)
```

The question "treatment in the USA" on Gold FR needs two sections: `3.2` (no US cover abroad) and
`8. Exclusions`. If a search returns both in its top 3, that's 2 of 2. If it returns only one, 1 of 2.

### Why K = 3, not the guide's 10

Our policies have only 9–14 chunks each. A top 10 is nearly the whole policy, so every search would
score about 100% and the test would tell us nothing. A top 3 is closer to what the Researcher will
actually read for one query.

### Label by section, not by chunk id

Every re-ingest deletes and re-inserts the chunks, so their UUIDs change. The section path
(`4. Pre-authorisation`) stays the same, so the labels keep working.

### Write labels from the policy, not from the results

Read the policy, decide what an expert would need, write that down, and only then run. Labels
copied from search results always score 100% and prove nothing.

## Packages

None new. It reuses `findPolicyInForce` (page 07) and the three searches (page 08).

| JS piece | What it does |
|---|---|
| `hits.findIndex((hit) => hit.section === section)` | position of the first chunk from that section, or `-1` if the search didn't return it |
| `Object.keys(searches) as SearchName[]` | loops over `vector`, `keyword`, `hybrid` with their names typed |

## Our code

| Part | What it does |
|---|---|
| `retrieval-questions.ts` | 17 labelled questions: plan, country, date, query, expected sections, and what each one tests |
| `recall.ts` main loop | for each question: find the policy in force, run all three searches (40 results each), find the rank of each expected section, count those ranked 1–3 |
| `rankOf(hits, section)` | the section's rank (1, 2, 3…), or `null` if it wasn't returned |
| `percent(found)` | formats the total as `96% (23/24)` |

The questions cover the traps from page 02:

| Questions | What they test |
|---|---|
| Gold FR: "having a baby", "flown home…", "must I tell you…" | paraphrases: no word in common with the heading |
| Gold FR: "day 91 of a trip" | an exact number |
| Gold FR, date 2025-06-15 | the expired version is picked by the date of treatment |
| Silver: "waiting period for an emergency", "is appendicitis an accident" | the waiting-period trap |
| Essential: "emergency surgery abroad" | the override trap: needs section 2 **and** section 3 |
| Platinum: "approval before planned surgery" | the section that contains the prompt injection |
| Gold US: "pre-authorisation" | UK spelling against a US policy |
| Gold FR and Silver: the member's whole question | what happens with no `expand` node |

## Run it

```bash
npm run eval:recall
```

34 small Gemini calls (2 per question), well under the free tier's 100 per minute. **Expected:**

```
                                                      vector        keyword       hybrid
GOLD FR 2026.1      "emergency surgery abroad"        1/1 (1)       1/1 (1)       1/1 (1)
GOLD FR 2026.1      "day 91 of a trip"                1/1 (1)       1/1 (1)       1/1 (1)
GOLD FR 2026.1      "must I tell you about an emergen 1/1 (1)       0/1 (–)       1/1 (1)
GOLD FR 2026.1      "flown home to France after falli 1/1 (1)       0/1 (–)       1/1 (1)
GOLD FR 2026.1      "having a baby"                   1/1 (1)       0/1 (–)       1/1 (1)
GOLD FR 2026.1      "treatment in the USA"            2/2 (2,1)     0/2 (–,–)     2/2 (2,1)
GOLD FR 2025.1      "emergency surgery abroad"        1/1 (1)       1/1 (1)       1/1 (1)
SILVER FR 2026.1    "waiting period for an emergency" 1/1 (1)       1/1 (1)       1/1 (1)
SILVER FR 2026.1    "is appendicitis an accident"     1/1 (2)       1/1 (1)       1/1 (1)
ESSENTIAL FR 2026.1 "emergency surgery abroad"        2/2 (2,3)     0/2 (–,–)     2/2 (2,3)
ESSENTIAL FR 2026.1 "travel add-on cover"             1/1 (1)       1/1 (1)       1/1 (1)
PLATINUM FR 2026.1  "approval before planned surgery" 1/1 (1)       0/1 (–)       1/1 (1)
GOLD US 2026.1      "pre-authorisation"               1/1 (1)       0/1 (–)       1/1 (1)
GOLD US 2026.1      "emergency care abroad"           1/1 (1)       1/1 (1)       1/1 (1)
GOLD US 2026.1      "how much do I pay before the pla 1/1 (2)       0/1 (–)       1/1 (2)
GOLD FR 2026.1      "Am I covered for an emergency ap 3/3 (2,3,1)   0/3 (–,–,–)   3/3 (2,3,1)
SILVER FR 2026.1    "Am I covered for an emergency ap 3/4 (3,2,1,6) 0/4 (–,–,–,–) 3/4 (3,2,1,6)

recall@3                                              96% (23/24)   29% (7/24)    96% (23/24)
```

How to read a cell: `1/2 (2,5)` means 1 of the 2 expected sections is in the top 3; they came 2nd
and 5th. `–` means the search didn't return that section at all.

### What to notice

1. **Keyword alone: 29%.** Every paraphrase fails, because it needs every word of the query in the
   chunk. Never use it alone.
2. **Hybrid never does worse than vector, and sometimes better.** For "is appendicitis an accident",
   vector puts Definitions 2nd; keyword finds it 1st, so hybrid lifts it to 1st. When keyword finds
   nothing, hybrid is exactly vector.
3. **The ranks are an early warning.** Essential's `(2,3)` passes, but only just. If a change pushed it
   to `(2,4)`, the total would drop.
4. **The one miss is the trap.** The whole Silver question needs 4 sections, but one query only gets a
   top 3. The one left out is `6. Waiting periods` (6th): the rule that a 30-day waiting period applies
   to emergencies too. The short query "waiting period for an emergency" finds it 1st. That's the job
   of the `expand` node (step 4): turn one question into several focused queries, then `retrieve` once
   per query.
5. **96% is above the guide's 85% target, but the test is small and friendly.** We wrote the
   questions and the policies ourselves. A real evaluation uses 30–50 questions from real members.

## Check yourself

<details>
<summary>Why label questions with section paths, not chunk ids?</summary>

Re-ingesting creates new chunk UUIDs. Section paths stay the same, so the labels keep working.
</details>

<details>
<summary>Why would recall@10 be useless here?</summary>

Each policy has only 9–14 chunks, so a top 10 contains nearly everything, and every search would
score close to 100%.
</details>

<details>
<summary>The whole Silver question misses <code>6. Waiting periods</code>. Would a better embedding model fix it?</summary>

Not reliably: the question needs four sections and a top 3 holds three. The fix is several focused
queries (the `expand` node), each with its own top 3.
</details>

---

[← Vector, keyword and hybrid search](08-hybrid-search.md) · [Index](README.md) · [Next: the PDF path →](10-pdf-path.md)
