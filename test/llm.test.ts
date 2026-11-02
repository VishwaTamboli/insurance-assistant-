// Unit tests for the code-level guards around the LLM nodes (Phase 8, guide step 4):
// quote verification for the researcher, audited-claim selection and marker checks for the
// synthesizer. No database, no LLM — these are pure functions, evergreen even when the
// model has a bad day.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Claim } from '../src/graph/state.ts';
import type { SearchHit } from '../src/retrieval/search.ts';
import { normalize, quoteIsReal, validateQuotes } from '../src/graph/nodes/quote-check.ts';
import { pickClaims, renderFallback } from '../src/graph/nodes/render.ts';
import { checkMarkers, renumberMarkers } from '../src/graph/nodes/synthesize.ts';
import type { Format } from '../src/graph/understanding.ts';

// ---------- quote verification (research node) ---------- //

function chunk(id: string, content: string): SearchHit {
  return { id, section: id, content, score: 1 };
}

const BACKED = 'Emergency treatment abroad is covered up to 150000. An excess of 150 applies to each claim.';
const CHUNKS = new Map([chunk('c1', BACKED), chunk('c2', 'nothing useful here')].map((c) => [c.id, c]));

function claim(partial: Partial<Claim>): Claim {
  return { text: 'a fact', chunkIds: ['c1'], quote: 'Emergency treatment abroad is covered up to 150000.', ...partial };
}

test('a quote copied word for word is real', () => {
  assert.equal(quoteIsReal(claim({}), CHUNKS), true);
});

test('the quote survives curly quotes, dashes and case differences', () => {
  assert.equal(
    normalize('Emergency — treatment “abroad”\n  is covered.'),
    'emergency - treatment "abroad" is covered.',
    'normalize flattens dashes, quotes and whitespace',
  );
  assert.equal(quoteIsReal(claim({ quote: 'AN EXCESS of 150 applies to each claim.' }), CHUNKS), true);
});

test('a quote that never appears is not real', () => {
  assert.equal(quoteIsReal(claim({ quote: 'Emergency treatment abroad is covered in full.' }), CHUNKS), false);
});

test('a claim pointing at an unknown chunk is not real', () => {
  assert.equal(quoteIsReal(claim({ chunkIds: ['c999'] }), CHUNKS), false);
});

test('validateQuotes keeps only claims backed by real quotes, counting the dropped', () => {
  const drafts = [
    claim({}),
    claim({ quote: 'covered in full, guaranteed', chunkIds: ['c1'] }), // invented wording
    claim({ chunkIds: ['c2'], quote: 'AN EXCESS of 150 applies.' }), // quoted c1's text but points at c2
    claim({ chunkIds: ['c999'], quote: 'anything' }), // unknown chunk id
  ];
  const { kept, dropped } = validateQuotes(drafts, CHUNKS);
  assert.deepEqual(kept, [drafts[0]]);
  assert.equal(dropped, 3);
});

// ---------- audited-claim selection (synthesize) ---------- //

function c(id: string, text: string): Claim {
  return { text, chunkIds: [`chunk-${id}`], quote: text };
}

test('short and example answers pick the claim best matching the subject', () => {
  const claims = [c('a', 'GP visits are paid at 100%.'), c('b', 'Physiotherapy is covered up to 25 sessions.')];
  const short: Format = { kind: 'short' };
  assert.equal(pickClaims(claims, short, 'physiotherapy')[0]?.text, claims[1].text);
  assert.equal(pickClaims(claims, short, 'physiotherapy').length, 1);
  // No subject available: the first claim, never nothing.
  assert.equal(pickClaims(claims, short, '')[0]?.text, claims[0].text);
});

test('a summary request caps the claim count at the requested points', () => {
  const claims = [c('a', 'one'), c('b', 'two'), c('c', 'three'), c('d', 'four')];
  const three: Format = { kind: 'summary', points: 3 };
  assert.deepEqual(pickClaims(claims, three, ''), claims.slice(0, 3));
  // Fewer claims than requested: everything that exists is printed.
  assert.deepEqual(pickClaims(claims.slice(0, 2), three, ''), claims.slice(0, 2));
});

test('other formats print every claim', () => {
  const claims = [c('a', 'one'), c('b', 'two')];
  for (const kind of ['bullets', 'numbered', 'detailed', 'table', 'steps', 'sources', 'direct'] as const) {
    assert.deepEqual(pickClaims(claims, { kind }, ''), claims);
  }
});

test('fallback list formatting keeps each point and citation together', () => {
  const claims = [c('a', 'First condition.'), c('b', 'Second condition.')];
  const tools = {
    sectionOf: () => 'Conditions',
    policyOf: () => 'GOLD',
    format: { kind: 'bullets' as const },
    used: claims,
    subject: '',
  };
  assert.equal(renderFallback(claims, tools), '- First condition. [1]\n- Second condition. [2]');
  assert.equal(renderFallback(claims, { ...tools, format: { kind: 'numbered' as const } }), '1. First condition.\n2. Second condition.');
});

// ---------- marker checks and renumbering (synthesize) ---------- //

test('markers must cite existing claims in print order; repeats are allowed', () => {
  assert.deepEqual(checkMarkers([1, 2, 2], 3), { ok: true, markers: [1, 2] }, 'the same claim cited twice is fine');
  assert.deepEqual(checkMarkers([2, 3], 3), { ok: true, markers: [2, 3] });
  assert.deepEqual(checkMarkers([2, 1], 3), { ok: false, reason: 'the markers do not follow the print order' });
  assert.deepEqual(checkMarkers([1, 4], 3), { ok: false, reason: 'a marker named a claim that does not exist' });
  assert.deepEqual(checkMarkers([], 3), { ok: false, reason: 'no claim is cited' });
});

test('markers are renumbered to print positions when claims were skipped', () => {
  assert.equal(renumberMarkers('looks like [2] and [7] elsewhere', [2, 7]), 'looks like [1] and [2] elsewhere');
  // Consecutive numbers come through untouched.
  assert.equal(renumberMarkers('[1] then [2]', [1, 2]), '[1] then [2]');
  // A number outside the mapping (impossible in a checked answer) is left alone.
  assert.equal(renumberMarkers('[9]', [2]), '[9]');
});
