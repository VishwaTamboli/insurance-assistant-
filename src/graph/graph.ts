import { END, START, StateGraph } from '@langchain/langgraph';
import { afterAudit } from './edges/after-audit.ts';
import { afterClassify } from './edges/after-classify.ts';
import { auditDraft } from './nodes/audit-draft.ts';
import { classify } from './nodes/classify.ts';
import { expand } from './nodes/expand.ts';
import { humanReview } from './nodes/human-review.ts';
import { research } from './nodes/research.ts';
import { retrieve } from './nodes/retrieve.ts';
import { synthesize } from './nodes/synthesize.ts';
import { State } from './state.ts';
import type { GraphState, GraphUpdate } from './state.ts';

// The assistant as a graph: every node and edge in one place, so the whole shape reads top
// to bottom (compare guide B.2). Each node lives in nodes/; the functions that choose the
// next node for a conditional edge live in edges/.
//
// The LLM nodes also share a retry profile sized for the free tier: Google throttles short
// bursts at 5 requests/minute. Transient provider and parse failures are retried with a
// bounded 2s → 4s → 8s backoff rather than creating a multi-minute request.
const LLM_RETRY = { maxAttempts: 3, initialInterval: 2000, backoffFactor: 2, maxInterval: 8000 };

type GraphNode = (state: GraphState) => GraphUpdate | Promise<GraphUpdate>;

// Node timing is intentionally lightweight: it makes slow retrieval/model stages visible
// in the existing server logs without adding tracing dependencies or changing the graph
// state/API. It also makes before/after performance checks reproducible.
function timed(nodeName: string, node: GraphNode): GraphNode {
  return async (state) => {
    const started = performance.now();
    try {
      return await node(state);
    } finally {
      console.log(`[timing] ${nodeName} ${Math.round(performance.now() - started)}ms`);
    }
  };
}

export const app = new StateGraph(State)
  .addNode('classify', timed('classify', classify))
  .addNode('expand', timed('expand', expand))
  .addNode('retrieve', timed('retrieve', retrieve))
  // The LLM nodes can hit a rate limit or a parsing slip; the guide's retry policies give
  // each of them a second (or third) attempt before the error reaches the API layer. The
  // backoff is intentionally bounded so a transient provider problem does not create a
  // multi-minute request, while each model attempt has its own 30-second timeout.
  .addNode('research', timed('research', research), { retryPolicy: LLM_RETRY })
  .addNode('auditDraft', timed('auditDraft', auditDraft), { retryPolicy: LLM_RETRY })
  .addNode('humanReview', humanReview)
  .addNode('synthesize', timed('synthesize', synthesize), { retryPolicy: LLM_RETRY })
  // The node is auditDraft, not 'audit': a node can't have the name of a state field.

  .addEdge(START, 'classify')
  .addConditionalEdges('classify', afterClassify, ['expand', END])
  .addEdge('expand', 'retrieve')
  .addEdge('retrieve', 'research')
  .addEdge('research', 'auditDraft')
  .addConditionalEdges('auditDraft', afterAudit, ['synthesize', 'research', 'humanReview'])
  .addEdge('humanReview', 'synthesize')
  .addEdge('synthesize', END)
  .compile();
