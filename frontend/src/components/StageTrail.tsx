import type { StageProgress } from '../hooks/useChat';
import type { PolicyInfo } from '../api/types';
import type { StageName } from '../api/stream';

// The live trail of workflow steps streamed while an answer is prepared. Each row becomes
// a tick with a label; the last one is active. The audit row shows its verdict, and a
// second 'research' row makes the revise loop visible.

const LABELS: Record<StageName, string> = {
  classify: 'Reading your question',
  expand: 'Working out what to look up',
  retrieve: 'Searching the policy',
  research: 'Reviewing the policy text',
  audit: 'Checking the draft against the policy',
  'human-review': 'Sending to a person for review',
  synthesize: 'Writing your answer',
};

export function StageTrail({ progress, policy }: { progress: StageProgress[]; policy: PolicyInfo | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
      <div className="space-y-1.5">
        {progress.map(({ stage, audit }, index) => (
          <StageRow
            key={index}
            step={{ stage, audit }}
            active={index === progress.length - 1}
            revised={countOf(stage, progress, index) > 1}
          />
        ))}
      </div>
      {policy && <PolicyRow policy={policy} />}
    </div>
  );
}

// How often a stage has appeared up to and including this row.
function countOf(stage: StageName, progress: StageProgress[], throughIndex: number): number {
  return progress.slice(0, throughIndex + 1).filter(step => step.stage === stage).length;
}

function StageRow({ step, active, revised }: { step: StageProgress; active: boolean; revised: boolean }) {
  return (
    <div className="flex items-center gap-2 leading-5">
      {active ? (
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      ) : (
        <span aria-hidden className="text-emerald-500">
          ✓
        </span>
      )}
      <span className={active ? 'text-slate-700' : 'text-slate-400'}>
        {step.stage === 'research' && revised ? 'Reviewing the revised draft' : LABELS[step.stage]}
      </span>
      {step.audit?.verdict && <VerdictChip verdict={step.audit.verdict} />}
    </div>
  );
}

// The auditor's verdict, the only word the UI adds on its own: pass / revise / reject.
const VERDICT_STYLES: Record<'pass' | 'revise' | 'reject', string> = {
  pass: 'bg-emerald-100 text-emerald-700',
  revise: 'bg-amber-100 text-amber-700',
  reject: 'bg-rose-100 text-rose-700',
};

function VerdictChip({ verdict }: { verdict: 'pass' | 'revise' | 'reject' }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VERDICT_STYLES[verdict]}`}>
      {verdict}
    </span>
  );
}

// The policy in force, shown the moment the backend resolves it — before any answer.
function PolicyRow({ policy }: { policy: PolicyInfo | null }) {
  const resolved = policy !== null;
  return (
    <div className={`mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 ${resolved ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-700'}`}>
      <span aria-hidden>{resolved ? '📄' : '⚠️'}</span>
      <span>
        {resolved ? (
          <>
            In force: <span className="font-semibold">{policy.title}</span>, version {policy.version}
          </>
        ) : (
          'No policy in force for this plan and country'
        )}
      </span>
    </div>
  );
}
