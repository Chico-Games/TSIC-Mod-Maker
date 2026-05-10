import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Props<T> {
  items: T[];
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  /** Extra rows rendered above + below the viewport. Higher overscan
   *  reduces flicker on fast scroll and keeps draggables mounted long
   *  enough that a mid-drag scroll doesn't abort the drag. */
  overscan?: number;
  /** Optional row key. Defaults to the row's index. */
  keyOf?: (item: T, index: number) => string;
}

/** Tiny windowed list. Fixed row height, owns its scroll, mounts only
 *  the rows that intersect the viewport (plus an overscan band). Used
 *  in place of `.slice(0, N)` "and N more" cutoffs across the editor. */
export function VirtualList<T>({
  items,
  rowHeight,
  renderItem,
  className,
  overscan = 8,
  keyOf,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  // Re-measure when the container resizes (window resize, parent grid
  // change, sub-tab switch). ResizeObserver is supported in every
  // browser the app targets.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scrollTop if the items list shrinks beyond the current
  // position (e.g. the user filtered the list and there are no longer
  // enough rows to scroll to where they were).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollTop > items.length * rowHeight) el.scrollTop = 0;
  }, [items.length, rowHeight]);

  const total = items.length * rowHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIdx = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportH) / rowHeight) + overscan,
  );
  const slice = items.slice(startIdx, endIdx);
  const offsetTop = startIdx * rowHeight;

  return (
    <div
      ref={ref}
      className={`virtual-list ${className ?? ''}`}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="vl-inner" style={{ height: total }}>
        <div className="vl-window" style={{ transform: `translateY(${offsetTop}px)` }}>
          {slice.map((it, i) => {
            const idx = startIdx + i;
            const key = keyOf ? keyOf(it, idx) : String(idx);
            return (
              <div key={key} className="vl-row" style={{ height: rowHeight }}>
                {renderItem(it, idx)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
