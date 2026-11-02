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
    <div className="policy-picker">
      <label className="picker-field">
        <span>Plan</span>
        <select
          value={planCode}
          onChange={event => onPlanChange(event.target.value)}
          className="policy-select"
        >
          {PLANS.map(plan => (
            <option key={plan} value={plan}>
              {plan}
            </option>
          ))}
        </select>
      </label>
      <label className="picker-field">
        <span>Country</span>
        <select
          value={jurisdiction}
          onChange={event => onJurisdictionChange(event.target.value)}
          className="policy-select"
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
