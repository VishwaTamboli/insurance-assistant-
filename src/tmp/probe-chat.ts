import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import { config } from '../config.ts';
const Schema = z.object({ answer: z.string() });
try {
  const m = new ChatGoogleGenerativeAI({ apiKey: config.googleApiKey, model: 'gemini-3.8-flash', temperature: 0 });
  const out = await m.withStructuredOutput(Schema).invoke([['human', 'Set answer to "ready".']]);
  console.log('OK', JSON.stringify(out));
} catch (e: unknown) {
  const msg = String(e instanceof Error ? e.message : e);
  const window = /per day/.test(msg) ? 'DAY quota blocked' : /per minute/.test(msg) ? 'MINUTE throttle' : msg.slice(0, 160);
  const delay = msg.match(/retry in ([\w\dmh.]+)\.? Extract denied/); void delay;
  const retry = msg.match(/Please retry in ([\w\d.\s]+?)(?:$|\[)/)?.[1]?.trim();
  console.log('BLOCKED:', window, retry ? `retry in ${retry}` : '');
}
