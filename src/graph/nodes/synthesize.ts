import type { Claim, Final, GraphState, GraphUpdate } from '../state.ts';
import type { Format } from '../understanding.ts';
import {
  pickClaims, policyLookup, relates, renderFallback,
  sectionLookup, type Tools,
} from './render.ts';
import type { SearchHit } from '../../retrieval/search.ts';
import { log } from './log.ts';

export async function synthesize(state: GraphState): Promise<GraphUpdate> {
  // Audit verdict was pass: write the answer. Anything else (reject or an exhausted
  // revise loop routed to a human) stays human-review. Quote-validated related wording
  // may still be shown as context, but it is never presented as a confirmed answer.
  if (state.audit?.verdict !== 'pass') {
    const related = relatedPolicyClaims(state);
    if (related.length > 0) {
      const sectionOf = sectionLookup(state);
      const final: Final = {
        answer: [
          "I couldn't verify a complete answer from your policy, so a member of our team will review it.",
          '',
          'Related policy wording:',
          ...related.map((claim, index) => `${claim.quote} [${index + 1}]`),
          '',
          'This wording is related context, not confirmation of every part of your question.',
        ].join('\n'),
        citations: related.map((claim) => sectionOf(claim.chunkIds[0])),
        confidence: 0,
      };
      return log('synthesize', { final }, `human-review with ${final.citations.length} related, quote-validated citations`);
    }

    const final: Final = {
      answer: "I couldn't find enough relevant policy wording to answer this safely. A member of our team will review your question.",
      citations: [],
      confidence: 0,
    };
    return log('synthesize', { final }, "an answer saying the policy couldn't confirm it");
  }

  const claims = state.draft.claims;
  const format = state.intent?.format ?? ({ kind: 'direct' } as Format);
  const subject = state.intent?.subject ?? '';
  const tools: Tools = {
    sectionOf: sectionLookup(state),
    policyOf: policyLookup(state),
    format,
    used: claims,
    subject,
  };

  // Missing-information questions where no claim touches the subject: the gap IS the
  // answer, stated deterministically and never phrased as an exclusion, so no wording
  // can turn policy silence into invented coverage or invented exclusion.
  if (isUnaware(state, claims, subject)) {
    const final: Final = {
      answer: `I couldn't find anything about ${subject} in your policy.`
        + (claims.length > 0 ? ` What the policy does say in related areas:\n${renderFallback(claims, tools)}` : ''),
      citations: claims.map((claim) => tools.sectionOf(claim.chunkIds[0])),
      confidence: state.audit.confidence,
    };
    return log('synthesize', { final }, `a missing-information answer (subject not found) with ${final.citations.length} citations`);
  }

  const used = pickClaims(claims, format, subject);
  const final: Final = {
    answer: renderFallback(used, { ...tools, used }),
    citations: used.map((claim) => tools.sectionOf(claim.chunkIds[0])),
    confidence: state.audit.confidence,
  };
  return log('synthesize', { final },
    `the audited claims rendered deterministically with ${final.citations.length} citations`);
}

// Claims reaching this helper have already passed the researcher's quote check. A
// human-review response can show a small amount of relevant policy wording without
// treating an unpassed draft as a confirmed answer. Subject matches are preferred; for
// broad aspect questions, section/content vocabulary identifies useful related context.
function relatedPolicyClaims(state: GraphState): Claim[] {
  const claims = state.draft?.claims ?? [];
  if (claims.length === 0) return [];

  const sectionsById = new Map<string, SearchHit>(state.evidence.map((hit) => [hit.id, hit]));
  const subject = state.intent?.subject?.trim() ?? '';
  const subjectMatches = subject
    ? claims.filter((claim) => relates(claim, subject, sectionsById))
    : [];
  if (subjectMatches.length > 0) return subjectMatches.slice(0, 4);

  const terms = aspectTerms(state.intent?.topic, state.intent?.aspects ?? []);
  if (terms.length === 0) return [];
  return claims.filter((claim) => {
    const chunk = sectionsById.get(claim.chunkIds[0]);
    if (!chunk) return false;
    const text = `${chunk.section}\n${chunk.content}`.toLowerCase();
    return terms.some((term) => text.includes(term));
  }).slice(0, 4);
}

function aspectTerms(topic: string | undefined, aspects: string[]): string[] {
  if (topic === 'eligibility' || aspects.includes('eligibility')) {
    return ['member', 'certificate of insurance', 'membership', 'enrol', 'enroll', 'eligible'];
  }
  if (topic === 'exclusion' || aspects.includes('exclusion')) return ['exclusion', 'do not pay', 'not covered'];
  if (topic === 'benefit' || aspects.includes('benefit')) return ['benefit', 'hospital', 'out-patient', 'maternity'];
  if (topic === 'waiting-period' || aspects.includes('waiting-period')) return ['waiting period', 'start of your membership'];
  if (topic === 'pre-authorisation' || aspects.includes('pre-authorisation')) return ['pre-authorisation', 'notify'];
  return [];
}

// Missing-info unaware check: no cited chunk (section heading or content) mentions any
// subject word. Only for missing-information questions that name a subject.
function isUnaware(state: GraphState, claims: Claim[], subject: string): boolean {
  if (state.intent?.topic !== 'missing-information' || subject === '') return false;
  const sectionsById = new Map<string, SearchHit>(state.evidence.map((hit) => [hit.id, hit]));
  return !claims.some((claim) => relates(claim, subject, sectionsById));
}

// The claim numbers [n] an answer used: must exist, be cited at most once each, and stay
// in print order — then renumbering them 1..k keeps the API citation contract.
export interface AnswerCheck {
  ok: boolean;
  reason?: string;
  markers?: number[];
}

export function checkMarkers(found: number[], claimCount: number): AnswerCheck {
  const distinct = [...new Set(found)];
  const inRange = distinct.every((n) => n >= 1 && n <= claimCount);
  const inOrder = distinct.every((n, index) => index === 0 || n > distinct[index - 1]);
  if (found.length === 0 || !inRange || !inOrder) {
    return { ok: false, reason: !inRange ? 'a marker named a claim that does not exist'
      : !inOrder ? 'the markers do not follow the print order'
      : 'no claim is cited' };
  }
  return { ok: true, markers: distinct };
}

// [old] markers → [new] so a subset print cites 1..k.
export function renumberMarkers(answer: string, mapping: number[]): string {
  if (mapping.every((n, index) => n === index + 1)) return answer;
  const newOf = new Map(mapping.map((n, index) => [n, index + 1]));
  return answer.replace(/\[(\d+)\]/g, (whole, num) => {
    const next = newOf.get(Number(num));
    return next === undefined ? whole : `[${next}]`;
  });
}
