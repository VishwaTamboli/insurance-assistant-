import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { askStream } from '../api/stream';
import type { StageName, StreamEvent } from '../api/stream';
import type { AnswerRequest, AnswerResponse, AuditInfo, HistoryTurn, PolicyInfo } from '../api/types';

// The chat's state machine, now fed by the SSE stream. One turn per question; while it
// runs, the turn accumulates the live progress trail and the resolved policy, and ends
// with the same AnswerResponse as before. No answer content is chosen here.

export interface StageProgress {
  stage: StageName; // 'classify' | … | 'synthesize'
  audit?: AuditInfo | null; // present on audit stages: the verdict the UI shows
}

export interface ChatTurn {
  id: number;
  question: string;
  pending: boolean;
  progress: StageProgress[]; // in arrival order; the last one is "active"
  policy: PolicyInfo | null; // mid-run, from the policy event
  cancelled: boolean;
  response: AnswerResponse | null;
  error: string | null;
}

const freshTurn = {
  pending: true,
  progress: [],
  policy: null,
  cancelled: false,
  response: null,
  error: null,
} as const satisfies Omit<ChatTurn, 'id' | 'question'>;

export function useChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const nextId = useRef(1);
  // A current snapshot so `send` (kept dependency-free) can see the finished turns.
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = turns;

  // Sending is single-flight: callers disable the composer while this is true.
  const pending = turns[turns.length - 1]?.pending ?? false;

  const send = useCallback(async (question: string, input: Omit<AnswerRequest, 'question'>) => {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;

    const id = nextId.current++;
    const controller = new AbortController();
    controllers.current.set(id, controller);

    setTurns(current => [...current, { id, question: trimmed, ...freshTurn }]);

    // Only finished turns answering a question under the SAME active policy become
    // context: a plan/country switch must not drag the old policy's topics along.
    const history = historyOf(turnsRef.current, input.planCode, input.jurisdiction);

    try {
      for await (const event of askStream({ question: trimmed, history, ...input }, { signal: controller.signal })) {
        if (controller.signal.aborted) break;
        setTurns(current =>
          current.map(turn => (turn.id === id ? { ...turn, ...applyEvent(event, turn) } : turn)),
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setTurns(current => current.map(turn => (turn.id === id ? { ...turn, cancelled: true } : turn)));
      } else {
        const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
        setTurns(current => current.map(turn => (turn.id === id ? { ...turn, error: message } : turn)));
      }
    } finally {
      // A stream that ended without a final answer and without an error event means the
      // connection dropped mid-run — surface that instead of leaving a hanging turn.
      setTurns(current =>
        current.map(turn => {
          if (turn.id !== id) return turn;
          const dropped = !controller.signal.aborted && !turn.response && !turn.error;
          return { ...turn, pending: false, error: dropped ? 'The connection was lost before an answer arrived.' : turn.error };
        }),
      );
      controllers.current.delete(id);
    }
  }, []);

  // The turn still running server-side cannot be revoked, but the UI stops waiting on it.
  const cancel = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
  }, []);

  const reset = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setTurns([]);
  }, []);

  return { turns, send, pending, cancel, reset };
}

// Previous turns, most recent last, capped at the 8 the API accepts. A turn counts only
// when it concluded with an answer under the policy still in force in the member's
// account (planCode and jurisdiction are per-request inputs, so a selector change drops
// the old policy's context). Refusals/cancellations carry no answer text and don't count.
function historyOf(turns: ChatTurn[], planCode: string, jurisdiction: string): HistoryTurn[] {
  return turns
    .filter(turn => turn.response
      && turn.cancelled === false
      && turn.response.policy?.planCode === planCode
      && turn.response.policy?.jurisdiction === jurisdiction)
    .slice(-8)
    .map(turn => ({ question: turn.question, answer: turn.response!.answer }));
}

function applyEvent(event: StreamEvent, turn: ChatTurn): Partial<ChatTurn> {
  switch (event.type) {
    case 'stage':
      return { progress: [...turn.progress, { stage: event.stage, audit: event.audit }] };
    case 'policy':
      return { policy: event.policy };
    case 'final':
      return { response: event.response, pending: false };
    case 'error':
      return { error: event.message, pending: false };
  }
}
