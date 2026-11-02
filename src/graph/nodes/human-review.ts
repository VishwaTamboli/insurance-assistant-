import type { GraphState, GraphUpdate } from '../state.ts';
import { log } from './log.ts';

// PLACEHOLDER: in step 7 the run pauses here with interrupt(), a person reads the draft and
// the audit, and approves or edits the draft. For now it changes nothing, so synthesize
// sees an audit that didn't pass and answers that the policy couldn't confirm it.
export function humanReview(state: GraphState): GraphUpdate {
  return log('humanReview', {}, `nothing yet (step 7 pauses here for a person; audit was "${state.audit?.verdict}")`);
}
