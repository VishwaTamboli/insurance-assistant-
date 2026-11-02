import test from 'node:test';
import assert from 'node:assert/strict';
import { END } from '@langchain/langgraph';
import { afterAudit, MAX_REVISIONS } from '../src/graph/edges/after-audit.ts';
import { afterClassify } from '../src/graph/edges/after-classify.ts';
import type { GraphState } from '../src/graph/state.ts';

function routeState(overrides: Partial<GraphState>): GraphState {
  return {
    intent: { topic: 'coverage', outOfScope: false },
    audit: { verdict: 'pass', issues: [], confidence: 1 },
    revisions: 0,
    ...overrides,
  } as GraphState;
}

test('classification sends out-of-scope questions directly to END', () => {
  assert.equal(afterClassify(routeState({ intent: { topic: 'medical advice', outOfScope: true } })), END);
});

test('classification sends in-scope questions to expand', () => {
  assert.equal(afterClassify(routeState({})), 'expand');
});

test('audit pass routes to synthesis and reject routes to human review', () => {
  assert.equal(afterAudit(routeState({ audit: { verdict: 'pass', issues: [], confidence: 1 } })), 'synthesize');
  assert.equal(afterAudit(routeState({ audit: { verdict: 'reject', issues: [], confidence: 0 } })), 'humanReview');
});

test('audit revise loops only while below the maximum revision count', () => {
  assert.equal(MAX_REVISIONS, 2);
  assert.equal(afterAudit(routeState({ audit: { verdict: 'revise', issues: [], confidence: 0.5 }, revisions: 0 })), 'research');
  assert.equal(afterAudit(routeState({ audit: { verdict: 'revise', issues: [], confidence: 0.5 }, revisions: 1 })), 'research');
  assert.equal(afterAudit(routeState({ audit: { verdict: 'revise', issues: [], confidence: 0.5 }, revisions: 2 })), 'humanReview');
});
