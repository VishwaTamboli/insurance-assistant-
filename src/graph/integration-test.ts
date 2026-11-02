import assert from 'node:assert/strict';
import { config } from '../config.ts';
import { pool } from '../db/pool.ts';
import { app } from './graph.ts';

const databaseName = new URL(config.databaseUrl).pathname.slice(1);
assert.equal(databaseName, 'insurance_policy', 'integration test must target insurance_policy');

const date = '2026-10-27'; // fixed date emitted by the current classify node
const question = 'Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?';

try {
  console.log('Scenario: Gold FR coverage');
  const coverage = await app.invoke({ question, planCode: 'GOLD', jurisdiction: 'FR' });
  assert.equal(coverage.selectedPolicy?.planCode, 'GOLD');
  assert.equal(coverage.selectedPolicy?.jurisdiction, 'FR');
  assert.equal(coverage.selectedPolicy?.version, '2026.1');
  assert.equal(coverage.selectedPolicy?.effectiveFrom, '2026-01-01');
  assert.equal(coverage.audit?.verdict, 'pass');
  assert.ok(coverage.revisions <= 2);
  assert.ok(coverage.final?.citations.length, 'passing answer must cite retrieved evidence');
  assert.ok(coverage.queryEvidence.length === coverage.queries.length);
  assert.ok(coverage.queryEvidence.every(({ error }) => !error), 'all real retrieval queries must succeed');
  const retrievedIds = new Set(coverage.evidence.map(({ id }) => id));
  const queriedIds = coverage.queryEvidence.flatMap(({ hits }) => hits.map(({ id }) => id));
  assert.deepEqual([...retrievedIds], [...new Set(queriedIds)], 'combined evidence must merge duplicate chunks');
  const evidenceById = new Map(coverage.evidence.map((hit) => [hit.id, hit]));
  for (const claim of coverage.draft.claims) {
    for (const id of claim.chunkIds) assert.ok(evidenceById.has(id), `claim cites missing evidence ${id}`);
  }
  for (const section of coverage.final.citations) {
    assert.ok(coverage.evidence.some((hit) => hit.section === section), `citation not retrieved: ${section}`);
  }
  console.log('PASS: selected GOLD FR ' + coverage.selectedPolicy.version
    + `; audit ${coverage.audit.verdict}; revisions ${coverage.revisions};`
    + ` ${coverage.evidence.length} unique evidence chunks and ${coverage.final.citations.length} citations`);

  // Citation correctness: every [n] marker the LLM printed must point into the citations
  // array (Phase 7's invariant), and every claim the draft carries must be backed by a
  // quote that is really in the chunk it cites (the hallucination guard).
  const markerNumbers = [...coverage.final.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  assert.ok(markerNumbers.length >= 1, 'a passing answer cites its claims with [n] markers');
  for (const n of markerNumbers) {
    assert.ok(n >= 1 && n <= coverage.final.citations.length, `marker [${n}] points past the citations array`);
  }
  const distinctMarkers = [...new Set(markerNumbers)];
  for (const n of distinctMarkers) {
    if (n >= 1) assert.ok(coverage.final.citations[n - 1], `citation ${n} missing from the array`);
  }
  const chunksById = new Map(coverage.evidence.map((hit) => [hit.id, hit]));
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const claim of coverage.draft.claims) {
    assert.ok(
      claim.chunkIds.some((id) => flat(chunksById.get(id)?.content ?? '').includes(flat(claim.quote))),
      `claim quote is not in the cited chunk: "${claim.quote.slice(0, 60)}…"`,
    );
  }
  console.log(`PASS: ${coverage.draft.claims.length} claims all backed by real quotes;`
    + ` ${distinctMarkers.length} distinct citation markers align with the citations array`);

  console.log('\nScenario: out-of-scope medical advice');
  const medical = await app.invoke({
    question: 'Should I stop taking my blood pressure tablets before surgery?',
    planCode: 'GOLD', jurisdiction: 'FR',
  });
  assert.equal(medical.intent?.outOfScope, true);
  assert.equal(medical.final, undefined, 'out-of-scope route must stop before synthesis');
  assert.equal(medical.queryEvidence.length, 0, 'out-of-scope route must not retrieve');
  console.log('PASS: classified out of scope and ended before expansion/retrieval');

  console.log('\nScenario: unavailable BRONZE FR policy');
  const missing = await app.invoke({ question, planCode: 'BRONZE', jurisdiction: 'FR' });
  assert.equal(missing.selectedPolicy, null);
  assert.equal(missing.audit?.verdict, 'reject');
  assert.equal(missing.final?.citations.length, 0);
  assert.match(missing.final?.answer ?? '', /couldn't confirm this from your policy/i);
  assert.equal(missing.revisions, 0);
  console.log('PASS: no policy selected; audit rejected unsupported answer; fallback had no citations');
  console.log('\nScenario: comparison across two in-force plans');
  const compared = await app.invoke({
    question: 'Compare GOLD and PLATINUM waiting periods for planned surgery.',
    planCode: 'GOLD', jurisdiction: 'FR',
  });
  assert.equal(compared.selectedPolicy?.planCode, 'GOLD', 'the member plan stays the selected one');
  assert.equal(compared.comparisonPolicy?.planCode, 'PLATINUM', 'the named comparison plan is found in force');
  assert.ok(
    compared.queryEvidence.some(({ documentTitle }) => documentTitle?.startsWith('Platinum')),
    'the comparison plan is searched, under the same effective-date rule',
  );
  assert.ok(
    compared.queryEvidence.some(({ documentTitle }) => documentTitle?.startsWith('Gold')),
    'the member plan is searched too',
  );
  console.log('PASS: GOLD and PLATINUM both searched for a comparison question');

  console.log('\nScenario: follow-up resolves the previous subject');
  const followUp = await app.invoke({
    question: 'What is the waiting period?',
    planCode: 'GOLD', jurisdiction: 'FR',
    history: [{ question: 'Am I covered for dental treatment?' }],
  });
  assert.ok(
    followUp.queries.some((query) => query.includes('dental')),
    `the previous subject feeds the expanded queries (got: ${followUp.queries.join(' | ')})`,
  );
  console.log(`PASS: follow-up expanded against the previous subject (${followUp.queries.join(' | ')})`);
} finally {
  await pool.end();
}
