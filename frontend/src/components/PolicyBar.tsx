import type { PolicyInfo } from '../api/types';

// The policy that governs the answer, and the member's plan picker before any question.
// The plan list is presentational only: the API decides whether a plan has a policy.

const PLANS = ['GOLD', 'SILVER', 'PLATINUM', 'ESSENTIAL', 'BRONZE'];
const JURISDICTIONS = ['FR', 'US'];

interface Props {
  planCode: string;
  jurisdiction: string;
  onPlanChange: (planCode: string) => void;
  onJurisdictionChange: (jurisdiction: string) => void;
}

export function PolicyBar({ planCode, jurisdiction, onPlanChange, onJurisdictionChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-slate-500">Plan</span>
        <select
          value={planCode}
          onChange={event => onPlanChange(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100 focus:border-sky-400 focus:outline-none"
        >
          {PLANS.map(plan => (
            <option key={plan} value={plan}>
              {plan}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-slate-500">Country</span>
        <select
          value={jurisdiction}
          onChange={event => onJurisdictionChange(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100 focus:border-sky-400 focus:outline-none"
        >
          {JURISDICTIONS.map(code => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <PolicyLabel policy={null} planCode={planCode} jurisdiction={jurisdiction} />
    </div>
  );
}

// Caption under the picker: what the standing selection means before an answer arrives.
// Once an answer resolves the policy in force, the answer card shows that instead.
export function PolicyLabel({
  policy,
  planCode,
  jurisdiction,
}: {
  policy: PolicyInfo | null;
  planCode: string;
  jurisdiction: string;
}) {
  if (policy) return null;
  return (
    <span className="text-xs text-slate-400">
      Asking about {planCode} {jurisdiction}
    </span>
  );
}
