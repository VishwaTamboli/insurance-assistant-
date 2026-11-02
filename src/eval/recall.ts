import { pool } from '../db/pool.ts';
import { findPolicyInForce } from '../retrieval/policy-in-force.ts';
import { hybridSearch, keywordSearch, vectorSearch, type SearchHit } from '../retrieval/search.ts';
import { questions } from './retrieval-questions.ts';

// Recall@K: of all the chunks the labelled questions need, how many does each search put
// in its top K? The guide uses K = 10, but our policies have only 9–14 chunks each, so a
// top 10 is nearly the whole policy. K = 3 is closer to what the Researcher will read.
//
// Two small Gemini calls per question (vectorSearch and hybridSearch each embed the query).
const K = 3;

const searches = {
  vector: vectorSearch,
  keyword: keywordSearch,
  hybrid: hybridSearch,
};
type SearchName = keyof typeof searches;

const totals = { vector: 0, keyword: 0, hybrid: 0 };
let needed = 0;

console.log(`${''.padEnd(54)}${'vector'.padEnd(14)}${'keyword'.padEnd(14)}hybrid`);

for (const question of questions) {
  const policy = await findPolicyInForce(question.plan, question.country, question.date);
  if (!policy) throw new Error(`No ${question.plan} ${question.country} policy in force on ${question.date}`);

  needed += question.expected.length;
  let line = `${question.plan} ${question.country} ${policy.version}`.padEnd(20) + `"${question.query}"`.slice(0, 33).padEnd(34);

  for (const name of Object.keys(searches) as SearchName[]) {
    const hits = await searches[name](policy.id, question.query, 40);
    const ranks = question.expected.map((section) => rankOf(hits, section));
    const found = ranks.filter((rank) => rank !== null && rank <= K).length;
    totals[name] += found;
    line += `${found}/${ranks.length} (${ranks.map((rank) => rank ?? '–').join(',')})`.padEnd(14);
  }
  console.log(line);
}

console.log(`\nrecall@${K}`.padEnd(55) +
  (Object.keys(totals) as SearchName[]).map((name) => percent(totals[name]).padEnd(14)).join(''));

await pool.end();

// Position (1, 2, 3…) of the first chunk from this section, or null if the search didn't return it.
function rankOf(hits: SearchHit[], section: string): number | null {
  const index = hits.findIndex((hit) => hit.section === section);
  return index === -1 ? null : index + 1;
}

function percent(found: number): string {
  return `${Math.round((found / needed) * 100)}% (${found}/${needed})`;
}
