import test from 'node:test';
import assert from 'node:assert/strict';
import type { PolicyDocument } from '../src/retrieval/policy-in-force.ts';
import type { SearchHit } from '../src/retrieval/search.ts';
import { retrieveQueries } from '../src/graph/nodes/retrieve.ts';
import { mergeEvidence } from '../src/graph/state.ts';

// Any in-force policy document works for these tests; the id/title pair is what results
// carry so comparison runs can tell two searched policies apart.
const policy: PolicyDocument = {
  id: 'policy-1', planCode: 'GOLD', jurisdiction: 'FR',
  version: '2026.1', title: 'Gold Health Plan (France)',
  effectiveFrom: '2026-01-01', effectiveTo: null,
};

function hit(id: string): SearchHit {
  return { id, section: id, content: id, score: 1 };
}

test('starts all expanded query searches concurrently and retains each query results', async () => {
  const started: string[] = [];
  const pending = new Map<string, (hits: SearchHit[]) => void>();
  const search = (_documentId: string, query: string) => new Promise<SearchHit[]>((resolve) => {
    started.push(query);
    pending.set(query, resolve);
  });

  const operation = retrieveQueries(policy, ['query-a', 'query-b'], search);
  assert.deepEqual(started, ['query-a', 'query-b'], 'all searches start before any result resolves');
  pending.get('query-b')!([hit('shared'), hit('b')]);
  pending.get('query-a')!([hit('shared'), hit('a')]);

  const perQuery = await operation;
  assert.deepEqual(perQuery.map(({ query, hits }) => [query, hits.map(({ id }) => id)]), [
    ['query-a', ['shared', 'a']],
    ['query-b', ['shared', 'b']],
  ]);
  assert.deepEqual(mergeEvidence([], perQuery.flatMap(({ hits }) => hits)).map(({ id }) => id), [
    'shared', 'a', 'b',
  ]);
});

test('reports failed query and preserves successful query results', async () => {
  const perQuery = await retrieveQueries(policy, ['bad-query', 'good-query'],
    async (_documentId, query) => {
      if (query === 'bad-query') throw new Error('temporary search failure');
      return [hit('good-hit')];
    });

  assert.deepEqual(perQuery, [
    { query: 'bad-query', hits: [], error: 'temporary search failure', documentTitle: 'Gold Health Plan (France)' },
    { query: 'good-query', hits: [hit('good-hit')], documentTitle: 'Gold Health Plan (France)' },
  ]);
  assert.deepEqual(perQuery.flatMap(({ hits }) => hits).map(({ id }) => id), ['good-hit']);
});
