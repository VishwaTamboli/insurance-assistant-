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
    <div className="stage-trail">
      <div className="stage-heading"><span className="pulse-dot" /> Preparing your answer <span>LIVE</span></div>
      <div className="stage-list">
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
    <div className={`stage-row ${active ? 'active' : 'complete'}`}>
      {active ? (
        <span aria-hidden className="stage-spinner" />
      ) : (
        <span aria-hidden className="stage-check">✓</span>
      )}
      <span className="stage-label">
        {step.stage === 'research' && revised ? 'Reviewing the revised draft' : LABELS[step.stage]}
      </span>
      {step.audit?.verdict && <VerdictChip verdict={step.audit.verdict} />}
    </div>
  );
}

// The auditor's verdict, the only word the UI adds on its own: pass / revise / reject.
function VerdictChip({ verdict }: { verdict: 'pass' | 'revise' | 'reject' }) {
  return (
    <span className={`verdict-chip ${verdict}`}>
      {verdict}
    </span>
  );
}

// The policy in force, shown the moment the backend resolves it — before any answer.
function PolicyRow({ policy }: { policy: PolicyInfo | null }) {
  const resolved = policy !== null;
  return (
    <div className={`policy-row ${resolved ? 'resolved' : 'missing'}`}>
      <span aria-hidden>{resolved ? '▣' : '!'}</span>
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
