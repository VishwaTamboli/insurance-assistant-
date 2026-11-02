// The question-understanding layer: pure rules over the words of the question. No LLM, no
// database, no state — free, instant, same result every run, fully unit-testable. classify
// uses it to decide what the member is asking for, expand uses the result to pick retrieval
// anchors, and synthesize uses it to shape the response. The graph's nodes and edges stay
// exactly as they are, and nothing here invents policy content: it only routes questions.

// A turn of previous conversation, as the caller recorded it. `answer` holds the previous
// answer text (the synthesiser's numbered lines), which follow-ups like "explain the
// second point" can quote from verbatim.
export interface ConversationTurn {
  question: string;
  answer?: string;
}

// How a run should render its answer, and any cap the member asked for.
//   kind    the requested response shape
//   points  requested point count, "summarise in 3 points" (only meaningful for summary)
//   strict  the member said only / just / exactly / without explanation: no framing text,
//           and exact caps instead of approximations
export type FormatKind
  = | 'direct' | 'short' | 'bullets' | 'numbered' | 'detailed' | 'summary'
    | 'table' | 'steps' | 'example' | 'sources';

export interface Format {
  kind: FormatKind;
  points?: number;
  strict?: boolean;
}

// The aspects of a policy we recognise and prioritise in retrieval.
export type Aspect =
  | 'coverage' | 'exclusion' | 'benefit' | 'waiting-period' | 'pre-authorisation'
  | 'cost' | 'eligibility' | 'limit' | 'definition' | 'scenario'
  | 'summary-request' | 'source-specific' | 'missing-information' | 'comparison';

// What classify hands downstream. The two fields the API contract already carries
// (topic, outOfScope) keep their meaning; the rest is internal fuel for expand and
// synthesize and rides along in graph state without changing the wire contract.
export interface QuestionUnderstanding {
  topic: string;              // the primary aspect (the old `topic` field's meaning)
  outOfScope: boolean;        // true = refuse before retrieval
  format: Format;
  subject: string;            // subject words, with follow-up context already resolved
  aspects: Aspect[];          // every aspect recognised, primary first (empty when refused)
  country: string | null;     // a country the question locates treatment in
  secondaryPlanCode: string | null; // another plan the member names (comparison runs)
  followUp: boolean;          // true = context was borrowed from history
}

