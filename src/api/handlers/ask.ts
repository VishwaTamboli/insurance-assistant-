import { app } from '../../graph/graph.ts';
import type { GraphState } from '../../graph/state.ts';
import type { AnswerRequest, AnswerResponse, AnswerStatus, HistoryTurn } from '../types.ts';

// The handler for POST /api/ask: run the existing graph and map its final state onto the
// HTTP contract. This file is the only boundary between the graph and the web — no new
// business logic lives here, and nothing in src/graph/ changes for it.

// How a run's conclusion shows up in the final state:
//   no final at all            the graph ended after classify (out of scope) → refused
//   final + audit verdict pass an answer with citations → answered
//   final, any other audit     the draft went to human review → human-review
//   (synthesis already writes the "couldn't confirm" answer, so the text isn't invented here)
function statusOf(state: GraphState): AnswerStatus {
  if (!state.final) return 'refused';
  return state.audit?.verdict === 'pass' ? 'answered' : 'human-review';
}

// What to say when the question is out of scope. The classifier decides the verdict; this
// is just its wording. Keyed by the classifier's topic, with a fallback for new topics.
const REFUSALS: Record<string, string> = {
  'medical advice':
    "I'm sorry, but I can't give medical advice. For questions like this, please speak to " +
    'your doctor — and check your policy documents for anything they ask of you.',
};

function defaultRefusal(topic: string | undefined): string {
  const what = topic ?? 'this';
  return `I can only answer questions about the cover set out in your policy, and ${what} is outside that.`;
}

// Validate the request body before anything touches the graph. planCode and jurisdiction
// reach SQL, so the rule is deliberately strict: uppercase letters only, like "GOLD" or "FR".
// Real plan codes run from GOLD (4) to PLATINUM (8), so 2–12 covers them with room to spare.
export function parseAskBody(body: unknown): AnswerRequest {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const { question, planCode, jurisdiction, treatmentDate } = body as Partial<AnswerRequest>;

  if (typeof question !== 'string' || question.trim().length === 0 || question.length > 2000) {
    throw new HttpError(400, 'question must be a non-empty string of at most 2000 characters.');
  }
  const CODE = /^[A-Z]{2,12}$/;
  if (typeof planCode !== 'string' || !CODE.test(planCode)) {
    throw new HttpError(400, 'planCode must be uppercase letters, like "GOLD" or "PLATINUM".');
  }
  if (typeof jurisdiction !== 'string' || !CODE.test(jurisdiction)) {
    throw new HttpError(400, 'jurisdiction must be uppercase letters, like "FR" or "US".');
  }
  if (treatmentDate !== undefined && (typeof treatmentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(treatmentDate))) {
    throw new HttpError(400, 'treatmentDate must look like "2026-10-27" when given.');
  }

  const input: AnswerRequest = { question: question.trim(), planCode, jurisdiction };
  if (treatmentDate !== undefined) input.treatmentDate = treatmentDate;
  const history = parseHistory(body);
  if (history !== undefined) input.history = history;
  return input;
}

// Optional conversational history: an ordered list of previous turns, most recent last.
// Strict but small: at most 8 turns, each with a question (string) and optionally the
// answer that was given. Absent, empty, or valid — otherwise a 400.
function parseHistory(body: unknown): HistoryTurn[] | undefined {
  const { history } = body as { history?: unknown };
  if (history === undefined) return undefined;
  if (!Array.isArray(history) || history.length > 8) {
    throw new HttpError(400, 'history must be an array of at most 8 previous turns.');
  }
  return history.map((turn) => {
    if (typeof turn !== 'object' || turn === null) {
      throw new HttpError(400, 'each history turn must be an object with a question.');
    }
    const { question, answer } = turn as { question?: unknown; answer?: unknown };
    if (typeof question !== 'string' || question.trim().length === 0 || question.length > 2000) {
      throw new HttpError(400, 'each history turn needs a question string of at most 2000 characters.');
    }
    if (answer !== undefined && (typeof answer !== 'string' || answer.length > 8000)) {
      throw new HttpError(400, 'each history answer must be a string of at most 8000 characters.');
    }
    return answer === undefined ? { question: question.trim() } : { question: question.trim(), answer };
  });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// The graph input: the wire request as graph state. Both handlers (REST and stream)
// share it, so history reaches the graph identically whichever route is used.
export function graphInputOf(input: AnswerRequest) {
  const base = {
    question: input.question,
    planCode: input.planCode,
    jurisdiction: input.jurisdiction,
  };
  const withDate = input.treatmentDate
    ? { ...base, treatmentDate: input.treatmentDate }
    : base;
  return input.history ? { ...withDate, history: toGraphHistory(input.history) } : withDate;
}

// The wire DTO becomes the graph's ConversationTurn; fields match, the type does not.
function toGraphHistory(history: HistoryTurn[]) {
  return history.map((turn) => ({ question: turn.question, ...(turn.answer !== undefined ? { answer: turn.answer } : {}) }));
}

// One run of the graph per question, the same way try-graph.ts invokes it.
export async function answerQuestion(input: AnswerRequest): Promise<AnswerResponse> {
  const state = await app.invoke(graphInputOf(input));
  return mapStateToResponse(state);
}

// Graph final state → AnswerResponse. Every field in the contract comes from the graph —
// the mapper never chooses coverage information, only presentation.
export function mapStateToResponse(state: GraphState): AnswerResponse {
  const { final, intent, audit, selectedPolicy, evidence, revisions, draft } = state;

  return {
    status: statusOf(state),
    answer: final?.answer ?? REFUSALS[intent?.topic ?? ''] ?? defaultRefusal(intent?.topic),
    citations: final?.citations ?? [],
    confidence: final?.confidence ?? 0,
    revisions,
    audit: audit ? { verdict: audit.verdict, issues: audit.issues, confidence: audit.confidence } : null,
    intent: intent ? { topic: intent.topic, outOfScope: intent.outOfScope } : null,
    policy: selectedPolicy
      ? {
          id: selectedPolicy.id,
          title: selectedPolicy.title,
          planCode: selectedPolicy.planCode,
          jurisdiction: selectedPolicy.jurisdiction,
          version: selectedPolicy.version,
          effectiveFrom: selectedPolicy.effectiveFrom,
          effectiveTo: selectedPolicy.effectiveTo,
        }
      : null,
    sources: evidence.map((hit) => ({ id: hit.id, section: hit.section, content: hit.content, score: hit.score })),
    unanswered: draft?.unanswered ?? [],
  };
}
