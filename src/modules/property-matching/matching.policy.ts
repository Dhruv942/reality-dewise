export const FUZZY_MATCH_THRESHOLD = 0.85;
export const FUZZY_MATCH_MARGIN = 0.1;

export type MatchCandidate = { id: string; name: string; confidence?: number; matchMethod?: string };
export type FuzzyResult = { status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'; candidates: MatchCandidate[] };

/** Shared comparison form for portal names; punctuation becomes a word boundary. */
export const normalizePropertyName = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

const tokens = (value: string) => new Set(normalizePropertyName(value).split(' ').filter(Boolean));

const confidence = (incoming: string, candidate: string) => {
  const a = tokens(incoming);
  const b = tokens(candidate);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  // A shorter canonical name contained in a longer portal label is a reliable candidate;
  // requiring a margin prevents East/West-style siblings from auto-merging.
  return shared / Math.min(a.size, b.size);
};

export function fuzzyCandidates(incoming: string, candidates: MatchCandidate[]): FuzzyResult {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, confidence: confidence(incoming, candidate.name), matchMethod: 'FUZZY_NAME' }))
    .sort((a, b) => (b.confidence! - a.confidence!) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const top = ranked[0];
  const next = ranked[1];
  if (!top || top.confidence! < FUZZY_MATCH_THRESHOLD) return { status: 'UNMATCHED', candidates: ranked.slice(0, 5) };
  if (next && top.confidence! - next.confidence! < FUZZY_MATCH_MARGIN) return { status: 'AMBIGUOUS', candidates: ranked.slice(0, 5) };
  return { status: 'MATCHED', candidates: ranked.slice(0, 5) };
}
