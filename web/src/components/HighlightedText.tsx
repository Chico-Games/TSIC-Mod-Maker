interface Props {
  text: string;
  query: string;
}

/** Highlights every case-insensitive occurrence of `query` inside `text`. */
export function HighlightedText({ text, query }: Props) {
  const q = query.trim();
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
