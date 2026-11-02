// Labelled questions for the recall check (npm run eval:recall).
// Each one says which policy applies and which section(s) a human expert would need to
// answer it. Labels are section paths, not chunk ids: ids change on every re-ingest,
// section paths don't. Write the label from the policy text, never from search results.
//
// Most queries are short search phrases, the kind the `expand` node (step 4) will write,
// in a member's words rather than copied from the headings. The last two are a member's
// whole question, sent as one query, to show what happens without `expand`.

export interface LabelledQuestion {
  plan: string;
  country: string;
  date: string;       // date of treatment: picks the version in force
  query: string;
  expected: string[]; // metadata.section of every chunk needed to answer it
  tests: string;      // what this question checks
}

const TODAY = '2026-10-27';
const MAIN_QUESTION = 'Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?';

export const questions: LabelledQuestion[] = [
  // Gold FR 2026: the main policy
  { plan: 'GOLD', country: 'FR', date: TODAY, query: 'emergency surgery abroad',
    expected: ['3. Treatment abroad > 3.1 Emergency treatment in the territorial area'],
    tests: 'the main case' },
  { plan: 'GOLD', country: 'FR', date: TODAY, query: 'day 91 of a trip',
    expected: ['3. Treatment abroad > 3.1 Emergency treatment in the territorial area'],
    tests: 'an exact number' },
  { plan: 'GOLD', country: 'FR', date: TODAY, query: 'must I tell you about an emergency admission',
    expected: ['4. Pre-authorisation'],
    tests: 'paraphrase: "tell" vs "notify"' },
  { plan: 'GOLD', country: 'FR', date: TODAY, query: 'flown home to France after falling ill abroad',
    expected: ['3. Treatment abroad > 3.4 Medical repatriation'],
    tests: 'paraphrase: "flown home" vs "repatriation"' },
  { plan: 'GOLD', country: 'FR', date: TODAY, query: 'having a baby',
    expected: ['6. Maternity'],
    tests: 'paraphrase: "baby" vs "pregnancy and childbirth"' },
  { plan: 'GOLD', country: 'FR', date: TODAY, query: 'treatment in the USA',
    expected: ['3. Treatment abroad > 3.2 Emergency treatment outside the territorial area', '8. Exclusions'],
    tests: 'two sections needed' },

  // Gold FR 2025: the expired version, picked by the date of treatment
  { plan: 'GOLD', country: 'FR', date: '2025-06-15', query: 'emergency surgery abroad',
    expected: ['3. Treatment abroad > 3.1 Emergency treatment in the territorial area'],
    tests: 'expired version, by date' },

  // Silver: the waiting period applies to emergencies too
  { plan: 'SILVER', country: 'FR', date: TODAY, query: 'waiting period for an emergency',
    expected: ['6. Waiting periods'],
    tests: 'Silver waiting-period trap' },
  { plan: 'SILVER', country: 'FR', date: TODAY, query: 'is appendicitis an accident',
    expected: ['1. Definitions'],
    tests: 'a definition decides the answer' },

  // Essential: "covered in full" in section 2, overridden by "France only" in section 3
  { plan: 'ESSENTIAL', country: 'FR', date: TODAY, query: 'emergency surgery abroad',
    expected: ['2. Hospital benefits', '3. Where you are covered'],
    tests: 'Essential override trap' },
  { plan: 'ESSENTIAL', country: 'FR', date: TODAY, query: 'travel add-on cover',
    expected: ['3. Where you are covered > 3.1 Essential Travel add-on'],
    tests: 'the add-on' },

  // Platinum: the prompt injection sits inside section 4; retrieval must still find section 4
  { plan: 'PLATINUM', country: 'FR', date: TODAY, query: 'approval before planned surgery',
    expected: ['4. Pre-authorisation'],
    tests: 'section with the injection' },

  // Gold US: US spelling and US words
  { plan: 'GOLD', country: 'US', date: TODAY, query: 'pre-authorisation',
    expected: ['5. Prior authorization'],
    tests: 'UK spelling, US policy' },
  { plan: 'GOLD', country: 'US', date: TODAY, query: 'emergency care abroad',
    expected: ['6. Coverage outside the United States'],
    tests: 'paraphrase: "abroad"' },
  { plan: 'GOLD', country: 'US', date: TODAY, query: 'how much do I pay before the plan pays',
    expected: ['2. Cost sharing'],
    tests: 'paraphrase: "deductible"' },

  // The member's whole question as one query (no `expand` yet). Answering it needs several
  // sections: the definitions (Spain is in the territorial area; appendicitis is an
  // emergency, and on Silver not an accident), the cover abroad, and the notification rule.
  { plan: 'GOLD', country: 'FR', date: TODAY, query: MAIN_QUESTION,
    expected: ['1. Definitions', '3. Treatment abroad > 3.1 Emergency treatment in the territorial area', '4. Pre-authorisation'],
    tests: 'whole question: 3 sections' },
  { plan: 'SILVER', country: 'FR', date: TODAY, query: MAIN_QUESTION,
    expected: ['1. Definitions', '3. Treatment abroad > 3.1 Emergency treatment in the territorial area', '4. Pre-authorisation', '6. Waiting periods'],
    tests: 'whole question: 4 sections, more than K' },
];