const OUT_OF_SCOPE: Array<{ pattern: RegExp; topic: string }> = [
  { pattern: /should i (take|stop)|diagnos/i, topic: 'medical advice' },
  { pattern: /legal advice|sue our|lawsuit/i, topic: 'legal advice' },
  { pattern: /someone else's|another person'?s|my \w+'s (policy|plan)/i, topic: "someone else's policy" },
  { pattern: /tax return|capital gains/i, topic: 'tax advice' },
];

// Aspect detection: every rule that fires becomes an aspect; the first in PRIMARY_ORDER
// becomes the primary topic. Order matters — "What is the waiting period?" waits, it does
// not define "the waiting period"; "What is not mentioned?" is a missing-info request.
const ASPECT_RULES: Array<{ aspect: Aspect; pattern: RegExp }> = [
  { aspect: 'missing-information', pattern: /\b(not mentioned|not say|does(?:n't| not) mention|nothing about|anything about|never mentioned)\b/i },
  { aspect: 'comparison', pattern: /\b(compar(?:e|ison|ing|ed)|versus|vs\b|difference between)\b/i },
  { aspect: 'summary-request', pattern: /\b(summar(?:y|ise|ize)|key points|highlights|in brief|nutshell)\b/i },
  { aspect: 'exclusion', pattern: /\b(exclusions?|excluded|not covered|not paid for|won'?t pay|do(?:es)? ?not pay for|not include[ds]?)\b/i },
  { aspect: 'waiting-period', pattern: /\bwaiting period|have to wait|how long (?:until|before) \w+(?:s)? wait/i },
  { aspect: 'pre-authorisation', pattern: /\b(pre.?authori[zs]ation|pre.?authori[zs]ed|prior authori|notify(?:ication)?|seek approval)\b/i },
  { aspect: 'scenario', pattern: /\b(if i |if we |suppose|what happens (?:now )?if|in case of|let'?s say|imagine)\b/i },
  { aspect: 'source-specific', pattern: /\b(which section|what section|which chapter|show me the source|cite the)\b/i },
  { aspect: 'definition', pattern: /\b(definitions?|define[sd]?|what does .+ mean|meaning of|what is meant by)\b/i },
  { aspect: 'eligibility', pattern: /\b(?:eligib|do i qualify|qualif[ie])/i },
  { aspect: 'limit', pattern: /\b(limits?|maximum|max\b|capped|annual cap)\b/i },
  { aspect: 'cost', pattern: /\b(cost|price|excess|deductible|co.?pay|reimburse|paid for claim|how much .+ pays?|how much .+ costs?)\b/i },
  { aspect: 'benefit', pattern: /\b(benefits?|entitled?|entitlement)\b/i },
  { aspect: 'coverage', pattern: /\b(covers?|covered|coverage|includes?|included|protects?)\b/i },
];

const PRIMARY_ORDER: Aspect[] = [
  'comparison', 'summary-request', 'missing-information', 'exclusion', 'waiting-period',
  'pre-authorisation', 'scenario', 'source-specific', 'definition', 'eligibility',
  'limit', 'cost', 'benefit', 'coverage',
];

function classifyQuestion(question: string): { topic: string; outOfScope: boolean; aspects: Aspect[] } {
  for (const { pattern, topic } of OUT_OF_SCOPE) {
    if (pattern.test(question)) return { topic, outOfScope: true, aspects: [] };
  }
  const aspects = ASPECT_RULES.filter(({ pattern }) => pattern.test(question)).map(({ aspect }) => aspect);
  if (aspects.length === 0) return { topic: 'coverage', outOfScope: false, aspects: ['coverage'] };
  const topic = PRIMARY_ORDER.find((aspect) => aspects.includes(aspect))!;
  return { topic, outOfScope: false, aspects };
}

export function understand(
  question: string,
  history: ConversationTurn[] = [],
  planCode: string,
): QuestionUnderstanding {
  const detection = classifyQuestion(question);
  const prior = history.length > 0 ? history[history.length - 1] : undefined;

  const detected = detectSubject(question);
  const country = detectCountry(question);
  const otherPlan = detectPlanCodes(question).find((code) => code !== planCode) ?? null;

  // A follow-up borrows the previous turn when the question leans on it ("the second
  // point", "what about…") or carries no subject of its own. A country, a named plan, or
  // an own subject means the member moved on: no old context.
  const followUp = prior !== undefined
    && otherPlan === null
    && (detected === '' || detectFollowUpMarker(question));

  let subject = detected;
  let aspects = detection.aspects;
  if (followUp && prior) {
    aspects = mergeAspects(aspects, classifyQuestion(prior.question).aspects);
    if (detected === '') {
      // "What is the waiting period?" — the subject is the previous one; "Explain the
      // second point." — the subject is that numbered line of the previous answer.
      subject = ordinalSubject(question, prior.answer) ?? detectSubject(prior.question);
    }
    // Otherwise the fresh subject rides on top of the previous aspect
    // ("What about planned surgery?" stays anchored in the coverage discussion).
  }

  return {
    topic: detection.topic,
    outOfScope: detection.outOfScope,
    format: detectFormat(question),
    subject,
    aspects: detection.outOfScope ? [] : (aspects.length > 0 ? [...aspects] : ['coverage']),
    country,
    secondaryPlanCode: detection.topic === 'comparison' ? otherPlan : null,
    followUp,
  };
}

// "Explain the second point." — find that numbered line in the previous answer and use
// its words as the subject. Verbally spelled ordinals work up to ten.
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

function ordinalSubject(question: string, previousAnswer: string | undefined): string | null {
  if (!previousAnswer) return null;
  const match = question.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+)(?:st|nd|rd|th)?\s*(?:point|step|item|line)\b/i);
  if (!match) return null;
  const index = ORDINAL_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
  const lines = previousAnswer.split('\n').filter((line) => line.trim().length > 0);
  const line = lines[index - 1];
  return line ? detectSubject(line.replace(/\[\d+\]/g, '')) : null;
}

function detectFollowUpMarker(question: string): boolean {
  return /\b(what about|and about|explain the (?:first|second|third|fourth|fifth|\d+)|tell me more|more about|does (?:this|that|it|the same)|also (?:apply|cover)|same (?:for|applies))\b/i.test(question);
}

const COUNTRIES = [
  'germany', 'france', 'spain', 'italy', 'switzerland', 'united kingdom', 'united states',
  'canada', 'portugal', 'greece', 'netherlands', 'belgium', 'austria', 'ireland', 'denmark',
  'sweden', 'norway', 'finland', 'poland', 'morocco', 'tunisia', 'thailand', 'japan',
  'china', 'mexico', 'brazil', 'india', 'australia', 'usa', 'abroad', 'overseas',
];

function detectCountry(question: string): string | null {
  const lower = question.toLowerCase();
  const found = COUNTRIES.find((country) => new RegExp(`\\b${country}\\b`).test(lower));
  return found ?? null;
}

const PLAN_CODES = ['GOLD', 'SILVER', 'PLATINUM', 'ESSENTIAL', 'BRONZE'];
const PLAN_WORDS = new Set(PLAN_CODES.map((code) => code.toLowerCase()));

function detectPlanCodes(question: string): string[] {
  const upper = question.toUpperCase();
  return PLAN_CODES.filter((code) => new RegExp(`\\b${code}\\b`).test(upper));
}

// Subject words: content words of the question. Question scaffolding ("am I covered
// for…", "just give me…") and format words drop out; countries and plan codes are
// separate facts, not subject.
const STOP_WORDS = new Set([
  'a', 'all', 'also', 'always', 'am', 'an', 'and', 'any', 'apply', 'applies', 'about', 'are', 'as', 'ask', 'asking', 'at',
  'be', 'been', 'being', 'both', 'briefly', 'by', 'can', 'cannot', 'compare', 'comparison', 'could', 'did',
  'do', 'does', 'doing', 'during', 'entitled', 'exactly', 'explain', 'for', 'from', 'get', 'give', 'gives', 'has',
  'have', 'having', 'hello', 'hey', 'hi', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'know', 'let', 'like',
  'list', 'many', 'me', 'more', 'much', 'my', 'need', 'needed', 'needs', 'not', 'nothing', 'please', 'policy',
  'quickly', 'required', 'requires', 'shall', 'she', 'should', 'short', 'shortly', 'show', 'so', 'some', 'such',
  'summarise', 'summarize', 'summary', 'tell', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'to', 'table', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  // Aspect-noun scaffolding: the aspect itself drives the anchors, so the words naming it
  // are not part of the subject ("Give me only the exclusions" has no subject of its own).
  'exclusion', 'exclusions', 'benefit', 'benefits', 'waiting', 'periods', 'period', 'authorisation',
  'authorization', 'notify', 'notification', 'section', 'sections', 'source', 'quote', 'definition',
  'definitions', 'define', 'mean', 'meaning', 'meant', 'mentioned', 'mention', 'eligible', 'eligibility',
  'qualify', 'limit', 'limits', 'maximum', 'excess', 'deductible', 'cost', 'costs', 'points', 'point', 'key', 'main',
  'steps', 'step', 'example', 'details', 'first', 'second', 'third', 'fourth', 'fifth', 'make', 'made', 'only',
  'pre', 'just',
  'up', 'us', 'use', 'want', 'was', 'way', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
  'will', 'with', 'without', 'would', 'you', 'your', 'covered', 'covers', 'cover', 'covering', 'coverage',
  'included', 'includes', 'pay', 'pays', 'paid', 'paying', 'versus',
]);

const SUBJECT_MAX_WORDS = 5;

export function detectSubject(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1
      && !STOP_WORDS.has(word)
      && !PLAN_WORDS.has(word)
      && countryWords(word) === false)
    .slice(0, SUBJECT_MAX_WORDS)
    .join(' ');
}

// A word matches a country name ("Germany", "abroad") — it is location, not subject.
function countryWords(word: string): boolean {
  return COUNTRIES.some((country) => {
    return country.split(' ').includes(word);
  });
}

// ---------- response format ---------- //

// The shape the member asked for. Explicit format words win; the aspect only sets the
// default when the member said nothing about the shape.
export function detectFormat(question: string): Format {
  const lower = question.toLowerCase();
  const strict = /\b(only|just|exactly)\b|\bwithout (?:any )?explanation\b/.test(lower);

  const desired = detectDesiredKind(lower);
  const points = detectRequestedPoints(question);
  if (points) {
    // A point count implies a summary even when the member didn't say "summarise".
    return { kind: desired ?? 'summary', points, strict };
  }
  if (desired) return { kind: desired, strict };

  const defaults = {
    'summary-request': 'summary', exclusion: 'bullets', comparison: 'table',
    'source-specific': 'sources', benefit: 'bullets',
  } as const satisfies Partial<Record<Aspect, FormatKind>>;
  const topic = classifyQuestion(question).topic;
  const fallback = defaults[topic as keyof typeof defaults];
  return { kind: (fallback ?? 'direct') as FormatKind, strict };
}

function detectDesiredKind(lower: string): FormatKind | null {
  if (/\btable\b/.test(lower)) return 'table';
  if (/\bbullet/.test(lower)) return 'bullets';
  if (/\bnumbered\b/.test(lower)) return 'numbered';
  if (/\bstep(?:s)?\b|step[- ]by[- ]step\b/.test(lower)) return 'steps';
  if (/\b(?:give|show) me an example\b/.test(lower)) return 'example';
  if (/\blist\b/.test(lower)) return 'bullets';
  if (/\bbriefly|short(?:ly)? answer|one sentence|quick(?:ly)?\b/.test(lower)) return 'short';
  if (/\bin detail|detailed|elaborate\b/.test(lower)) return 'detailed';
  if (/\bsummar/.test(lower)) return 'summary';
  if (/\b(?:key points|highlights)\b/.test(lower)) return 'summary';
  if (/\b(?:just|only) (?:the )?(?:source|section|quote)/.test(lower)) return 'sources';
  if (/\bwithout (?:any )?explanation\b/.test(lower)) return 'direct';
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function detectRequestedPoints(question: string): number | null {
  const match = question.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:main\s*)?(?:key\s*)?points?\b/i);
  if (!match) return null;
  const word = match[1].toLowerCase();
  const value = NUMBER_WORDS[word] ?? Number(word);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Prior aspect of the previous turn, so a follow-up like "What about planned surgery?"
// stays anchored in the same kind of question.
function mergeAspects(current: Aspect[], prior: Aspect[]): Aspect[] {
  const merged = [...current];
  for (const aspect of prior) {
    if (!merged.includes(aspect)) merged.push(aspect);
  }
  return merged;
}
