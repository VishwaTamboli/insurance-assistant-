import type { IncomingMessage, ServerResponse } from 'node:http';
import { Overwrite } from '@langchain/langgraph';
import type { OverwriteValue } from '@langchain/langgraph';
import { app } from '../../graph/graph.ts';
import type { GraphState, GraphUpdate } from '../../graph/state.ts';
import { addRevisions, mergeEvidence } from '../../graph/state.ts';
import type { AnswerRequest } from '../types.ts';
import { graphInputOf, mapStateToResponse } from './ask.ts';

// The handler for POST /api/ask/stream. Same run, same request body and same final payload
// as POST /api/ask — but streamed while the graph works, using app.stream with
// streamMode 'updates': one chunk per node, containing exactly what that node wrote.

const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // don't buffer in reverse proxies, so events arrive as written
};

type SseEvent = { event: string; data: unknown };

export async function handleAskStream(
  req: IncomingMessage,
  res: ServerResponse,
  input: AnswerRequest,
): Promise<void> {
  // A disconnect can happen anywhere in the loop; every write checks this flag first.
  let closed = false;
  const onDisconnect = () => {
    closed = true;
  };
  req.on('close', onDisconnect);
  // An aborted client can surface later as an async error on the response (EPIPE): the
  // same disconnect, so arm it with the same flag instead of letting it crash the server.
  res.on('error', onDisconnect);

  res.writeHead(200, STREAM_HEADERS);

  const graphInput = graphInputOf(input);
  const events = await app.stream(graphInput, { streamMode: 'updates' });

  // The state accumulated so far. Applying the graph's own reducers to each update keeps
  // it identical to the final state app.invoke would return, so the last event can use
  // the same mapper as POST /api/ask without duplicating any reduction logic.
  const partial: Partial<GraphState> = { evidence: [], queryEvidence: [], revisions: 0 };
  let failed = false; // set when an error event was sent: no final event after that

  try {
    for await (const chunk of events) {
      if (closed) break;

      for (const [node, update] of Object.entries(chunk as Record<string, GraphUpdate>)) {
        if (closed) break;
        if (!update || Object.keys(update).length === 0) continue;

        mergeUpdate(partial, update);
        for (const { event, data } of nodeEvents(node, update)) {
          if (closed) break;
          if (!writeEvent(res, event, data)) closed = true;
        }
      }
    }
  } catch (error) {
    console.error('[api] stream failed:', error);
    failed = true;
    if (!closed) writeEvent(res, 'error', { error: 'Something went wrong. Please try again.' });
  } finally {
    // One final event no matter how the run concluded (including a refusal, which never
    // reaches synthesize), so the stream ends with the same contract as POST /api/ask —
    // unless an error was already reported, when the partial state means nothing.
    if (!closed && !failed) {
      writeEvent(res, 'final', mapStateToResponse(partial as GraphState));
    }
    req.off('close', onDisconnect);
    res.off('error', onDisconnect);
    if (!res.writableEnded) res.end();
  }
}

// Fold one node's update into the accumulated state, with the graph's own reducers.
// Graph channels with reducers accept either a plain value or an OverwriteValue (a
// bypass-reducer marker); this graph's nodes always return plain values, but unwrap
// defensively in case LangGraph re-wraps a message.
function unwrap<T>(value: T | OverwriteValue<T>): T {
  return Overwrite.isInstance(value) ? (value.value as unknown as T) : (value as unknown as T);
}

function mergeUpdate(partial: Partial<GraphState>, update: GraphUpdate): void {
  if (update.evidence) partial.evidence = mergeEvidence(partial.evidence ?? [], unwrap(update.evidence));
  if (update.queryEvidence) partial.queryEvidence = [...(partial.queryEvidence ?? []), ...unwrap(update.queryEvidence)];
  if (update.revisions) partial.revisions = addRevisions(partial.revisions ?? 0, unwrap(update.revisions));
  // Channels without a reducer keep the last value a node wrote to them.
  for (const field of ['intent', 'treatmentDate', 'queries', 'selectedPolicy', 'draft', 'audit', 'final'] as const) {
    if (update[field] !== undefined) (partial as Record<string, unknown>)[field] = update[field];
  }
}

// The events one node's update produces. Stage names follow the graph; audit gets its
// verdict attached so the UI can show the loop, and retrieve may carry the policy card.
function nodeEvents(node: string, update: GraphUpdate): SseEvent[] {
  switch (node) {
    case 'classify':
      return [{ event: 'stage', data: { stage: 'classify', intent: update.intent ?? null } }];
    case 'retrieve': {
      const events: SseEvent[] = [{ event: 'stage', data: { stage: 'retrieve' } }];
      // Either the resolved document or null (no policy in force — a human-review run).
      if ('selectedPolicy' in update) events.push({ event: 'policy', data: { policy: update.selectedPolicy ?? null } });
      return events;
    }
    case 'auditDraft':
      return [{ event: 'stage', data: { stage: 'audit', audit: update.audit ?? null } }];
    case 'humanReview':
      return [{ event: 'stage', data: { stage: 'human-review' } }];
    default:
      // expand, research, synthesize: the plain step name is enough.
      return [{ event: 'stage', data: { stage: node } }];
  }
}

// Write one event; false when the socket refused it (client gone).
function writeEvent(res: ServerResponse, event: string, data: unknown): boolean {
  if (res.writableEnded) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}
