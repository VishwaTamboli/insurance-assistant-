import type { SearchHit } from '../../retrieval/search.ts';
import type { GraphUpdate } from '../state.ts';

// Prints which node ran and what it returned, so you can follow the run. Pass a `summary`
// when the update is too long to print in full.
export function log(node: string, update: GraphUpdate, summary = JSON.stringify(update)): GraphUpdate {
  console.log(`→ ${node.padEnd(9)} returns ${summary}`);
  return update;
}

// "3. Treatment abroad > 3.1 Emergency treatment in…" → "3.1"; "4. Pre-authorisation" → "4."
export function heading(hit: SearchHit): string {
  return hit.section.split(' > ').pop()!.split(' ')[0];
}
