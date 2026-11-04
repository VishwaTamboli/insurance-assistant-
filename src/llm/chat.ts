import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../config.ts';

// The chat models behind the LLM nodes. Research and audit may use separate models so a
// faster audit model can be selected without weakening the independent audit.
//
// The guide splits work over two tiers (a fast model for extraction, a strong one for
// auditing), but this key's free tier answers only the flash family: the `gemini-2.5-pro`
// fetches return 404 and the pro-preview model hits its quota. Each node can still be
// pointed at a compatible sibling with CHAT_MODEL or AUDIT_CHAT_MODEL in the environment.
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-3.5-flash-lite';
export const AUDIT_CHAT_MODEL = process.env.AUDIT_CHAT_MODEL ?? 'gemini-3.5-flash';
export const AUDIT_THINKING_LEVEL = 'minimal';
export const RESEARCH_MAX_OUTPUT_TOKENS = 2048;
export const AUDIT_MAX_OUTPUT_TOKENS = 1024;

// The installed connector's type list predates Gemini 3's lowercase thinking levels,
// but it forwards this config unchanged to the provider.
const AUDIT_THINKING_CONFIG = {
  thinkingLevel: AUDIT_THINKING_LEVEL,
} as unknown as NonNullable<ConstructorParameters<typeof ChatGoogleGenerativeAI>[0]['thinkingConfig']>;

// A model attempt should not hold an SSE run forever. LangGraph's node retry policy
// still gets to retry transient failures, while this bounds the time spent on any one
// provider call (and lets the client receive a useful error/progress conclusion).
export const LLM_ATTEMPT_TIMEOUT_MS = 30_000;

export function llmAttemptConfig(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(LLM_ATTEMPT_TIMEOUT_MS) };
}

let cached: ChatGoogleGenerativeAI | null = null;
let cachedAudit: ChatGoogleGenerativeAI | null = null;

// One shared instance (the wrapper keeps its own connection pool). Created on first use,
// so importing modules that depend on this file — including the unit tests for the pure
// helpers — never needs the API key or the network.
export function chatModel(): ChatGoogleGenerativeAI {
  if (!cached) {
    cached = new ChatGoogleGenerativeAI({
      apiKey: config.googleApiKey,
      model: CHAT_MODEL,
      temperature: 0, // the same evidence should give the same answer on a re-run
      maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
    });
  }
  return cached;
}

export function auditChatModel(): ChatGoogleGenerativeAI {
  if (!cachedAudit) {
    cachedAudit = new ChatGoogleGenerativeAI({
      apiKey: config.googleApiKey,
      model: AUDIT_CHAT_MODEL,
      temperature: 0,
      maxOutputTokens: AUDIT_MAX_OUTPUT_TOKENS,
      thinkingConfig: AUDIT_THINKING_CONFIG,
    });
  }
  return cachedAudit;
}

// Sizes only; never log prompt/output contents, keys, or member policy text.
export function logModelTiming(
  node: string,
  model: string,
  promptChars: number,
  output: unknown,
  started: number,
): void {
  const outputChars = JSON.stringify(output)?.length ?? 0;
  console.log(`[llm] node=${node} model=${model} promptChars=${promptChars} outputChars=${outputChars} elapsedMs=${Math.round(performance.now() - started)}`);
}
