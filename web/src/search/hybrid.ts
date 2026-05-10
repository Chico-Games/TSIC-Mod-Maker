// Hybrid filter that pairs uFuzzy's instant string match with the
// MiniLM semantic search. Fuzzy renders the first frame after a
// keystroke; once the semantic worker is ready (loaded + indexed),
// a debounced re-render appends concept matches the literal text
// search couldn't catch ("food" → cake, steak; "wooden" → oak
// table). Items present in both lists keep their fuzzy ranges so
// the highlight UI stays accurate.
//
// Use via the `useHybridSearch` hook from a React component; the
// hook owns the debounce, the request-id guard for stale embeds,
// and the merge.

import { useEffect, useState } from 'react';
import { fuzzyRankMulti, type RankedHit } from './fuzzy';
import { getSemantic } from './semantic';

interface Options<T> {
  /** When set, the hook calls this for the semantic key per item.
   *  Items returning `null` are skipped from the semantic pass. The
   *  key must match what was used at index time (typically the
   *  asset's storage key, e.g. `${folder}/${id}`). */
  semanticKey?: (item: T) => string | null;
  /** Cap on results forwarded out of the semantic pass. */
  semanticLimit?: number;
  /** Cosine similarity threshold for the semantic pass. */
  minSemanticScore?: number;
  /** Debounce on semantic embeds in ms. */
  debounceMs?: number;
}

export function useHybridSearch<T>(
  items: readonly T[],
  query: string,
  getTexts: (item: T) => readonly string[],
  options?: Options<T>,
): RankedHit<T>[] {
  // Synchronous fuzzy first-pass — cheap, runs every render.
  const fuzzy = fuzzyRankMulti(items, query, getTexts);
  const [merged, setMerged] = useState<RankedHit<T>[]>(fuzzy);

  useEffect(() => {
    setMerged(fuzzy);
    if (!query.trim()) return;
    const sem = getSemantic();
    if (sem.status !== 'ready') return;
    const semanticKey = options?.semanticKey;
    if (!semanticKey) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const semantic = await sem.search(
          query,
          items,
          semanticKey as (item: T) => string,
          {
            limit: options?.semanticLimit ?? 50,
            minScore: options?.minSemanticScore ?? 0.25,
          },
        );
        if (cancelled) return;
        // Merge by item identity (semantic key). Fuzzy hits keep
        // their ranges + scores; semantic-only hits append after,
        // ranked by their own cosine score.
        const seen = new Set<string>();
        const out: RankedHit<T>[] = [];
        for (const hit of fuzzy) {
          const k = semanticKey(hit.item);
          if (typeof k === 'string') seen.add(k);
          out.push(hit);
        }
        for (const s of semantic) {
          const k = semanticKey(s.item);
          if (typeof k !== 'string' || seen.has(k)) continue;
          out.push({ item: s.item, score: s.score, ranges: [] });
        }
        setMerged(out);
      } catch {
        // Swallow — fuzzy results already in `merged`.
      }
    }, options?.debounceMs ?? 220);

    return () => { cancelled = true; clearTimeout(timer); };
    // We deliberately depend on stable inputs; `fuzzy` would change
    // every render so we exclude it (the synchronous setMerged at
    // the top of the effect keeps it in sync).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, items, options?.semanticKey, options?.semanticLimit, options?.minSemanticScore, options?.debounceMs]);

  return merged;
}
