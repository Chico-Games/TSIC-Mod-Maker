// Hybrid filter that pairs uFuzzy's instant string match with the
// MiniLM semantic search. Fuzzy renders the first frame after a
// keystroke; once the semantic worker is ready, a debounced re-render
// appends concept matches the literal pass couldn't catch ("food"
// → cake; "wooden" → oak). Items present in both keep their fuzzy
// ranges so the highlight stays accurate.
//
// Use via the `useHybridSearch` hook — it owns the debounce, the
// request-id guard for stale embeds, and the merge.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyRankMulti, type RankedHit } from './fuzzy';
import { getSemantic } from './semantic';

interface Options<T> {
  /** Semantic key per item — typically the asset's storage key,
   *  e.g. `${folder}/${id}`. Items returning `null` are skipped. */
  semanticKey?: (item: T) => string | null;
  semanticLimit?: number;
  minSemanticScore?: number;
  debounceMs?: number;
}

export function useHybridSearch<T>(
  items: readonly T[],
  query: string,
  getTexts: (item: T) => readonly string[],
  options?: Options<T>,
): RankedHit<T>[] {
  // The fuzzy pass is sync and cheap; recomputing every render is
  // fine, and it gives the user instant feedback while the semantic
  // worker is loading or debouncing. useMemo keeps the array
  // identity stable across renders that don't actually change inputs.
  const fuzzy = useMemo(
    () => fuzzyRankMulti(items, query, getTexts),
    // getTexts is typically a fresh closure per render, but its
    // OUTPUT depends only on `items` and the per-item shape — so
    // we deliberately exclude it from the deps to avoid re-running
    // fuzzy purely because the closure identity changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, query],
  );

  // Stash options in a ref so callers can pass a fresh object every
  // render without re-firing the semantic effect. Effect only watches
  // (query, items, getSemantic().status).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [semanticAddend, setSemanticAddend] = useState<RankedHit<T>[]>([]);
  const [semStatusTick, setSemStatusTick] = useState(0);

  // Subscribe to semantic status so we re-run when the worker
  // transitions cold → loading → ready.
  useEffect(() => {
    const sem = getSemantic();
    return sem.subscribe(() => setSemStatusTick((n) => n + 1));
  }, []);

  // Debounced semantic pass.
  useEffect(() => {
    setSemanticAddend([]);
    if (!query.trim()) return;
    const sem = getSemantic();
    if (sem.status !== 'ready') return;
    const semanticKey = optionsRef.current?.semanticKey;
    if (!semanticKey) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const semantic = await sem.search(
          query,
          items,
          semanticKey as (item: T) => string,
          {
            limit: optionsRef.current?.semanticLimit ?? 50,
            minScore: optionsRef.current?.minSemanticScore ?? 0.25,
          },
        );
        if (cancelled) return;
        // Dedupe — anything fuzzy already ranked stays where it is;
        // semantic-only items append after with their cosine score.
        const seen = new Set<string>();
        for (const h of fuzzy) {
          const k = semanticKey(h.item);
          if (typeof k === 'string') seen.add(k);
        }
        const additions: RankedHit<T>[] = [];
        for (const s of semantic) {
          const k = semanticKey(s.item);
          if (typeof k !== 'string' || seen.has(k)) continue;
          additions.push({ item: s.item, score: s.score, ranges: [] });
        }
        setSemanticAddend(additions);
      } catch {
        // Swallow — fuzzy results are still on screen.
      }
    }, optionsRef.current?.debounceMs ?? 220);
    return () => { cancelled = true; clearTimeout(timer); };
    // Intentionally minimal deps: items + query + a status tick.
    // optionsRef.current keeps the live options without forcing
    // re-runs from option-object identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, semStatusTick]);

  return useMemo(
    () => (semanticAddend.length === 0 ? fuzzy : [...fuzzy, ...semanticAddend]),
    [fuzzy, semanticAddend],
  );
}
