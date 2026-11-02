// Checks the API server over HTTP with fetch, one run per way the graph can end, plus the
// request-validation rules (which need no DB and are checked through the server too).
// Start the server first (npm run api), then: npm run api:check
// Exits non-zero if any check fails, so it can be re-run any time.

const BASE_URL = process.env.API_URL ?? 'http://localhost:8080';

const scenarios = [
  {
    name: 'Gold France coverage question → answered',
    body: {
      question: 'Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 1 },
  },
  {
    name: 'Medical advice question → refused',
    body: {
      question: 'Should I stop taking my blood pressure tablets before surgery?',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'refused', minCitations: 0 },
  },
  {
    name: 'BRONZE France (no such policy) → human-review',
    body: {
      question: 'Am I covered for physiotherapy after an injury?',
      planCode: 'BRONZE',
      jurisdiction: 'FR',
    },
    expect: { status: 'human-review', minCitations: 0 },
  },
  // --- new in the question-understanding phase ---
  {
    name: 'Exclusion question → answered as a bullet list',
    body: {
      question: 'Just give me a list of what is excluded from my plan.',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 1, answerMatches: /^- /, why: 'a strict list request renders bullets' },
  },
  {
    name: 'Short answer request → answered in one line',
    body: {
      question: 'Answer briefly: am I covered for physiotherapy?',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 1, answerMatches: /^[^\n]+$/, why: '"briefly" means one claim' },
  },
  {
    name: 'Summary with a requested point count → exactly 3 points',
    body: {
      question: 'Summarise my benefits in 3 points.',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 3, answerMatches: /^(Key points:\n)?1\. .*\n2\. .*\n3\. /, why: 'exactly the three requested points' },
  },
  {
    name: 'Comparison across two plans → table naming both policies',
    body: {
      question: 'Compare GOLD and PLATINUM waiting periods for planned surgery.',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 1, answerMatches: /Platinum/, why: 'PLATINUM is searched alongside GOLD' },
  },
  {
    name: 'Missing information question → answered, reported as missing (no invented exclusion)',
    body: {
      question: 'What is not mentioned in my policy about dental care?',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 0, answerMatches: /couldn't find anything about dental/, why: 'the gap is stated, not invented' },
  },
  // --- new in the LLM-nodes phase (Phase 8) ---
  {
    name: 'Detailed explanation → answered with supporting quotes',
    body: {
      question: 'Explain in detail what the excess is.',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 1 },
  },
  {
    name: 'Unsupported question → human-review, nothing invented',
    body: {
      question: 'What is covered for scuba diving accidents? Answer shortly if you can.',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'human-review', minCitations: 0 },
  },
  {
    name: 'Follow-up with history → answered against the previous subject',
    body: {
      question: 'What is the waiting period?',
      planCode: 'GOLD',
      jurisdiction: 'FR',
      history: [
        { question: 'Am I covered for dental treatment?', answer: '[1] GP and specialist consultations: 100% of the reference rate.' },
      ],
    },
    expect: { status: 'answered', minCitations: 1 },
  },
  {
    name: 'Follow-up without history → still answered (compatible with old clients)',
    body: {
      question: 'What is the waiting period for planned surgery?',
      planCode: 'GOLD',
      jurisdiction: 'FR',
    },
    expect: { status: 'answered', minCitations: 1 },
  },
] as const;

let failures = 0;

// Optional re-run filter: SCENARIOS="3,5" runs only those numbered scenarios. The LLM
// nodes spend a small free-tier daily quota per model, so a run that ran out of quota can
// be finished with the missing scenarios alone on fresh quota, instead of repeating the
// whole matrix. Filtered scenarios don't count toward the failure total — their earlier
// result stands.
const only = process.env.SCENARIOS
  ? new Set(process.env.SCENARIOS.split(',').map(Number))
  : null;

async function postAsk(body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}/api/ask`, { method: 'POST', body: JSON.stringify(body) });
}

for (const [index, { name, body, expect }] of scenarios.entries()) {
  if (only && !only.has(index + 1)) continue;
  const response = await postAsk(body);
  if (!response.ok) {
    console.log(`FAIL  ${name}: HTTP ${response.status} ${await response.text()}`);
    failures += 1;
    continue;
  }
  const answer = (await response.json()) as {
    status: string;
    answer?: string;
    citations: string[];
    policy: { title: string; version: string } | null;
    revisions: number;
    intent: { topic: string; outOfScope: boolean } | null;
  };
  const matches = 'answerMatches' in expect && expect.answerMatches
    ? expect.answerMatches.test(answer.answer ?? '')
    : true;
  const ok = answer.status === expect.status
    && answer.citations.length >= expect.minCitations
    && matches;
  if (!ok) {
    console.log(`FAIL  ${name}: status=${answer.status} citations=${answer.citations.length}`);
    if ('answerMatches' in expect && expect.answerMatches && !matches) {
      console.log(`      answer did not match ${expect.answerMatches}`);
      console.log(`      got: ${JSON.stringify((answer.answer ?? '').slice(0, 200))}`);
    }
    failures += 1;
    continue;
  }
  console.log(`PASS  ${name}`);
  console.log(
    `      status=${answer.status} citations=${answer.citations.length} ` +
      `policy=${answer.policy ? `"${answer.policy.title}" ${answer.policy.version}` : 'none'} ` +
      `revisions=${answer.revisions}`,
  );
  // A politeness gap: the LLM nodes answer from a free tier that allows 5 requests per
  // minute, so back-to-back scenarios would spend one scenario tripping the next.
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

// Health endpoint.
{
  const response = await fetch(`${BASE_URL}/api/health`);
  const body = (await response.json()) as { status: string };
  if (response.ok && body.status === 'ok') {
    console.log('PASS  GET /api/health');
  } else {
    console.log(`FAIL  GET /api/health: HTTP ${response.status} ${JSON.stringify(body)}`);
    failures += 1;
  }
}

// Invalid requests must be rejected before anything reaches the graph — the status codes
// prove the server's validation, one rule each.
const badRequests = [
  ['not JSON', { bad: 'json' }, 'raw' as const, 400],
  ['lowercase planCode', { question: 'hi', planCode: 'gold', jurisdiction: 'FR' }, 'json' as const, 400],
  ['empty question', { question: '   ', planCode: 'GOLD', jurisdiction: 'FR' }, 'json' as const, 400],
  ['bad treatmentDate', { question: 'hi', planCode: 'GOLD', jurisdiction: 'FR', treatmentDate: 'tomorrow' }, 'json' as const, 400],
  ['bad history (not an array)', { question: 'hi', planCode: 'GOLD', jurisdiction: 'FR', history: 'yesterday' }, 'json' as const, 400],
  ['bad history turn (no question)', { question: 'hi', planCode: 'GOLD', jurisdiction: 'FR', history: [{ answer: 'x' }] }, 'json' as const, 400],
] as const;
for (const [name, body, mode, expected] of badRequests) {
  const response = mode === 'raw' ? await fetch(`${BASE_URL}/api/ask`, { method: 'POST', body: 'not json' }) : await postAsk(body);
  if (response.status === expected) {
    console.log(`PASS  reject ${name} (HTTP ${response.status})`);
  } else {
    console.log(`FAIL  reject ${name}: got HTTP ${response.status}, wanted ${expected}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll API checks passed.');
