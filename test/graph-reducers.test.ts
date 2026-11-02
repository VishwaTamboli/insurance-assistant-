import test from 'node:test';
import assert from 'node:assert/strict';
import { addRevisions, mergeEvidence } from '../src/graph/state.ts';

const hit = (id: string) => ({ id, section: id, content: id, score: 1 });

test('evidence reducer deduplicates by chunk id and keeps the first hit', () => {
  const result = mergeEvidence([hit('a')], [hit('a'), hit('b')]);
  assert.deepEqual(result.map(({ id }) => id), ['a', 'b']);
  assert.equal(result[0].content, 'a');
});

test('revisions reducer adds updates', () => {
  assert.equal(addRevisions(1, 1), 2);
  assert.equal(addRevisions(2, 0), 2);
});
