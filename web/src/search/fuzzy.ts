// Token-aware fuzzy search powered by @leeoniya/ufuzzy.
//
// uFuzzy handles the tricky bits we used to half-implement:
//   - camelCase / digit boundary segmentation
//   - case-insensitive matching with case bonus
//   - single-error tolerance per term (typo / transposition / insert)
//   - out-of-order term matching
//   - precise highlight ranges that map back into the original string
//
// The exported API (`fuzzyMatch`, `fuzzyRank`, `fuzzyRankMulti`,
// `RankedHit`, `Token`) stays the same so every filter site keeps
// working without changes — uFuzzy is an implementation detail.

import uFuzzy from '@leeoniya/ufuzzy';

const fuzzy = new uFuzzy({
  // Single-error mode: allow 1 typo / transposition / deletion per
  // term (excluding first + last chars). Catches the common slips
  // ("bechn" → "bench", "tier 2" → "ter 2") without flooding.
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraTrn: 1,
  intraDel: 1,
  // Default term boundaries already match camelCase + digit
  // transitions, which is what we need for asset ids ("BenchTier1"
  // splits into "Bench" / "Tier" / "1").
});

// Out-of-order permutation cap: 5! = 120 iterations is the default
// safety ceiling. Most queries are 1–3 tokens so this rarely matters.
const OUT_OF_ORDER = 5;

export interface Token {
  /** Lowercased token text. */
  token: string;
  /** Inclusive start in the original string. */
  start: number;
  /** Exclusive end in the original string. */
  end: number;
}

/** Split a string the same way uFuzzy does internally — emit one
 *  token per camelCase / boundary segment. Kept exported because a
 *  few callers want an explicit token list, and it stays stable
 *  across uFuzzy upgrades. */
export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const re = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) continue;
    out.push({ token: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export interface FuzzyHit {
  /** Score is a simple rank position — higher = better. uFuzzy's
   *  internal `Info` is richer; we collapse it to one number so
   *  callers can use plain `.sort((a, b) => b.score - a.score)`. */
  score: number;
  /** Inclusive-start / exclusive-end pairs into the original `text`. */
  ranges: Array<[number, number]>;
}

/** Score `text` against `query`. Returns null when uFuzzy doesn't
 *  match, `{score: 0, ranges: []}` when the query is empty (used
 *  upstream as the "show everything, no highlights" case). */
export function fuzzyMatch(text: string, query: string): FuzzyHit | null {
  const q = query.trim();
  if (!q) return { score: 0, ranges: [] };
  const result = fuzzy.search([text], q, OUT_OF_ORDER);
  // SearchResult tuple: [idxs, info, infoIdxOrder] | [idxs, null, null] | [null, null, null]
  const [idxs, info, order] = result;
  if (!idxs || !info || !order || idxs.length === 0) return null;
  // Single-element haystack: the only entry's info is at index 0.
  const flat = info.ranges[0] ?? [];
  return {
    score: 1,
    ranges: flatRangesToPairs(flat),
  };
}

export interface RankedHit<T> {
  item: T;
  score: number;
  ranges: Array<[number, number]>;
}

/** Filter + sort `items` by descending uFuzzy score. Items with no
 *  match drop out. Empty query returns every item with no
 *  highlights (callers can iterate without a special case). */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): RankedHit<T>[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, score: 0, ranges: [] }));
  const haystack = items.map(getText);
  const result = fuzzy.search(haystack, q, OUT_OF_ORDER);
  const [idxs, info, order] = result;
  if (!idxs || !info || !order || idxs.length === 0) return [];
  const out: RankedHit<T>[] = [];
  // `order` walks idxs in best-first sort order; `info.ranges` is
  // parallel to idxs (NOT to the original haystack), so we look up
  // ranges via order[k] which is an index INTO info.idx.
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const haystackIdx = info.idx[i];
    out.push({
      item: items[haystackIdx],
      score: order.length - k, // higher = better
      ranges: flatRangesToPairs(info.ranges[i] ?? []),
    });
  }
  return out;
}

/** Like `fuzzyRank` but each item exposes multiple candidate texts.
 *  We search each text in the per-item list and keep the best
 *  match. Useful when an item has both a humanized label and an id
 *  — a query that hits either should still rank the item. */
export function fuzzyRankMulti<T>(
  items: readonly T[],
  query: string,
  getTexts: (item: T) => readonly string[],
): RankedHit<T>[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, score: 0, ranges: [] }));
  // Build a flat haystack with provenance back to item index. The
  // ranges that uFuzzy returns refer to the haystack STRING the
  // match landed in, so we tag each entry with which text-field it
  // came from to route ranges to the right text in the caller.
  const haystack: string[] = [];
  const ownerIdx: number[] = [];
  const fieldIdx: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const texts = getTexts(items[i]);
    for (let j = 0; j < texts.length; j++) {
      haystack.push(texts[j]);
      ownerIdx.push(i);
      fieldIdx.push(j);
    }
  }
  const result = fuzzy.search(haystack, q, OUT_OF_ORDER);
  const [idxs, info, order] = result;
  if (!idxs || !info || !order || idxs.length === 0) return [];
  // Best entry per owner — a single item may have multiple text
  // fields hit; we keep whichever uFuzzy ranked highest (the first
  // we see when walking `order`).
  const seen = new Map<number, RankedHit<T>>();
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const hayIdx = info.idx[i];
    const owner = ownerIdx[hayIdx];
    if (seen.has(owner)) continue;
    // ranges are relative to `texts[fieldIdx[hayIdx]]`. The caller
    // typically uses the FIRST text for display, so we only return
    // ranges when the match landed in the first text. If it landed
    // in a secondary (e.g. id), the label still shows but is not
    // highlighted — callers can pass id as the FIRST entry if they
    // want id matches highlighted instead.
    const ranges = fieldIdx[hayIdx] === 0
      ? flatRangesToPairs(info.ranges[i] ?? [])
      : [];
    seen.set(owner, {
      item: items[owner],
      score: order.length - k,
      ranges,
    });
  }
  // Restore order by score descending.
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

function flatRangesToPairs(flat: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i], flat[i + 1]]);
  }
  return out;
}
