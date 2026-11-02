# Lessons

Learning notes from building this project, one page per piece, in the order it was built.
Read them top to bottom and run each command as you go: every page tells you what output
to expect, so you can compare.

The goal is to learn **LangGraph and multi-agent RAG** by building the insurance assistant
from [the guide](../docs/multi-agent-insurance-assistant-guide.md). The early pages build the
retrieval layer the agents will stand on; LangGraph itself starts at roadmap step 3.

## How each page is laid out

| Section | What's in it |
|---|---|
| What we built and why | the piece's job in the final assistant |
| New ideas | each idea explained with an example from our made-up policies |
| Packages | what each installed package is for, and what each method we call does |
| Our code | what each function does, in a line or two |
| Run it | the command, and the output you should see |
| Check yourself | short questions, with the answers hidden until you click |

## Before you start

- Follow the setup in the project [README](../README.md).
- You need Docker, Node 22 or newer, and a free Gemini API key from
  <https://aistudio.google.com/apikey>.
- The free tier is enough. Its one limit that matters here: 100 embedding texts per minute.

## Pages

| # | Page | Roadmap step | New ideas |
|---|---|---|---|
| 01 | [Project setup](01-project-setup.md) | 0 | `tsx`, ES modules, `.env` |
| 02 | [The database and the made-up policies](02-database-and-policies.md) | 1 | Docker, pgvector, HNSW and GIN indexes, stemming |
| 03 | [Reading a policy file](03-reading-a-policy-file.md) | 2, piece 1 | front-matter, content hash |
| 04 | [Chunking](04-chunking.md) | 2, piece 2 | chunks, the chunk-boundary problem |
| 05 | [Embeddings](05-embeddings.md) | 2, piece 3 | embeddings, cosine similarity, task types |
| 06 | [The ingest script](06-ingest.md) | 2, piece 4 | transactions, idempotency, rate limits |
| 07 | [Finding the policy in force](07-policy-in-force.md) | 2, piece 5 | effective dates, the expired-version trap |
| 08 | [Vector, keyword and hybrid search](08-hybrid-search.md) | 2, piece 6 | `<=>`, full-text search, RRF |
| 09 | [The recall check](09-recall-check.md) | 2, piece 7 | recall@K, labelled questions |
| 10 | [The PDF path](10-pdf-path.md) | 2, piece 8 | text extraction, restoring headings |
| 11 | [The first graph](11-first-graph.md) | 3, piece 1 | LangGraph state, nodes, edges, compile, invoke |
| 12 | [Reducers and a real retrieve node](12-reducers-and-retrieve.md) | 3, piece 2 | reducers, `default`, an async node that searches |
| 13 | [Conditional edges and the revise loop](13-conditional-edges-and-the-revise-loop.md) | 3, piece 3 | conditional edges, loops, a counter reducer, feedback through the state |

A new page is added after each piece.
