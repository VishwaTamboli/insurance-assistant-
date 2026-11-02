import { findPoliciesInForce, findPolicyInForce } from '../../retrieval/policy-in-force.ts';
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
  // Policy resolution is independent for the member and comparison plan. Resolve both
  // before searching so a comparison does not add an avoidable full lookup round-trip.
  const comparisonCode = state.intent?.secondaryPlanCode;
  const compareAll = state.intent?.topic === 'comparison' && comparisonCode === null;
  const [policy, comparison, available] = await Promise.all([
    findPolicyInForce(planCode, jurisdiction, treatmentDate),
    comparisonCode
      ? findPolicyInForce(comparisonCode, jurisdiction, treatmentDate)
      : Promise.resolve(null),
    compareAll ? findPoliciesInForce(jurisdiction, treatmentDate) : Promise.resolve([]),
  ]);
  if (!policy) {
    console.log(`→ retrieve  no ${planCode} ${jurisdiction} policy in force on ${treatmentDate}`);
    return { evidence: [], selectedPolicy: null };
  }

  console.log(`→ retrieve  searches ${policy.title} ${policy.version}`);
  const comparisonPolicies = comparison
    ? [comparison]
    : available.filter((candidate) => candidate.id !== policy.id);
  const searches = [retrieveQueries(policy, state.queries, hybridSearch)];
  if (comparisonPolicies.length > 0) {
    for (const comparisonPolicy of comparisonPolicies) {
      console.log(`→ retrieve  comparison searches ${comparisonPolicy.title} ${comparisonPolicy.version}`);
      searches.push(retrieveQueries(comparisonPolicy, state.queries, hybridSearch));
    }
  } else if (state.intent?.topic === 'comparison') {
    console.log('→ retrieve  comparison: no additional in-force policies, searching the member\'s plan only');
  }
  const resultSets = await Promise.all(searches);
  const results = resultSets.flat();

  results.forEach(({ query, hits, error, documentTitle }) => {
    if (error) console.error(`    ${`"${query}"`.padEnd(36)} search failed: ${error}`);
    else console.log(`    ${`"${query}"`.padEnd(36)} ${documentTitle ? `[${shortTitle(documentTitle)}] ` : ''}${hits.map(heading).join(' | ')}`);
  });
  const evidence: SearchHit[] = results.flatMap(({ hits }) => hits);
  console.log(`            returns ${evidence.length} chunks`);
  return { evidence, queryEvidence: results, selectedPolicy: policy, comparisonPolicy: comparisonPolicies[0] ?? null, comparisonPolicies };
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
