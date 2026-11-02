import type { ChatTurn } from '../hooks/useChat';
import { AnswerCard } from './AnswerCard';
import { StageTrail } from './StageTrail';

// One question + whatever came of it: live workflow progress while streaming, then the
// answer, an error, a cancel note, or the previous REST-style outcomes via AnswerCard.

interface Props {
  turn: ChatTurn;
  onCancel: () => void;
}

export function TurnView({ turn, onCancel }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-sm leading-relaxed text-white sm:max-w-[75%]">
          {turn.question}
        </p>
      </div>
      <div className="sm:max-w-[92%]">
        {turn.pending && (
          <div className="flex flex-inline items-start gap-3">
            <div className="min-w-0 flex-1">
              <StageTrail progress={turn.progress} policy={turn.policy} />
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 underline hover:text-slate-600"
            >
              Stop
            </button>
          </div>
        )}
        {turn.cancelled && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
            You stopped waiting for this answer. The assistant's work was cancelled.
          </div>
        )}
        {turn.error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {turn.error}
          </div>
        )}
        {turn.response && <AnswerCard response={turn.response} />}
      </div>
    </div>
  );
}
