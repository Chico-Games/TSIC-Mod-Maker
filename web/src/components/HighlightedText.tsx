interface Props {
  text: string;
  /** When provided, highlights every case-insensitive substring match
   *  of `query`. Used for plain substring filters and as a fallback
   *  when fuzzy ranges aren't available. */
  query?: string;
  /** Pre-computed ranges from a fuzzy ranker. Inclusive-start /
   *  exclusive-end positions in `text`. Wins over `query` when set. */
  ranges?: ReadonlyArray<readonly [number, number]>;
}

/** Highlights matched portions of a label using either pre-computed
 *  ranges (the fuzzy-search path) or a substring query (the legacy
 *  path). Overlapping ranges merge before rendering. */
export function HighlightedText({ text, query, ranges }: Props) {
  if (ranges && ranges.length > 0) {
    const merged = mergeRanges(ranges);
    const out: React.ReactNode[] = [];
    let cursor = 0;
    for (const [s, e] of merged) {
      const start = Math.max(0, Math.min(s, text.length));
      const end = Math.max(start, Math.min(e, text.length));
      if (start > cursor) out.push(text.slice(cursor, start));
      if (end > start) {
        out.push(
          <mark key={start} className="search-mark">{text.slice(start, end)}</mark>,
        );
      }
      cursor = end;
    }
    if (cursor < text.length) out.push(text.slice(cursor));
    return <>{out}</>;
  }

  const q = (query ?? '').trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(ql, cursor);
    if (idx === -1) {
      out.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) out.push(text.slice(cursor, idx));
    out.push(
      <mark key={idx} className="search-mark">{text.slice(idx, idx + ql.length)}</mark>,
    );
    cursor = idx + ql.length;
  }
  return <>{out}</>;
}

function mergeRanges(ranges: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = [...ranges].map((r) => [r[0], r[1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    if (out.length === 0 || r[0] > out[out.length - 1][1]) {
      out.push([r[0], r[1]]);
    } else {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
    }
  }
  return out;
}
