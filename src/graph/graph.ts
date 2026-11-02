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

// The assistant as a graph: every node and edge in one place, so the whole shape reads top
// to bottom (compare guide B.2). Each node lives in nodes/; the functions that choose the
// next node for a conditional edge live in edges/.
//
// The LLM nodes also share a retry profile sized for the free tier: Google throttles short
// bursts at 5 requests/minute, and the polite response to a 429 is to wait out the window
// (8s → 16s → 30s) rather than hammer. A parse slip gets retried on the same terms.
const LLM_RETRY = { maxAttempts: 4, initialInterval: 8000, backoffFactor: 2, maxInterval: 30000 };

export const app = new StateGraph(State)
  .addNode('classify', classify)
  .addNode('expand', expand)
  .addNode('retrieve', retrieve)
  // The LLM nodes can hit a rate limit or a parsing slip; the guide's retry policies give
  // each of them a second (or third) attempt before the error reaches the API layer.
  .addNode('research', research, { retryPolicy: LLM_RETRY })
  .addNode('auditDraft', auditDraft, { retryPolicy: LLM_RETRY })
  .addNode('humanReview', humanReview)
  .addNode('synthesize', synthesize, { retryPolicy: LLM_RETRY })
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
