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
    <div className="turn">
      <div className="user-message-wrap">
        <p className="user-message">
          {turn.question}
        </p>
      </div>
      <div className="assistant-column">
        {turn.pending && (
          <div className="pending-row">
            <div className="pending-trail">
              <StageTrail progress={turn.progress} policy={turn.policy} />
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="stop-button"
            >
              Stop
            </button>
          </div>
        )}
        {turn.cancelled && (
          <div className="cancelled-note">
            You stopped waiting for this answer. The assistant's work was cancelled.
          </div>
        )}
        {turn.error && (
          <div className="error-note">
            {turn.error}
          </div>
        )}
        {turn.response && <AnswerCard response={turn.response} />}
      </div>
    </div>
  );
}
