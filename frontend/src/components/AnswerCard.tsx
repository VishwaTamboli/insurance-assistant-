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
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      {badge && (
        <div className={`mb-3 inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </div>
      )}

      {response.policy && <PolicyHeading policy={response.policy} />}

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 sm:text-[15px]">{response.answer}</p>

      {response.status === 'answered' && response.unanswered.length > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
    <div className="mb-3 inline-flex flex-wrap items-baseline gap-x-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
      <span className="font-semibold">{policy.title}</span>
      <span>
        version {policy.version}, effective from {policy.effectiveFrom}
      </span>
    </div>
  );
}

// The sections `[1]`, `[2]`… in the answer text stand for, in order.
function Citations({ citations }: { citations: string[] }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Cited sections</h3>
      <ol className="mt-1.5 space-y-1 text-xs text-slate-600">
        {citations.map((section, index) => (
          <li key={section} className="flex gap-2">
            <span className="font-semibold text-slate-400">[{index + 1}]</span>
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
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-700">
        Source sections ({sources.length})
      </summary>
      <div className="mt-2 space-y-2">
        {sources.map(source => (
          <details key={source.id} className="rounded-lg bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-slate-700">{source.section}</summary>
            <p className="mt-1.5 whitespace-pre-wrap text-slate-600">{source.content}</p>
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
    <p className="mt-3 text-[11px] text-slate-400">
      Verified against the policy text with {Math.round(confidence * 100)}% confidence
      {revisions > 0 ? ` (${revisions} revision${revisions > 1 ? 's' : ''})` : ''}.
    </p>
  );
}
