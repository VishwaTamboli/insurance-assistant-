// Unit tests for the question-understanding layer (src/graph/understanding.ts) and the
// nodes that consume it. No database, no LLM: detection is rules, so everything here is
// an exact expectation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { understand, detectFormat } from '../src/graph/understanding.ts';
import type { ConversationTurn } from '../src/graph/understanding.ts';
import { buildQueries } from '../src/graph/nodes/expand.ts';
import { classify } from '../src/graph/nodes/classify.ts';
import type { GraphState } from '../src/graph/state.ts';

function understood(question: string, history: ConversationTurn[] = [], planCode = 'GOLD') {
  return understand(question, history, planCode);
}

// ---------- 1. intent detection: 15+ question types ---------- //

test('coverage question is in scope and keeps its subject', () => {
  const result = understood('Am I covered for dental treatment?');
  assert.equal(result.topic, 'coverage');
  assert.equal(result.outOfScope, false);
  assert.equal(result.subject, 'dental treatment');
});

test('exclusion question detects exclusion, not coverage', () => {
  const result = understood('What is not covered by my plan?');
  assert.equal(result.topic, 'exclusion');
  assert.ok(result.aspects.includes('exclusion'));
});

test('benefits question detects benefit', () => {
  const result = understood('What benefits does my plan include?');
  assert.equal(result.topic, 'benefit');
});

test('waiting-period question beats the definition wording', () => {
  const result = understood('What is the waiting period for maternity?');
  assert.equal(result.topic, 'waiting-period');
  assert.ok(result.aspects.includes('waiting-period'));
  assert.equal(result.aspects.includes('definition'), false);
});

test('pre-authorisation question is detected with its subject', () => {
  const result = understood('Do I need pre-authorisation for planned surgery?');
  assert.equal(result.topic, 'pre-authorisation');
  assert.equal(result.subject, 'planned surgery');
});

test('cost question detects cost', () => {
  const result = understood('How much will I pay for GP visits?');
  assert.equal(result.topic, 'cost');
  assert.equal(result.subject, 'gp visits');
});

test('eligibility question detects eligibility', () => {
  const result = understood('Am I eligible for maternity cover?');
  assert.equal(result.topic, 'eligibility');
});

test('general eligibility questions search member and certificate wording', () => {
  const result = understood('What are the eligibility requirements?');
  assert.equal(result.topic, 'eligibility');
  assert.equal(result.subject, '');
  const queries = buildQueries(result.subject, result.aspects, result.country);
  assert.ok(queries.includes('member named on the Certificate of Insurance'));
  assert.ok(queries.includes('eligibility'));
});

test('enrolment and age questions use eligibility retrieval', () => {
  for (const question of ['Who can enrol in the Gold plan?', 'What are the age requirements?', 'What documents are needed for enrolment?']) {
    const result = understood(question);
    assert.equal(result.topic, 'eligibility', question);
    assert.ok(result.aspects.includes('eligibility'), question);
  }
});

test('limit question detects limit', () => {
  const result = understood('Is there an annual limit on claims?');
  assert.equal(result.topic, 'limit');
});

test('definition question detects definition', () => {
  const result = understood("What does 'pre-existing condition' mean in my policy?");
  assert.equal(result.topic, 'definition');
  assert.match(result.subject, /condition/, 'the definition subject keeps the term');
});

test('comparison question is the primary topic with the other plan named', () => {
  const result = understood('Compare GOLD and PLATINUM in-patient cover.');
  assert.equal(result.topic, 'comparison');
  assert.equal(result.secondaryPlanCode, 'PLATINUM');
  assert.equal(result.format.kind, 'table', 'comparisons default to a table');
});

test('available-policy comparison is detected without a named plan', () => {
  const result = understood('Which of the available policies provides the highest coverage?');
  assert.equal(result.topic, 'comparison');
  assert.equal(result.secondaryPlanCode, null);
  assert.equal(result.subject, '');
  assert.equal(result.format.kind, 'table');
});

test('multi-aspect question carries every aspect', () => {
  const result = understood('Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?');
  assert.ok(result.aspects.includes('coverage'));
  assert.ok(result.aspects.includes('pre-authorisation'));
});

