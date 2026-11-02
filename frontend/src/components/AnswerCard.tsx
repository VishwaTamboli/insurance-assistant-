import type { AnswerResponse } from '../api/types';

// Renders one assistant answer according to how the run ended (the server's status, not
// any client-side judgment): answered with citations, human-review with its amber note,
// or a plain refusal. The answer text is shown verbatim from the API.

const STATUS_BADGE: Record<AnswerResponse['status'], { label: string; className: string } | null> = {
  answered: null, // a passing answer needs no badge; the policy card says what backs it
  'human-review': { label: 'Sent for human review', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  refused: { label: 'Out of scope', className: 'bg-slate-100 text-slate-600 border-slate-300' },
};

export function AnswerCard({ response }: { response: AnswerResponse }) {
  const badge = STATUS_BADGE[response.status];

  return (
    <article className={`answer-card status-${response.status}`}>
      {badge && (
        <div className="status-badge"><span aria-hidden="true">{response.status === 'human-review' ? '◷' : '!'}</span>{badge.label}
        </div>
      )}

      {response.policy && <PolicyHeading policy={response.policy} />}

      <p className="answer-copy">{response.answer}</p>

      {response.status === 'answered' && response.unanswered.length > 0 && (
        <p className="unanswered-note">
          Your policy doesn't answer part of this question. Our team can check the rest:
        </p>
      )}

      {response.citations.length > 0 && <Citations citations={response.citations} />}
      {response.sources.length > 0 && <Sources sources={response.sources} />}
      {response.audit && (
        <AuditNote verdict={response.audit.verdict} confidence={response.audit.confidence} revisions={response.revisions} />
      )}
    </article>
  );
}

function PolicyHeading({ policy }: { policy: AnswerResponse['policy'] }) {
  if (!policy) {
    return (
      <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
        No policy in force for this plan and country — the answer could not be checked
        against a document.
      </p>
    );
  }
  return (
    <div className="policy-context">
      <span>▣</span><strong>{policy.title}</strong>
      <span>
        version {policy.version}, effective from {policy.effectiveFrom}
      </span>
    </div>
  );
}

// The sections `[1]`, `[2]`… in the answer text stand for, in order.
function Citations({ citations }: { citations: string[] }) {
  return (
    <div className="citations">
      <h3>Cited sections</h3>
      <ol>
        {citations.map((section, index) => (
          <li key={section}><span>[{index + 1}]</span>
            {section}
          </li>
        ))}
      </ol>
    </div>
  );
}

// The actual policy wording each citation rests on, folded away to keep the chat calm.
function Sources({ sources }: { sources: AnswerResponse['sources'] }) {
  return (
    <details className="sources">
      <summary>View policy wording <span>({sources.length} {sources.length === 1 ? 'section' : 'sections'})</span>
      </summary>
      <div className="source-list">
        {sources.map(source => (
          <details key={source.id} className="source-item">
            <summary>{source.section}<span>+</span></summary>
            <p>{source.content}</p>
          </details>
        ))}
      </div>
    </details>
  );
}

// How the audit concluded: reassurance for a pass, honesty otherwise.
function AuditNote({ verdict, confidence, revisions }: { verdict: 'pass' | 'revise' | 'reject' | null; confidence: number; revisions: number }) {
  if (verdict !== 'pass' || confidence === 0) return null;
  return (
    <p className="audit-note"><span aria-hidden="true">✓</span> Verified against policy text · {Math.round(confidence * 100)}% confidence
      {revisions > 0 ? ` (${revisions} revision${revisions > 1 ? 's' : ''})` : ''}.
    </p>
  );
}
