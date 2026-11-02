import type { AnswerRequest, AnswerResponse } from './types';

// The one place the frontend knows the wire format (phase 5 adds the streaming
// counterpart here). Errors follow the API's { error: string } shape.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// POST /api/ask — non-streaming. Dev traffic goes through Vite's /api proxy; the same
// paths are assumed in production.
export async function ask(input: AnswerRequest): Promise<AnswerResponse> {
  let response: Response;
  try {
    response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the assistant. Check your connection and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new ApiError(response.status, message ?? `The request failed (HTTP ${response.status}).`);
  }
  return body as AnswerResponse;
}
