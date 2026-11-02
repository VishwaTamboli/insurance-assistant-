import { END } from '@langchain/langgraph';

// Prints which way a conditional edge went, then returns the chosen node name for LangGraph.
export function route<Next extends string>(edge: string, next: Next, why: string): Next {
  console.log(`  ↳ ${edge} → ${next === END ? 'END' : next} (${why})`);
  return next;
}
