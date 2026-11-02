import { findPolicyInForce } from '../../retrieval/policy-in-force.ts';
import { hybridSearch, type SearchHit } from '../../retrieval/search.ts';
import type { GraphState, GraphUpdate } from '../state.ts';
import { heading } from './log.ts';

// Chunks kept per query: 3, the K of the recall check.
const HITS_PER_QUERY = 3;
type SearchFunction = typeof hybridSearch;

// A real node, not a fake: it needs no LLM, only step 2's search. It finds the ONE policy
// in force for the member's plan and country on the treatment date, then runs the hybrid
// search once per query. Comparison questions that name another plan search that policy
// too — same jurisdiction, same effective-date rule, so no second-country or stale-version
// wording can sneak in. Repeats are fine: the evidence reducer drops them.
export async function retrieve(state: GraphState): Promise<GraphUpdate> {
  const { planCode, jurisdiction, treatmentDate } = state;
  const policy = await findPolicyInForce(planCode, jurisdiction, treatmentDate);
  if (!policy) {
    console.log(`→ retrieve  no ${planCode} ${jurisdiction} policy in force on ${treatmentDate}`);
    return { evidence: [], selectedPolicy: null };
  }

  console.log(`→ retrieve  searches ${policy.title} ${policy.version}`);
  const results = await retrieveQueries(policy, state.queries, hybridSearch);

  const comparison = state.intent?.secondaryPlanCode
    ? await findPolicyInForce(state.intent.secondaryPlanCode, jurisdiction, treatmentDate)
    : null;
  if (comparison) {
    console.log(`→ retrieve  comparison searches ${comparison.title} ${comparison.version}`);
    const comparisonResults = await retrieveQueries(comparison, state.queries, hybridSearch);
    results.push(...comparisonResults);
  } else if (state.intent?.topic === 'comparison') {
    console.log('→ retrieve  comparison: no second plan named, searching the member\'s plan only');
  }

  results.forEach(({ query, hits, error, documentTitle }) => {
    if (error) console.error(`    ${`"${query}"`.padEnd(36)} search failed: ${error}`);
    else console.log(`    ${`"${query}"`.padEnd(36)} ${documentTitle ? `[${shortTitle(documentTitle)}] ` : ''}${hits.map(heading).join(' | ')}`);
  });
  const evidence: SearchHit[] = results.flatMap(({ hits }) => hits);
  console.log(`            returns ${evidence.length} chunks`);
  return { evidence, queryEvidence: results, selectedPolicy: policy, comparisonPolicy: comparison };
}

// "Gold Health Plan (France)" → "GOLD"; keeps comparison logs readable.
function shortTitle(title: string): string {
  return title.split(' ')[0].toUpperCase();
}

// Preserve input order and successful results when an individual query fails. Every
// result carries the document it belongs to, so synthesis can tell two policies apart.
export async function retrieveQueries(
  document: Pick<{ id: string; title: string }, 'id' | 'title'>,
  queries: string[],
  search: SearchFunction = hybridSearch,
) {
  const settled = await Promise.allSettled(
    queries.map((query) => search(document.id, query, HITS_PER_QUERY)),
  );
  return settled.map((result, index) => result.status === 'fulfilled'
    ? { query: queries[index], hits: result.value, documentTitle: document.title }
    : {
        query: queries[index],
        hits: [],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        documentTitle: document.title,
      });
}