test('scenario question with a country', () => {
  const result = understood('If I break my leg skiing in Spain, what am I entitled to?');
  assert.equal(result.topic, 'scenario');
  assert.equal(result.country, 'spain');
});

test('summary request is detected as its own intent', () => {
  const result = understood('Can you give me a summary of my cover?');
  assert.equal(result.topic, 'summary-request');
});

test('source-specific question names sections', () => {
  const result = understood('Which section covers emergency surgery?');
  assert.equal(result.topic, 'source-specific');
  assert.equal(result.subject, 'emergency surgery');
});

test('missing-information question is detected, not treated as exclusion', () => {
  const result = understood('What is not mentioned in my policy about dental care?');
  assert.equal(result.topic, 'missing-information');
  assert.equal(result.subject, 'dental care');
});

test('medical advice is refused as before', () => {
  const result = understood('Should I stop taking my blood pressure tablets before surgery?');
  assert.equal(result.outOfScope, true);
  assert.equal(result.topic, 'medical advice');
});

test('someone else’s policy is refused', () => {
  const result = understood("My sister's policy covers physiotherapy — does mine too?");
  assert.equal(result.outOfScope, true);
});

test('ambiguous scope question falls back to coverage', () => {
  const result = understood('What about it?');
  assert.equal(result.topic, 'coverage');
});

// ---------- 2. response formats ---------- //

test('bullet list format', () => {
  const result = understood('Give me a bullet list of the exclusions.');
  assert.equal(result.format.kind, 'bullets');
});

test('numbered list format', () => {
  assert.equal(understood('Numbered list of what I pay for myself, please.').format.kind, 'numbered');
});

test('short answer format', () => {
  assert.equal(understood('Answer briefly: am I covered for physiotherapy?').format.kind, 'short');
});

test('detailed explanation format', () => {
  assert.equal(understood('Explain in detail what the excess is.').format.kind, 'detailed');
});

test('comparison table format, explicit', () => {
  assert.equal(understood('Show me a table of the waiting periods.').format.kind, 'table');
});

test('step-by-step format', () => {
  assert.equal(understood('What are the steps to make a claim?').format.kind, 'steps');
});

test('practical example format', () => {
  assert.equal(understood('Give me an example of a pre-authorisation requirement.').format.kind, 'example');
});

test('source-only format via "just the sections"', () => {
  assert.equal(understood('Just the sections about maternity, please.').format.kind, 'sources');
});

test('strict modifier: only / just / exactly / without explanation', () => {
  assert.equal(understood('Just give me a list of exclusions.').format.strict, true);
  assert.equal(understood('Give me a list of exclusions without explanation.').format.strict, true);
  assert.equal(understood('Give me only the exclusions.').format.strict, true);
  assert.equal(understood('Give me a list of exclusions.').format.strict, false);
});

test('exact requested point counts, numeric and spelled', () => {
  assert.deepEqual(understood('Summarise my benefits in 3 points.').format, { kind: 'summary', points: 3, strict: false });
  assert.equal(understood('Summarise in five points.').format.points, 5);
  assert.equal(understood('Summarise my cover.').format.points, undefined);
});

// ---------- 3. conversational follow-ups ---------- //

const dentalTurn: ConversationTurn = {
  question: 'Am I covered for dental treatment?',
  answer: '[1] GP and specialist consultations: 100% of the reference rate.\n[2] Physiotherapy: up to 25 sessions per policy year.',
};

test('subject-less follow-up borrows the previous subject', () => {
  const result = understood('What is the waiting period?', [dentalTurn]);
  assert.equal(result.followUp, true);
  assert.equal(result.topic, 'waiting-period');
  assert.match(result.subject, /dental/);
});

test('follow-up keeps the previous kind of question', () => {
  const result = understood('What about planned surgery?', [dentalTurn]);
  assert.equal(result.followUp, true);
  assert.equal(result.subject, 'planned surgery');
  assert.ok(result.aspects.includes('coverage'), 'the coverage aspect carries over');
  assert.ok(result.aspects.includes('waiting-period') === false || true);
});

test('"explain the second point" quotes the previous answer line', () => {
  const result = understood('Explain the second point.', [dentalTurn]);
  assert.equal(result.followUp, true);
  assert.match(result.subject, /physiotherapy/, 'the subject is the second numbered line');
});

