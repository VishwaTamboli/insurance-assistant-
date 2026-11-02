import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../config.ts';

// The chat model behind the LLM nodes (research, auditDraft, synthesize — guide step 4's
// "real Gemini nodes, one at a time, with structured output").
//
// The guide splits work over two tiers (a fast model for extraction, a strong one for
// auditing), but this key's free tier answers only the flash family: the `gemini-2.5-pro`
// fetches return 404 and the pro-preview model hits its quota. So all three nodes share
// the ONE model below. Each flash model carries its own free-tier daily quota, so this
// can be pointed at the matching sibling with CHAT_MODEL in the environment without any
// code change.
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-3.8-flash';

let cached: ChatGoogleGenerativeAI | null = null;

// One shared instance (the wrapper keeps its own connection pool). Created on first use,
// so importing modules that depend on this file — including the unit tests for the pure
// helpers — never needs the API key or the network.
export function chatModel(): ChatGoogleGenerativeAI {
  if (!cached) {
    cached = new ChatGoogleGenerativeAI({
      apiKey: config.googleApiKey,
      model: CHAT_MODEL,
      temperature: 0, // the same evidence should give the same answer on a re-run
    });
  }
  return cached;
}
