// Token-aware fuzzy search. The default for every filter box in the
// app: a query like "bench tier 2" finds "FD_BenchTier2_CS" or "Tier 2
// Crafting Bench" without forcing the user to type a contiguous
// substring. Each query token must hit some text token (exact match,
// prefix, or edit distance ≤ 1 for ≥4-char tokens). We return the
// matched ranges in the *original* text so HighlightedText can mark
// them inline.

export interface Token {
  /** Lowercased token text. */
  token: string;
  /** Inclusive start in the original string. */
  start: number;
  /** Exclusive end in the original string. */
  end: number;
}

/** Split a string on camelCase boundaries, snake/kebab separators,
 *  whitespace, punctuation, and digits-vs-letters. Empty tokens
 *  filtered out. The returned positions are valid in the original. */
export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  // Match: an acronym (UPPER ending before a Title-Case word), a
  // Title/Capitalised word, an all-lower word, an all-upper word, or
  // a digit run.
  const re = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) continue;
    out.push({ token: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Iterative Damerau–Levenshtein-light: insert / delete / substitute. */
function editDistance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length, n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1; // early exit
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export interface FuzzyHit {
  score: number;
  ranges: Array<[number, number]>;
}

/** Score `text` against `query`. Returns null when no match. Higher
 *  score = better. The ranges are inclusive-start / exclusive-end and
 *  point into the original `text`. */
export function fuzzyMatch(text: string, query: string): FuzzyHit | null {
  const q = query.trim();
  if (!q) return { score: 0, ranges: [] };
  const qTokens = tokenize(q.toLowerCase());
  if (qTokens.length === 0) return null;
  const tTokens = tokenize(text);
  if (tTokens.length === 0) return null;
  const used = new Array<boolean>(tTokens.length).fill(false);
  const ranges: Array<[number, number]> = [];
  let totalScore = 0;
  for (const qt of qTokens) {
    let bestIdx = -1;
    let bestKind = 4; // 0=exact, 1=prefix, 2=substring, 3=edit-distance
    let bestStart = Infinity;
    for (let i = 0; i < tTokens.length; i++) {
      if (used[i]) continue;
      const tt = tTokens[i];
      let kind = 4;
      if (tt.token === qt.token) kind = 0;
      else if (tt.token.startsWith(qt.token)) kind = 1;
      else if (qt.token.length >= 3 && tt.token.includes(qt.token)) kind = 2;
      else if (qt.token.length >= 4 && editDistance(tt.token, qt.token, 1) <= 1) kind = 3;
      if (kind === 4) continue;
      if (kind < bestKind || (kind === bestKind && tt.start < bestStart)) {
        bestIdx = i;
        bestKind = kind;
        bestStart = tt.start;
      }
    }
    if (bestIdx === -1) return null;
    used[bestIdx] = true;
    const tt = tTokens[bestIdx];
    // Score: prefer earlier hits, exact > prefix > substring > fuzzy.
    const kindBonus = [120, 80, 50, 25][bestKind];
    totalScore += kindBonus;
    totalScore -= tt.start * 0.25;
    // Highlight just the part of the text token that matches.
    if (bestKind === 0) {
      ranges.push([tt.start, tt.end]);
    } else if (bestKind === 1) {
      ranges.push([tt.start, tt.start + qt.token.length]);
    } else if (bestKind === 2) {
      const inner = tt.token.indexOf(qt.token);
      ranges.push([tt.start + inner, tt.start + inner + qt.token.length]);
    } else {
      ranges.push([tt.start, tt.end]);
    }
  }
  // Bonus when every query token matched and they're in order.
  let inOrder = true;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][0]) { inOrder = false; break; }
  }
  if (inOrder) totalScore += 30;
  return { score: totalScore, ranges };
}

export interface RankedHit<T> {
  item: T;
  score: number;
  ranges: Array<[number, number]>;
}

/** Filter + sort by descending score. Items with no match drop out. */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): RankedHit<T>[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, score: 0, ranges: [] }));
  const out: RankedHit<T>[] = [];
  for (const item of items) {
    const hit = fuzzyMatch(getText(item), q);
    if (hit) out.push({ item, score: hit.score, ranges: hit.ranges });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Filter + sort against MULTIPLE candidate text fields. The best
 *  field's ranges are returned. Lets a search match either
 *  display_name OR id, etc. */
export function fuzzyRankMulti<T>(
  items: readonly T[],
  query: string,
  getTexts: (item: T) => readonly string[],
): RankedHit<T>[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, score: 0, ranges: [] }));
  const out: RankedHit<T>[] = [];
  for (const item of items) {
    const texts = getTexts(item);
    let best: { score: number; ranges: Array<[number, number]>; textIndex: number } | null = null;
    for (let i = 0; i < texts.length; i++) {
      const hit = fuzzyMatch(texts[i], q);
      if (hit && (best == null || hit.score > best.score)) {
        best = { ...hit, textIndex: i };
      }
    }
    if (best) out.push({ item, score: best.score, ranges: best.ranges });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