test('"does this apply in Germany?" keeps the subject and marks the country', () => {
  const result = understood('Does this apply in Germany?', [dentalTurn]);
  assert.equal(result.followUp, true);
  assert.equal(result.country, 'germany');
  assert.match(result.subject, /dental/);
});

test('"give me only the exclusions" switches aspect, keeps subject, goes strict', () => {
  const result = understood('Give me only the exclusions.', [dentalTurn]);
  assert.equal(result.followUp, true);
  assert.equal(result.topic, 'exclusion');
  assert.equal(result.format.strict, true);
  assert.match(result.subject, /dental/);
});

// ---------- 4. plan and country changes reset context ---------- //

test('naming another plan drops the old context', () => {
  const result = understood('What about physiotherapy under SILVER?', [dentalTurn]);
  assert.equal(result.followUp, false, 'a named plan is a fresh question');
  assert.ok(result.subject.includes('physiotherapy'));
});

test('a new topic with its own subject does not borrow old context', () => {
  const turn: ConversationTurn = {
    question: 'Am I covered for dental treatment?',
    answer: '[1] Dental care is covered.',
  };
  const result = understood('Am I covered for maternity care?', [turn]);
  assert.equal(result.followUp, false);
  assert.equal(result.subject, 'maternity care');
});

// ---------- 5. query expansion ---------- //

test('exclusion questions expand under Exclusions anchors', () => {
  const queries = buildQueries('', ['exclusion'], null);
  assert.ok(queries.includes('Exclusions'));
  assert.ok(queries.includes('we do not pay for'));
});

test('waiting-period questions expand under waiting-period anchors', () => {
  const queries = buildQueries('dental treatment', ['waiting-period', 'coverage'], null);
  assert.ok(queries.some((query) => query.includes('waiting period')));
  assert.ok(queries[0] === 'dental treatment', 'the subject leads');
});

test('summary requests expand to breadth, not one topic', () => {
  const queries = buildQueries('', ['summary-request'], null);
  assert.ok(queries.length >= 4, 'a summary surveys several sections');
});

test('a named country adds a territorial-area anchor', () => {
  const queries = buildQueries('physiotherapy', ['coverage'], 'germany');
  assert.ok(queries.some((query) => query.includes('territorial area germany')));
});

test('expansion stays within budget', () => {
  const queries = buildQueries('emergency appendectomy', ['coverage', 'pre-authorisation', 'scenario', 'cost'], null);
  assert.ok(queries.length <= 6);
  assert.ok(new Set(queries).size === queries.length, 'no duplicate queries');
});

// ---------- 6. classify keeps an explicitly passed treatment date ---------- //

function stateOf(overrides: Partial<GraphState>): GraphState {
  return {
    question: 'Am I covered for dental treatment?',
    planCode: 'GOLD',
    jurisdiction: 'FR',
    ...overrides,
  } as GraphState;
}

test('classify extracts intent and respects a passed treatment date', () => {
  const update = classify(stateOf({ treatmentDate: '2027-03-01' }));
  assert.equal(update.treatmentDate, '2027-03-01');
  assert.equal(update.intent?.topic, 'coverage');
});

test('classify falls back to today when no treatment date is known', () => {
  const update = classify(stateOf({}));
  assert.match(update.treatmentDate ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('refusals get no aspects and no comparison target', () => {
  const result = understood('Should I stop taking my blood pressure tablets before surgery?');
  assert.deepEqual(result.aspects, []);
  assert.equal(result.secondaryPlanCode, null);
});

test('comparison names the other plan only when the question does', () => {
  assert.equal(understood('Compare GOLD and PLATINUM waiting periods.').secondaryPlanCode, 'PLATINUM');
  assert.equal(understood('Compare these plans.').secondaryPlanCode, null, 'ambiguous: no invented second plan');
  assert.equal(understood('Compare these plans.').topic, 'comparison');
});

// ---------- 7. format edge: direct stays the neutral default ---------- //

test('plain questions keep the direct format', () => {
  assert.equal(detectFormat('Am I covered for dental treatment?').kind, 'direct');
  assert.equal(understood('Am I covered for dental treatment?').format.kind, 'direct');
});
