import type { Claim } from '../state.ts';
import type { SearchHit } from '../../retrieval/search.ts';

// Code-level guard against invented quotes (guide B.6): a claim may only survive if the
// sentence it quotes really is in the chunk it cites. The researcher LLM copies quotes, and
// everything downstream — audit, synthesis, the answer the member reads — rests on them, so
// anything unquotable is dropped before it can leak into the audit loop.
//
// Pure functions only: no LLM, no database, directly unit-testable.

// Make comparison forgiving of the small differences between what a model copies and what
// the chunk stores: curly quotes, dashes, case and runs of whitespace.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// True when the quote appears word for word in at least one of the cited chunks.
export function quoteIsReal(claim: Claim, chunksById: Map<string, SearchHit>): boolean {
  const needle = normalize(claim.quote);
  return claim.chunkIds.some((id) => {
    const chunk = chunksById.get(id);
    return chunk !== undefined && normalize(chunk.content).includes(needle);
  });
}

// Split a parsed draft into the claims that survive the check and the ones thrown away.
// Dropped claims don't reach the auditor: an answer can only lack support, never fake it.
export function validateQuotes(
  claims: Claim[],
  chunksById: Map<string, SearchHit>,
): { kept: Claim[]; dropped: number } {
  const kept = claims.filter((claim) => {
    const chunkIdsKnown = claim.chunkIds.length > 0 && claim.chunkIds.every((id) => chunksById.has(id));
    return chunkIdsKnown && quoteIsReal(claim, chunksById);
  });
  return { kept, dropped: claims.length - kept.length };
}
