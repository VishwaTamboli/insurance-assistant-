import { pool } from '../db/pool.ts';
import { findPolicyInForce } from './policy-in-force.ts';
import { hybridSearch, keywordSearch, vectorSearch, type SearchHit } from './search.ts';

// The three searches side by side, top 5 of each, on the policy in force.
// Two small Gemini calls per case: vectorSearch embeds the query, and so does hybridSearch.
const date = '2026-10-27';
const cases = [
  { plan: 'GOLD', country: 'FR', query: 'emergency surgery abroad' },           // both searches agree
  { plan: 'GOLD', country: 'FR', query: 'day 91' },                             // exact words: keyword helps
  { plan: 'GOLD', country: 'US', query: 'pre-authorisation' },                  // other spelling: vector helps
  { plan: 'GOLD', country: 'FR', query: 'Am I covered for surgery in Spain?' }, // a whole question
];

for (const { plan, country, query } of cases) {
  const policy = await findPolicyInForce(plan, country, date);
  if (!policy) throw new Error(`No ${plan} ${country} policy in force on ${date}`);

  const [vector, keyword, hybrid] = await Promise.all([
    vectorSearch(policy.id, query, 5),
    keywordSearch(policy.id, query, 5),
    hybridSearch(policy.id, query, 5),
  ]);

  console.log(`\n${policy.title} ${policy.version}: "${query}"`);
  console.log(`     ${'vector (similarity)'.padEnd(36)}${'keyword (ts_rank_cd)'.padEnd(36)}hybrid (RRF)`);
  for (let i = 0; i < 5; i++) {
    const keywordCell = keyword.length === 0 && i === 0 ? '(no matches)'.padEnd(36) : cell(keyword[i], 3);
    console.log(`  ${i + 1}  ${cell(vector[i], 3)}${keywordCell}${cell(hybrid[i], 4)}`);
  }
}

await pool.end();

// "3.1 Emergency treatment in 0.726": the chunk's own heading, cut short, then its score.
function cell(hit: SearchHit | undefined, decimals: number): string {
  if (!hit) return ''.padEnd(36);
  const heading = hit.section.split(' > ').pop()!.slice(0, 26);
  return `${heading.padEnd(27)}${hit.score.toFixed(decimals)}`.padEnd(36);
}
