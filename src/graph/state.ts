import { Annotation } from '@langchain/langgraph';
import type { PolicyDocument } from '../retrieval/policy-in-force.ts';
import type { SearchHit } from '../retrieval/search.ts';
import type { ConversationTurn, QuestionUnderstanding } from './understanding.ts';

// What each agent hands to the next. Plain types for now; in step 4 they become Zod schemas
// that Gemini's answers are checked against (guide B.4).

// What the classifier works out from the question: what it asks about, whether it should
// be refused, and how the answer should be given. The detection itself lives in
// understanding.ts; this is the same object, so nodes speak one shape.
export type Intent = QuestionUnderstanding;

// One statement of the researcher's draft, with its proof.
export interface Claim {
  text: string;       // "Emergency surgery abroad is covered up to €150,000 per policy year."
  chunkIds: string[]; // the chunk(s) it comes from
  quote: string;      // the exact supporting sentence, copied from that chunk
}

export interface Draft {
  claims: Claim[];
  unanswered: string[]; // parts of the question the evidence doesn't cover
}

export interface Audit {
  verdict: 'pass' | 'revise' | 'reject';
  issues: { claimIndex: number; problem: string; severity: 'low' | 'high' }[];
  confidence: number; // 0 to 1
}

export interface Final {
  answer: string;
  citations: string[]; // the sections the answer cites, in the order of its [1], [2]…
  confidence: number;
}

export interface QueryEvidence {
  query: string;
  hits: SearchHit[];
  error?: string;
  // Which policy document the hits came from. Written by retrieve (never by
  // retrieveQueries alone), so comparison runs keep the two policies apart.
  documentTitle?: string;
}

// The state every node reads and updates. Each field is a "channel".
// A field with no reducer keeps the LAST value a node wrote to it.
export const State = Annotation.Root({
  // Input: set by the app when the graph starts
  question: Annotation<string>,
  planCode: Annotation<string>,      // from the member's account, not from the question
  jurisdiction: Annotation<string>,
  // Previous turns of this conversation, when the caller sends them (optional and
  // additive on the wire). Follow-up questions are resolved against the last one.
  history: Annotation<ConversationTurn[]>,

  // Written by the nodes
  intent: Annotation<Intent>,
  treatmentDate: Annotation<string>, // "2026-10-27": picks the policy version in force
  queries: Annotation<string[]>,

  // A field WITH a reducer: LangGraph calls reducer(current value, update) and stores the
  // result, so new chunks are added to the ones already there instead of replacing them.
  // default() is the value before any node has written to it.
  evidence: Annotation<SearchHit[]>({
    reducer: mergeEvidence,
    default: () => [],
  }),
  queryEvidence: Annotation<QueryEvidence[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  selectedPolicy: Annotation<PolicyDocument | null>,
  // A second policy in force, only for comparison questions that name another plan
  // ("GOLD vs PLATINUM"): the same jurisdiction and effective-date rules apply to it.
  comparisonPolicy: Annotation<PolicyDocument | null>,
  comparisonPolicies: Annotation<PolicyDocument[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  draft: Annotation<Draft>,
  audit: Annotation<Audit | null>, // null while a new draft waits for its audit
  // How many times the auditor has sent a draft back. Nodes return 1 to count one more.
  revisions: Annotation<number>({
    reducer: addRevisions,
    default: () => 0,
  }),
  final: Annotation<Final>,
});

export type GraphState = typeof State.State;   // the full state a node receives
export type GraphUpdate = typeof State.Update; // the part of it a node returns

// Keeps the first copy of each chunk. Different queries often find the same chunk.
export function mergeEvidence(current: SearchHit[], update: SearchHit[]): SearchHit[] {
  return dedupeById([...current, ...update]);
}

export function addRevisions(current: number, update: number): number {
  return current + update;
}

function dedupeById(chunks: SearchHit[]): SearchHit[] {
  return chunks.filter((chunk, index) => chunks.findIndex((other) => other.id === chunk.id) === index);
}
