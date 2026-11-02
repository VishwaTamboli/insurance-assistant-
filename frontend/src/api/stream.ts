import { ApiError } from './client';
import type { AnswerRequest, AnswerResponse, AuditInfo, IntentInfo, PolicyInfo } from './types';

// Typed SSE client for POST /api/ask/stream (phase 5 counterpart of client.ask).
// Events follow the backend contract in docs/frontend-plan.md: stage, policy, final,
// error — with one final as the last event of a completed run.

// Stages, in the order the backend graph can produce them.
export type StageName = 'classify' | 'expand' | 'retrieve' | 'research' | 'audit' | 'human-review' | 'synthesize';

const STAGE_NAMES: readonly StageName[] = [
  'classify',
  'expand',
  'retrieve',
  'research',
  'audit',
  'human-review',
  'synthesize',
];

export type StreamEvent =
  | { type: 'stage'; stage: StageName; intent?: IntentInfo | null; audit?: AuditInfo | null }
  | { type: 'policy'; policy: PolicyInfo | null }
  | { type: 'final'; response: AnswerResponse }
  | { type: 'error'; message: string };

export interface StreamOptions {
  signal?: AbortSignal; // aborting the underlying fetch cleanly ends the stream
}

export async function* askStream(
  input: AnswerRequest,
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch('/api/ask/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause; // a cancel, not an error
    throw new ApiError(0, 'Could not reach the assistant. Check your connection and try again.');
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { error?: string } | null)?.error;
    throw new ApiError(response.status, message ?? `The request failed (HTTP ${response.status}).`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError(0, 'Your browser cannot stream the answer as it is prepared.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = parseEventBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new ApiError(0, 'The connection to the assistant was lost.');
  } finally {
    try {
      await reader.cancel(); // no dangling body when the generator exits for any reason
    } catch {
      // the stream may already be closed; nothing to clean up then
    }
  }
}

// One parsed SSE block. Malformed blocks (missing lines, broken JSON, unknown event)
// are dropped rather than breaking the stream — the final event is what must survive.
function parseEventBlock(block: string): StreamEvent | null {
  const eventLine = block.split('\n').find(line => line.startsWith('event:'));
  const dataLine = block.split('\n').find(line => line.startsWith('data:'));
  if (!eventLine || !dataLine) return null;

  const name = eventLine.slice('event:'.length).trim();
  let data: unknown;
  try {
    data = JSON.parse(dataLine.slice('data:'.length).trim());
  } catch {
    return null;
  }

  switch (name) {
    case 'stage': {
      const { stage, intent, audit } = data as { stage?: unknown; intent?: IntentInfo; audit?: AuditInfo };
      if (typeof stage !== 'string' || !STAGE_NAMES.includes(stage as StageName)) return null;
      return { type: 'stage', stage: stage as StageName, intent, audit };
    }
    case 'policy': {
      const { policy } = data as { policy?: PolicyInfo | null };
      return { type: 'policy', policy: policy ?? null };
    }
    case 'final': {
      const response = data as Partial<AnswerResponse> | null;
      if (typeof response?.status !== 'string' || typeof response?.answer !== 'string') return null;
      return { type: 'final', response: response as AnswerResponse };
    }
    case 'error': {
      const { error } = data as { error?: string };
      return typeof error === 'string' ? { type: 'error', message: error } : null;
    }
    default:
      return null;
  }
}
