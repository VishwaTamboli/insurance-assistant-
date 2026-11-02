import { END } from '@langchain/langgraph';
import type { GraphState } from '../state.ts';
import { route } from './route.ts';

// Runs after classify and picks the next node. Out of scope (medical advice, someone else's
// policy…) → END, and the app shows a polite refusal. Anything else → expand.
export function afterClassify(state: GraphState) {
  if (state.intent.outOfScope) return route('afterClassify', END, `out of scope: ${state.intent.topic}`);
  return route('afterClassify', 'expand', state.intent.topic);
}
