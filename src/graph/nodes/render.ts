import type { Claim } from '../state.ts';
import type { Format, FormatKind } from '../understanding.ts';
import type { SearchHit } from '../../retrieval/search.ts';

// The deterministic answer renderers from the question-understanding phase (Phase 7),
// moved here unchanged. The synthesizer LLM now writes the answer itself (guide step 4);
// these renderers stay as its safety net: whenever the LLM's text fails the citation or
// format check, the SAME audited claims are rendered this way instead — so the response
// formats the member asked for keep working even on a bad model day.

export interface Tools {
  sectionOf: (chunkId: string) => string;
  policyOf: (chunkId: string) => string;
  format: Format;
  used: Claim[];
  subject: string;
}

// A claim's citation marker is its position in the printed answer, so the [n]s always
// line up with the citations array the API returns — even when a format prints a subset.
function marked(claims: Claim[]): string[] {
  return claims.map((claim, index) => `[${index + 1}] ${claim.text}`);
}

const ANSWERS: Record<FormatKind, (used: Claim[], tools: Tools) => string> = {
  direct: (used) => marked(used).join('\n'),

  short: (used) => marked(used).join('\n'),

  bullets: (used) => used.map((claim, index) => `- [${index + 1}] ${claim.text}`).join('\n'),

  numbered: (used) => used.map((claim, index) => `${index + 1}. ${claim.text}`).join('\n'),

  summary: (used, { format }) =>
    `${format.strict ? '' : 'Key points:\n'}${used.map((claim, index) => `${index + 1}. ${claim.text}`).join('\n')}`,

  steps: (used) =>
    used.map((claim, index) => `Step ${index + 1}: ${claim.text}`).join('\n'),

  detailed: (used, { sectionOf, used: claims }) =>
    claims.map((claim, index) => {
      const detail = claim.quote.length > claim.text.length ? claim.quote : null;
      return `${marked([claim])[0]}${detail ? `\n    from section ${sectionOf(claim.chunkIds[0])}: ${detail}` : ''}`;
    }).join('\n'),

  example: (used) =>
    `For example, the policy wording says: [1] ${used[0].text}`,

  sources: (used, { sectionOf }) =>
    used.map((claim, index) => `${sectionOf(claim.chunkIds[0])} [${index + 1}]\n  "${claim.quote}"`).join('\n'),

  table: (used, { sectionOf, policyOf }) => {
    const policies = new Set(used.map((claim) => policyOf(claim.chunkIds[0])));
    const header = policies.size > 1 ? 'Policy | What the wording says' : 'Section | What your policy says';
    const cell = policies.size > 1
      ? (claim: Claim, index: number) => `${policyOf(claim.chunkIds[0])} | [${index + 1}] ${claim.text}`
      : (claim: Claim, index: number) => `${sectionOf(claim.chunkIds[0])} | [${index + 1}] ${claim.text}`;
    return [header, '--- | ---', ...used.map(cell)].join('\n');
  },
};

// The Phase-7 fallback: shape the given claims into the requested format deterministically.
export function renderFallback(used: Claim[], tools: Tools): string {
  return ANSWERS[tools.format.kind](used, tools);
}

// ---------- claim selection shared by the LLM prompt and the fallback ---------- //

// "Answer briefly" and "give me an example" print the claim that best matches the
// question's subject, not just the first one; "summarise in 3 points" caps the count.
export function pickClaims(claims: Claim[], format: Format, subject: string): Claim[] {
  if (format.kind === 'short' || format.kind === 'example') {
    return [bestMatching(claims, subject) ?? claims[0]];
  }
  if (format.kind === 'summary') {
    return claims.slice(0, format.points ?? 3);
  }
  return claims;
}

// True when the claim's evidence content contains any subject word ("dental").
export function relates(claim: Claim, subject: string, sectionsById: Map<string, SearchHit>): boolean {
  const chunk = sectionsById.get(claim.chunkIds[0]);
  if (!chunk) return false;
  const text = `${chunk.section}\n${chunk.content}`.toLowerCase();
  return subject.split(' ').some((word) => word.length > 2 && text.includes(word));
}

function bestMatching(claims: Claim[], subject: string): Claim | null {
  if (!subject) return null;
  const words = subject.split(' ');
  return [...claims]
    .sort((a, b) => score(b, words) - score(a, words))[0] ?? null;
}

function score(claim: Claim, words: string[]): number {
  const text = `${claim.text} ${claim.quote}`.toLowerCase();
  return words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
}

// ---------- lookups shared by all answer paths ---------- //

// id → section, from the run's merged evidence.
export function sectionLookup(state: { evidence: SearchHit[] }): (chunkId: string) => string {
  const byId = new Map(state.evidence.map((hit) => [hit.id, hit.section]));
  return (chunkId) => byId.get(chunkId) ?? 'unknown section';
}

// id → the policy document the chunks were searched in, from the per-query evidence that
// retrieve tagged. Only a comparison run has two different titles.
export function policyLookup(state: { queryEvidence: { documentTitle?: string; hits: SearchHit[] }[] } & { evidence: SearchHit[] }): (chunkId: string) => string {
  return (chunkId) => state.queryEvidence.find(({ hits }) => hits.some((hit) => hit.id === chunkId))?.documentTitle
    ?? 'your policy';
}
