import { pool } from '../db/pool.ts';
import { app } from './graph.ts';

// Three runs, one for each way through the graph. The question-understanding layer is
// rules (free); the researcher, auditor and synthesizer are real Gemini calls with
// structured output — the LLM-calling run below costs real quota, so run it sparingly.
// planCode and jurisdiction come from the member's account; the question is what they typed.
const MAIN_QUESTION = 'Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?';
const runs = [
  { title: 'Gold FR member, the main question: LLM calls (the revise loop may run)',
    input: { question: MAIN_QUESTION, planCode: 'GOLD', jurisdiction: 'FR' } },
  { title: 'Medical advice: out of scope, stops after classify (no LLM calls)',
    input: { question: 'Should I stop taking my blood pressure tablets before surgery?', planCode: 'GOLD', jurisdiction: 'FR' } },
  { title: 'A plan we hold no policy for: audit rejects, a person reviews (no LLM calls)',
    input: { question: MAIN_QUESTION, planCode: 'BRONZE', jurisdiction: 'FR' } },
];

for (const { title, input } of runs) {
  console.log(`\n=== ${title} ===`);
  const state = await app.invoke(input);

  if (!state.final) {
    console.log('No answer: the app shows a polite refusal.');
    continue;
  }
  console.log(`\nrevisions: ${state.revisions}, confidence: ${state.final.confidence}`);
  for (const line of state.final.answer.split('\n')) console.log(`  ${clip(line, 96)}`);
}

await pool.end();

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
