// The wire contract of the API, mirrored for the client from src/api/types.ts on the
// backend (same field names, so the two can never silently drift apart in meaning).
// Types only — any choosing or computing of coverage information stays on the server.

export interface AnswerRequest {
  question: string;
  planCode: string;
  jurisdiction: string;
  // Optional, additive: previous turns of this conversation, most recent last. The server
  // resolves follow-up questions against them; omitting it changes nothing.
  history?: HistoryTurn[];
}

export interface HistoryTurn {
  question: string;
  answer?: string;
}

export interface PolicyInfo {
  id: string;
  title: string;
  planCode: string;
  jurisdiction: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface Source {
  id: string;
  section: string;
  content: string;
  score: number;
}

// The three ways a run can end (see the backend contract):
//   answered      the audit passed and the answer cites the policy
//   human-review  the audit didn't pass: a person will look at the draft
//   refused       out-of-scope question, refused before retrieval
export type AnswerStatus = 'answered' | 'human-review' | 'refused';

export interface AuditInfo {
  verdict: 'pass' | 'revise' | 'reject' | null;
  issues: { claimIndex: number; problem: string; severity: 'low' | 'high' }[];
  confidence: number;
}

export interface IntentInfo {
  topic: string;
  outOfScope: boolean;
}

export interface AnswerResponse {
  status: AnswerStatus;
  answer: string;
  citations: string[];
  confidence: number;
  revisions: number;
  audit: AuditInfo | null;
  intent: IntentInfo | null;
  policy: PolicyInfo | null;
  sources: Source[];
  unanswered: string[];
}
