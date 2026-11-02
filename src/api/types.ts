// The wire format: what the API accepts from the frontend and returns to it.
// These are DTOs, kept separate from the graph's own types (src/graph/state.ts), so the
// shape of the HTTP contract can change without touching graph state and the other way
// around. The mapper in handlers/ask.ts is the only place that translates between them.

// The same three values try-graph.ts passes to the graph: the question is what the member
// typed, planCode and jurisdiction come from their account. treatmentDate is optional:
// today's classifier sets it, but the real one (step 4) will read it from the question —
// the frontend can pass an explicit date once that works.
//
// history is optional and additive (it did not exist before this phase): previous turns of
// the conversation, most recent last, so follow-up questions like "What about planned
// surgery?" resolve against the real previous topic. Omitting it changes nothing.
export interface HistoryTurn {
  question: string;
  answer?: string;
}

export interface AnswerRequest {
  question: string;
  planCode: string;
  jurisdiction: string;
  treatmentDate?: string;
  history?: HistoryTurn[];
}

// The policy that actually governs the answer (the graph's selectedPolicy).
export interface PolicyInfo {
  id: string;
  title: string;
  planCode: string;
  jurisdiction: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

// One policy chunk the answer rests on. Mirrors SearchHit, without the DB behind it.
export interface Source {
  id: string;
  section: string;
  content: string;
  score: number;
}

// The three ways a run can end (see handlers/ask.ts for how each one is recognised):
//   answered      the audit passed and the answer cites the policy
//   human-review  the audit didn't pass: the draft went to a person, never invented
//   refused       out-of-scope question, the graph stopped right after classifying
export type AnswerStatus = 'answered' | 'human-review' | 'refused';

// Everything the chat UI needs to render one turn: the answer, which policy governs it,
// the sources, and how the run concluded.
export interface AnswerResponse {
  status: AnswerStatus;
  answer: string;
  citations: string[];
  confidence: number;
  revisions: number;
  audit: {
    verdict: 'pass' | 'revise' | 'reject' | null;
    issues: { claimIndex: number; problem: string; severity: 'low' | 'high' }[];
    confidence: number;
  } | null;
  intent: { topic: string; outOfScope: boolean } | null;
  policy: PolicyInfo | null;
  sources: Source[];
  unanswered: string[];
}
