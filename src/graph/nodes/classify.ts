import type { GraphState, GraphUpdate } from '../state.ts';
import { understand } from '../understanding.ts';
import { log } from './log.ts';

// The classifier uses the understanding layer (understanding.ts): what is being asked,
// whether to refuse, the requested response format, and any follow-up context from the
// member's history. Same input and output shape as the step-4 LLM classifier will have.

// The treatment date in force, "2026-10-31" style. A date the member's account line
// passed in is kept; otherwise today.
function treatmentDate(state: GraphState): string {
  return state.treatmentDate ?? new Date().toISOString().slice(0, 10);
}

export function classify(state: GraphState): GraphUpdate {
  const intent = understand(state.question, state.history ?? [], state.planCode);
  const summary = intent.outOfScope
    ? `out of scope: ${intent.topic}`
    : `${intent.aspects.join(' + ')}; subject "${intent.subject}"${intent.followUp ? ' (follow-up)' : ''}; format ${intent.format.kind}`;
  return log('classify', { intent, treatmentDate: treatmentDate(state) }, summary);
}
