# CLAUDE.md

A learning project. Jay is building the multi-agent health insurance policy assistant from
`docs/multi-agent-insurance-assistant-guide.md` to learn LangGraph: Part B (the design: data,
retrieval, schemas, prompts, evaluation) and Part C (building it with LangChain + LangGraph).
**Jay does not want the by-hand approach** (writing the orchestration yourself with NestJS,
BullMQ, Redis); it was removed from this copy of the guide, so never steer back to it. The
untrimmed original is `~/Downloads/multi-agent-insurance-assistant-guide.md`. Jay is new to
multi-agent LLM systems; the day job is NestJS + TypeORM + MSSQL, so pgvector, embeddings, Zod
and LangGraph are all new.

## How to work with Jay

- Teach while building. One roadmap step at a time (see `README.md`). For each step: write the
  code, explain what each piece does and why, and have Jay run the commands. No end-of-step
  quiz questions or exercises: Jay asked to skip them (2026-10-29).
- Jay likes to see a step working before moving to the next; don't run ahead several steps.
- Install each package in the step that first needs it, not all up front, so it's clear what
  each one is for. Check the current version with `npm view` before installing.
- The Gemini API key lives only in `.env` (git-ignored). Never ask Jay to paste it into chat;
  check it's set with `grep -qE '^GOOGLE_API_KEY=.+' .env` without printing it.
- Commit only when Jay asks.
- The repo is public (github.com/JayPatel78/insurance-assistant) so interns can learn from it.
  After each piece (each "next"), add a page to `lessons/`, numbered in build order
  (`09-recall-check.md`, …), and a row to `lessons/README.md`. Follow the existing pages'
  layout: what we built and why, new ideas, packages and methods, our code, run it with
  expected output, check yourself. Write for a reader who wasn't in the conversation, and fix
  the previous page's "Next" link. Don't put Jay's own questions in the pages; if an answer
  explains something the page needs, fold it in as plain explanation.

## Stack and conventions

- TypeScript run directly with `tsx`; `tsc --noEmit` (TypeScript 7) only type-checks.
  ESM (`"type": "module"`), relative imports keep the `.ts` extension, top-level `await` is fine.
- No NestJS, no HTTP layer yet (maybe at the end, for streaming over SSE).
- `src/config.ts` loads `.env` with Node's built-in `process.loadEnvFile()`; values are getters
  so a script only fails on the env vars it actually uses.
- Database access: `pg` with raw SQL, one shared `Pool` in `src/db/pool.ts`. The LangGraph
  Postgres checkpointer (step 6) also uses `pg` and should reuse that pool.
- Migrations: plain SQL files in `sql/`, each safe to re-run (`IF NOT EXISTS`); `npm run db:migrate`.
- LLM and embeddings: Gemini through `@langchain/google-genai`. Model names change often; check
  the current fast and strong tiers instead of trusting the guide's `gemini-2.5-*`.

## Environment gotchas (Jay's Mac)

- The project database is Docker `pgvector/pgvector:pg16` on **port 5434**
  (`npm run db:up`, `db:psql`, `db:reset`). Port 5433 is taken by Jay's EDB Postgres 16
  install (`/Library/PostgreSQL/16`, no pgvector), so never point the app there.
- If Docker Desktop won't start: on 2026-10-27 its disk image location pointed at a missing
  external drive (`/Volumes/ /DockerData/...`; backend log said "creating disk folder ...
  permission denied"). Fix was killing the hung `com.docker.backend` and relaunching Docker.
- Node is 23.7 (out of support, works); suggest moving to 22 or 24 LTS at some point.
- Jay's Gemini key is on the **free tier**: embeddings are limited to 100 requests per minute
  and every text in a batch counts as one (a full ingest is 65). LangChain's `embedDocuments`
  hides the 429 and returns empty vectors; `embedQuery` throws the real error.

## Where things stand

- **Done:** steps 0, 1 and 2. Step 2 in short:  - `src/ingestion/`: `policy-file.ts` (front-matter header + SHA-256 of the whole file),
    `chunk.ts` (one chunk per `#`/`##`/`###` section; the heading path goes at the top of
    `content` and in `metadata.section`; `RecursiveCharacterTextSplitter` 1000/150 only for
    long sections), `ingest.ts` (`npm run ingest [-- --force]`: skips unchanged hashes, embeds
    before `BEGIN`, one transaction per policy), `preview.ts`, and the PDF path `pdf-text.ts` +
    `try-pdf.ts` (`unpdf` 1.9.1, since 2.x needs Node 24; `restoreHeadings` turns numbered lines
    back into headings; `policies/pdf/` is a sample and is not ingested).
  - `src/llm/embeddings.ts`: `gemini-embedding-001` at 768 dims, separate `RETRIEVAL_DOCUMENT`
    and `RETRIEVAL_QUERY` embedders, `checkSize` catches the wrapper's silent empty vectors.
  - `src/retrieval/`: `findPolicyInForce(plan, country, dateOfTreatment)` returns one document or
    null (throws if versions overlap); `search.ts` has `vectorSearch`, `keywordSearch` and
    `hybridSearch` (RRF, k = 60, 40 candidates per list, merged in TypeScript, not in SQL).
  - `src/eval/`: `npm run eval:recall`, recall@3 = 96% vector and hybrid, 29% keyword, on 17
    labelled questions. The only miss: Silver's whole question as one query misses
    `6. Waiting periods` (it needs 4 sections, more than K): that's the `expand` node's job,
    solved since by the intent-anchored expander.
- **Step 3 (graph) done as lessons 11–13**, and **phases 1–7 of `docs/frontend-plan.md`**
  (REST + SSE endpoints, React chat, the rule-based question-understanding layer with the
  optional additive `history` field).
- **Phase 8 = guide step 4 done** (record: `.agents/plans/plan.md`): the researcher,
  auditor and synthesizer are real Gemini calls with structured output; `classify` and
  `expand` keep the rule layer. Quote verification, computed confidence, marker checks and
  deterministic fallbacks keep answers grounded. Free tier is the constraint (roughly 20
  requests per day per flash model, 5 per minute) — switch variants with `CHAT_MODEL`.
- One deliberate change from the guide: chunks don't carry `plan_code`/`jurisdiction`.
  Retrieval first resolves the ONE document in force for plan + country + date, then searches
  only that document's chunks by `document_id`, so an expired version can't leak into answers.
- The policies' traps (expired version, Silver waiting period, Essential's override, Platinum's
  prompt injection, US spelling) are listed in `README.md` under "Test data".
- Demos pin the date with an explicit `treatmentDate` when expectations must never change
  (the classifier otherwise sets today by default).

## Next: seeing and guarding the graph, then guide steps 5–7

1. Seeing the graph: draw it as Mermaid, `recursionLimit`, supersteps.
2. Step 5: parallel retrieval with `Send` (the expansion currently loops sequentially).
3. Step 6: checkpoints, crash recovery, time travel (reuse the shared `pg` pool).
4. Step 7: human review with `interrupt()` — the node is the placeholder `humanReview`.
