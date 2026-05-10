import { useRef } from 'react';

interface Props {
  /** 'col' for left-right resize, 'col-rev' when growing the right pane should
   *  subtract from the variable. Use 'col' for the left handle (rail/palette)
   *  and 'col-rev' for the split divider when the right side shrinks. */
  orientation?: 'col' | 'col-rev';
  /** Called with the signed delta in pixels since the last move. */
  onDelta: (deltaPx: number) => void;
  /** Optional reset (double-click). */
  onReset?: () => void;
  /** Optional aria label. */
  label?: string;
}

export function ResizeHandle({ onDelta, onReset, label = 'Resize' }: Props) {
  const lastXRef = useRef<number | null>(null);
  const draggingRef = useRef<boolean>(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    lastXRef.current = e.clientX;
    draggingRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || lastXRef.current == null) return;
    const dx = e.clientX - lastXRef.current;
    if (dx !== 0) {
      lastXRef.current = e.clientX;
      onDelta(dx);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    lastXRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onReset?.()}
    />
  );
}
