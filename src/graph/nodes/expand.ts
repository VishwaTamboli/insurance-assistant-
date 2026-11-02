import type { GraphState, GraphUpdate } from '../state.ts';
import type { Aspect } from '../understanding.ts';
import { log } from './log.ts';

// The query expander still rewrites the question in the policy's own words — but now from
// the question understanding instead of three fixed strings. Each detected aspect gets
// one retrieval anchor in the wording the policy sections actually use (Exclusions,
// Waiting periods, Pre-authorisation…), so exclusion questions are searched under
// Exclusions and waiting-period questions under Waiting periods instead of everything
// under emergency queries. Subject-leading queries keep "what about planned surgery?"
// follow-ups on their resolved subject.

// Polished anchors per aspect, phrased in policy vocabulary. One query per anchor, so a
// comparison question expands like a coverage question (anchors are also retrieval
// dimensions worth comparing).
const ANCHORS: Record<Aspect, string[]> = {
  coverage: ['hospital treatment cover', 'treatment abroad'],
  exclusion: ['Exclusions', 'we do not pay for'],
  benefit: ['hospital benefits', 'out-patient benefits consultations'],
  'waiting-period': ['waiting period'],
  'pre-authorisation': ['pre-authorisation', 'notify emergency admission'],
  cost: ['excess claim', 'cost sharing deductible'],
  // Eligibility questions need the policy's actual enrolment vocabulary. The Gold FR
  // document expresses this through the Definitions section and the Certificate of
  // Insurance rather than a standalone "eligibility" heading.
  eligibility: [
    'eligibility',
    'eligible members',
    'member named on the Certificate of Insurance',
    'membership enrolment',
    'age residency enrolment requirements',
  ],
  limit: ['annual limit'],
  definition: ['Definitions'],
  scenario: ['emergency treatment', 'Exclusions', 'waiting period'],
  'summary-request': ['hospital treatment', 'treatment abroad', 'out-patient benefits', 'waiting period', 'Exclusions'],
  'source-specific': ['hospital treatment cover'],
  'missing-information': [],
  comparison: ['hospital treatment cover', 'treatment abroad', 'annual limit', 'Exclusions'],
};

const MAX_QUERIES = 6;

export function expand(state: GraphState): GraphUpdate {
  const intent = state.intent!;
  const queries = buildQueries(intent.subject, intent.aspects, intent.country);
  return log('expand', { queries }, `${queries.length} queries from ${intent.aspects.join(' + ')}`);
}

export function buildQueries(subject: string, aspects: Aspect[], country: string | null): string[] {
  const queries: string[] = [];
  if (subject) queries.push(subject); // the member's own words first, kept verbatim

  for (const aspect of aspects) {
    for (const anchor of ANCHORS[aspect]) {
      // Heading-word anchors (Exclusions, Definitions) reach their section best on their
      // own; the rest soak up the subject so the section found is about the subject.
      queries.push(subject && aspect !== 'exclusion' && aspect !== 'definition' ? `${anchor} ${subject}` : anchor);
    }
  }
  // A question naming a country is asking a cross-border question, so the territorial-area
  // wording the policies use ("Treatment abroad", "territorial area") anchors it too.
  if (country) queries.push(`treatment abroad territorial area ${country}`);

  return [...new Set(queries)].slice(0, MAX_QUERIES);
}
