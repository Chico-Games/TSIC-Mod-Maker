import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface Props<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Stable per-row key. Heights are cached by this key, so it must be the
   *  same string for the same logical row across renders/reorders. */
  keyOf: (item: T, index: number) => string;
  /** Vertical space between rows, in px (matches the flat container's gap).
   *  Baked into each row's margin so spacer math stays simple. */
  gap?: number;
  /** Per-row height guess used before a row has been measured. */
  estimateHeight?: number;
  /** Extra px rendered above + below the visible band to avoid blank flashes
   *  during fast scroll. */
  overscanPx?: number;
  className?: string;
}

/** Walk up from `el` to the nearest scrollable ancestor. Unlike VirtualList
 *  (which owns its own scrollbar), VirtualBlocks windows against whatever
 *  container already scrolls — the detail pane, a sub-tab column, etc. — so
 *  it can be dropped into normal document flow without imposing a fixed
 *  height or nesting a second scrollbar. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node;
    node = node.parentElement;
  }
  return null;
}

/** First index `i` with `arr[i] >= x` (arr ascending). */
function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index `i` with `arr[i] > x` (arr ascending). */
function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function Measured({
  mkey,
  report,
  gap,
  children,
}: {
  mkey: string;
  report: (key: string, h: number) => void;
  gap: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // mkey + report are stable for the life of a mounted row, so the observer
  // is created once and only fires on genuine size changes (e.g. a nested
  // struct/array expanding, a textarea growing).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => report(mkey, el.offsetHeight));
    ro.observe(el);
    report(mkey, el.offsetHeight);
    return () => ro.disconnect();
  }, [mkey, report]);
  return (
    <div ref={ref} style={{ marginBottom: gap }}>
      {children}
    </div>
  );
}

/** Variable-height windowed list. Mounts only the rows intersecting the
 *  scroll-parent's viewport (plus an overscan band) and pads the rest with
 *  two spacer divs so the scrollbar still reflects the full content height.
 *  Heights are measured on mount and kept fresh with a ResizeObserver, so
 *  rows of any height (a bool toggle, a nested struct, a long textarea) all
 *  position correctly. Use this where `.slice`/flat `.map` over a large,
 *  variable-height list would otherwise mount hundreds of editor rows. */
export function VirtualBlocks<T>({
  items,
  renderItem,
  keyOf,
  gap = 0,
  estimateHeight = 96,
  overscanPx = 800,
  className,
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const heights = useRef<Map<string, number>>(new Map());
  // Bumped whenever a measured height changes — forces the offset table and
  // visible-band recompute below.
  const [version, setVersion] = useState(0);
  // Bumped on scroll/resize (rAF-throttled) — forces the visible-band
  // recompute without recomputing offsets.
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    scrollParentRef.current = findScrollParent(rootRef.current);
    const sp = scrollParentRef.current;
    const target: HTMLElement | Window = sp ?? window;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const ro = sp ? new ResizeObserver(onScroll) : null;
    if (sp && ro) ro.observe(sp);
    onScroll();
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const report = useCallback((key: string, h: number) => {
    const prev = heights.current.get(key);
    if (prev === undefined || Math.abs(prev - h) > 0.5) {
      heights.current.set(key, h);
      setVersion((v) => v + 1);
    }
  }, []);

  // Cumulative top offset of each row (with gaps folded in). offsets has
  // items.length + 1 entries; offsets[n] is the full content height.
  const offsets = useMemo(() => {
    const offs = new Array<number>(items.length + 1);
    offs[0] = 0;
    for (let i = 0; i < items.length; i++) {
      const h = heights.current.get(keyOf(items[i], i)) ?? estimateHeight;
      offs[i + 1] = offs[i] + h + gap;
    }
    return offs;
    // version forces a recompute after measurements land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, version, gap, estimateHeight, keyOf]);

  const { startIdx, endIdx } = useMemo(() => {
    void tick; // recompute on scroll/resize
    void version; // and when spacer/offsets shift
    const root = rootRef.current;
    if (!root || items.length === 0) return { startIdx: 0, endIdx: 0 };
    const sp = scrollParentRef.current;
    const rootTop = root.getBoundingClientRect().top;
    // List top expressed in the viewport's own coordinate space; negative
    // once the list has scrolled up past the viewport top.
    const listTopInViewport = sp ? rootTop - sp.getBoundingClientRect().top : rootTop;
    const viewportH = sp ? sp.clientHeight : window.innerHeight;
    const bandTop = -listTopInViewport - overscanPx;
    const bandBottom = -listTopInViewport + viewportH + overscanPx;
    const s = Math.min(Math.max(0, upperBound(offsets, bandTop) - 1), items.length - 1);
    const e = Math.min(Math.max(lowerBound(offsets, bandBottom), s + 1), items.length);
    return { startIdx: s, endIdx: e };
  }, [tick, version, offsets, items.length, overscanPx]);

  const topPad = offsets[startIdx] ?? 0;
  const bottomPad = Math.max(0, (offsets[items.length] ?? 0) - (offsets[endIdx] ?? 0));

  return (
    <div ref={rootRef} className={className}>
      <div style={{ height: topPad }} aria-hidden />
      {items.slice(startIdx, endIdx).map((it, i) => {
        const idx = startIdx + i;
        const key = keyOf(it, idx);
        return (
          <Measured key={key} mkey={key} report={report} gap={gap}>
            {renderItem(it, idx)}
          </Measured>
        );
      })}
      <div style={{ height: bottomPad }} aria-hidden />
    </div>
  );
}
