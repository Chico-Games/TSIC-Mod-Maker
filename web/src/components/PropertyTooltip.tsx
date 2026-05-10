import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PropertyMeta } from '../store/definitionsStore';

interface PropertyTooltipProps {
  meta: PropertyMeta | null | undefined;
  children: React.ReactNode;
}

const SHOW_DELAY_MS = 150;
const MAX_HEIGHT_PX = 280;

function hasContent(meta: PropertyMeta | null | undefined): boolean {
  if (!meta) return false;
  return Boolean(meta.tooltip || meta.cpp_type || meta.categories);
}

export function PropertyTooltip({ meta, children }: PropertyTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'below' | 'above' }>({
    top: 0, left: 0, placement: 'below',
  });

  const enabled = hasContent(meta);

  useEffect(() => () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
  }, []);

  const computePos = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: 'below' | 'above' = spaceBelow >= MAX_HEIGHT_PX + 12 ? 'below' : 'above';
    const top = placement === 'below' ? rect.bottom + 6 : rect.top - 6;
    const left = rect.left;
    setPos({ top, left, placement });
  };

  const onEnter = () => {
    if (!enabled) return;
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      computePos();
      setOpen(true);
    }, SHOW_DELAY_MS);
  };

  const onLeave = (e: React.PointerEvent) => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    // Keep open if pointer moved into the tooltip itself.
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && tooltipRef.current?.contains(relatedTarget)) return;
    setOpen(false);
  };

  const onTooltipLeave = (e: React.PointerEvent) => {
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && triggerRef.current?.contains(relatedTarget)) return;
    setOpen(false);
  };

  return (
    <>
      <span
        ref={triggerRef}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        style={{ display: 'contents' }}
      >
        {children}
      </span>
      {open && enabled && createPortal(
        <div
          ref={tooltipRef}
          className={`def-property-tooltip def-property-tooltip-${pos.placement}`}
          style={{
            top: pos.placement === 'below' ? pos.top : undefined,
            bottom: pos.placement === 'above' ? window.innerHeight - pos.top : undefined,
            left: pos.left,
          }}
          onPointerLeave={onTooltipLeave}
          role="tooltip"
        >
          {meta!.tooltip && (
            <div className="def-property-tooltip-prose">{meta!.tooltip}</div>
          )}
          {meta!.cpp_type && (
            <div className="def-property-tooltip-meta">{meta!.cpp_type}</div>
          )}
          {meta!.categories && (
            <div className="def-property-tooltip-meta">Categories: {meta!.categories}</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
