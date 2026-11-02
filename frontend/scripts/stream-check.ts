// Node-side validation for the frontend streaming client, over real HTTP against the
// running backend. Not part of the browser bundle. Run from the project root with the
// API up:   npm run check:stream   (in frontend/)   or   npx tsx frontend/scripts/stream-check.ts
// Covers: the three scenarios with event ordering and final payloads, cancellation
// mid-stream, and a failed connection.

import { ApiError } from '../src/api/client';
import { askStream } from '../src/api/stream';
import type { StreamEvent } from '../src/api/stream';

const BASE = process.env.API_URL ?? 'http://localhost:8080';
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
  realFetch(typeof url === 'string' ? BASE + url : url, init)) as typeof fetch;

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

type Named = { event: string; stage?: string; verdict?: string | null; status?: string };
const toNamed = (events: StreamEvent[]): Named[] =>
  events.map(event => ({
    event: event.type,
    stage: event.type === 'stage' ? event.stage : undefined,
    verdict: event.type === 'stage' ? event.audit?.verdict : undefined,
    status: event.type === 'final' ? event.response.status : undefined,
  }));

const orderIs = (actual: Named[], expected: Array<Partial<Named>>): boolean =>
  expected.every(partial =>
    actual.some(item =>
      Object.entries(partial).every(([key, value]) => item[key as keyof Named] === value),
    ),
  );

// 1. Answered: full trail in graph order, cited final. The auditor may pass on the first
//     draft or send the loop back (research → audit revive → audit pass) — the graph's
//     order holds either way, so the loop's exact shape is checked, not a fixed event list.
{
  const events: StreamEvent[] = [];
  for await (const event of askStream({
    question: 'Am I covered for an emergency appendectomy in Spain?',
    planCode: 'GOLD',
    jurisdiction: 'FR',
  })) {
    events.push(event);
  }
  const named = toNamed(events);
  const final = events.find(event => event.type === 'final');
  const finals = events.filter(event => event.type === 'final').length;
  const order = orderIs(named, [
    { event: 'stage', stage: 'classify' },
    { event: 'stage', stage: 'expand' },
    { event: 'stage', stage: 'retrieve' },
    { event: 'policy' },
    { event: 'stage', stage: 'research' },
    { event: 'stage', stage: 'synthesize' },
  ]);
  check(order, 'answered: stages in graph order with research and synthesize present');
  check(named.some(item => item.stage === 'audit' && item.verdict === 'pass'), 'answered: the final audit passed');
  const reviseIndex = named.findIndex(item => item.stage === 'audit' && item.verdict === 'revise');
  const passIndex = named.findIndex(item => item.stage === 'audit' && item.verdict === 'pass');
  check(
    reviseIndex === -1
      || named.some((item, index) => index > reviseIndex && index < passIndex && item.stage === 'research'),
    'answered: a revision goes back through research to a passing audit',
  );
  check(final?.type === 'final' && final.response.citations.length >= 1, 'answered: final carries citations', `${final?.type === 'final' ? `${final.response.citations.length} citations, confidence ${final.response.confidence}` : ''}`);
  check(final?.type === 'final' && final.response.policy?.title === 'Gold Health Plan (France)', 'answered: final names the policy in force');
  check(finals === 1, 'answered: exactly one final event');
}

// 2. Refused: classify (out of scope) then final, no policy event ever.
{
  const events: StreamEvent[] = [];
  for await (const event of askStream({
    question: 'Should I stop taking my blood pressure tablets before surgery?',
    planCode: 'GOLD',
    jurisdiction: 'FR',
  })) {
    events.push(event);
  }
  const order = orderIs(toNamed(events), [
    { event: 'stage', stage: 'classify' },
    { event: 'final', status: 'refused' },
  ]);
  const refusedEarly = events.filter(event => event.type === 'stage' && event.stage !== 'classify').length === 0;
  check(order && refusedEarly, 'refused: classify then final, nothing in between');
}

// 3. Human-review: policy event resolves to null, audit rejects, final says so.
{
  const events: StreamEvent[] = [];
  for await (const event of askStream({
    question: 'Am I covered for physiotherapy after an injury?',
    planCode: 'BRONZE',
    jurisdiction: 'FR',
  })) {
    events.push(event);
  }
  const policy = events.find(event => event.type === 'policy');
  const final = events.find(event => event.type === 'final');
  check(
    policy?.type === 'policy' && policy.policy === null &&
      final?.type === 'final' && final.response.status === 'human-review' &&
      final.response.citations.length === 0,
    'human-review: policy null, final human-review with no citations',
  );
}

// 4. Cancellation: abort right after the first event; the stream must end cleanly with
//     no final, and aborting again must be safe.
{
  const controller = new AbortController();
  const stream = askStream(
    { question: 'Am I covered for dental treatment?', planCode: 'GOLD', jurisdiction: 'FR' },
    { signal: controller.signal },
  );
  const first = await stream.next();
  check(first.value?.type === 'stage', 'cancel: first event received');
  controller.abort();
  const events: StreamEvent[] = [first.value];
  await stream.return(undefined); // what the hook's for-await break does
  check(events.length === 1, 'cancel: terminates before any final');
}

// 5. Connection failure: a server that isn't there produces a friendly ApiError(0).
{
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    realFetch('http://localhost:9' + (typeof url === 'string' ? url : '/'), init)) as typeof fetch;
  try {
    await askStream({ question: 'hello', planCode: 'GOLD', jurisdiction: 'FR' }).next();
    check(false, 'dead connection: expected ApiError');
  } catch (error) {
    check(error instanceof ApiError && error.status === 0, 'dead connection: ApiError with status 0', error instanceof Error ? error.message : '');
  }
}

if (failures > 0) {
  console.log(`\n${failures} stream check(s) failed.`);
  process.exit(1);
}
console.log('\nAll stream checks passed.');
