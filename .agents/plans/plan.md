# Master plan — Insurance Policy Assistant

Working plan across all build phases. Each phase keeps its predecessor's contracts and
behavior intact unless a phase explicitly changes them. Validation always runs before a
phase is reported done.

## Ground rules (all phases)

- The LangGraph shape (`classify → expand → retrieve → research ⇄ audit → synthesize`,
  plus the human-review route) is the backbone; phases change node *bodies*, not graph
  topology, unless a phase states otherwise.
- REST/SSE contracts are additive-only; old clients keep working unchanged.
- Never invent policy content: coverage, exclusions and missing information are only ever
  reported from audited evidence; "the policy doesn't say" is the answer for gaps.
- No new dependencies unless a phase needs them; the DB schema is frozen at
  `policy_documents` + `policy_chunks` (pgvector, port 5434 Docker).
- Testing palette: coverage questions, exclusions, waiting periods, list/short/summary
  formats, follow-ups with `history`, multi-policy comparisons, missing information,
  unsupported questions, citation correctness and hallucination checks.

## Phase log

### Phases 1–6 — API and frontend (backend REST + SSE then Vite/React chat)

Delivered earlier behind `docs/frontend-plan.md`: `node:http` server on :8080,
`POST /api/ask` + `POST /api/ask/stream` (SSE stages, policy card, revise loop visible),
React 19 chat with streaming, progress UI and the three outcome banners. The graph,
ingestion and retrieval logic untouched. Validated with `test:integration`,
`api:check` and the frontend `check:stream`.

### Phase 7 — Question understanding & response formatting

Pure rule layer `src/graph/understanding.ts` (14 intent aspects, 10 response formats,
follow-up resolution over the optional additive `history` field). `classify`/`expand`
consumed it; `retrieve` gained comparison searches over in-force policies;
`research` ranked claims by best retrieval score; `synthesize` rendered the audited
claims into the requested format, reporting missing policy info as missing. 45 unit tests
plus the full API/frontend check suites. The LLM placeholder nodes were left for a later
phase deliberately.

### Phase 8 — LLM-powered question understanding, research and synthesis (current)

Goal: replace the fake LLM placeholders with real Gemini nodes with structured output,
while preserving Phase 7's rule understanding, formats, citations, audit loop and
refusals.

Design decisions:

1. `classify` and `expand` KEEP the rule layer: intent detection and response formatting
   are preserved as Phase 7 built them (deterministic, free, unit-testable); the LLM
   upgrade targets research/audit/synthesis only.
2. One chat model for the three nodes (`src/llm/chat.ts`), `CHAT_MODEL` overridable by
   env, default `gemini-3.8-flash`. The guide's fast/strong tier split is documented but
   the key's free tier serves only flash-family models (pro models 404 or quota-capped).
3. `research` gets one structured-output call (`DraftSchema` from guide B.4) and then
   code-verifies every quote (`quote-check.ts`, guide B.6): unquotable claims are dropped.
   If the model drafts nothing while evidence exists, the node degrades deterministically
   to quoting the top-ranked chunks verbatim.
4. `auditDraft` rejects empty drafts without a model call (the no-policy and unsupported
   paths stay free and instant); otherwise one structured-output audit, merged with the
   code-level quote check, a forced `revise` when a "pass" carries high-severity issues,
   and B.6's computed confidence `min(model, 0.95, solid share)`.
5. `synthesize` writes the final answer from the passed claims only, in the Phase 7
   format; the text is verified (markers exist, in print order, in range; shape-critical
   formats count their lines) and renumbered so `[n]` always matches the citations array;
   on check failure the same claims render through the Phase-7 renderer (render.ts).
6. LLM nodes retry with backoff sized for the free tier (5 RPM: 8s → 16s → 30s waits).
7. Missing-information questions keep the deterministic gap statement; the LLM never
   phrases policy silence as an exclusion.

Status: implementation complete; see the phase report for the validation matrix.

## Known external constraint

Gemini free tier on this key: ~20 requests/day per model bucket, 5 requests/minute, and
separate buckets per flash variant. Full validation matrices can outrun a single bucket;
`CHAT_MODEL` (env) switches variants, `SCENARIOS` (env, scenario-check) re-runs the
remaining numbered scenarios after a top-up.
