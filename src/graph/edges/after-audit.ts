import type { GraphState } from '../state.ts';
import { route } from './route.ts';

// The most times the auditor can send a draft back before a person takes over.
export const MAX_REVISIONS = 2;

// Runs after auditDraft and picks the next node:
//   pass                                         → synthesize
//   revise, with fewer than 2 revisions so far   → research again (the revise loop)
//   reject, or revise when 2 revisions are spent → humanReview
export function afterAudit(state: GraphState) {
  const { verdict } = state.audit!;
  const why = `${verdict}, revisions so far: ${state.revisions}`;
  if (verdict === 'pass') return route('afterAudit', 'synthesize', why);
  if (verdict === 'revise' && state.revisions < MAX_REVISIONS) return route('afterAudit', 'research', why);
  return route('afterAudit', 'humanReview', why);
}
