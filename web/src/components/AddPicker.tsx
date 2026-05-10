import { useEffect, useRef, useState } from 'react';

export interface AddPickerOption {
  /** Identifier passed to onPick. */
  value: string;
  /** Visible label. */
  label: string;
  /** Optional small explanatory hint shown under the label. */
  hint?: string;
  /** Optional emoji. */
  emoji?: string;
  /** Optional accent color (border-left). */
  color?: string;
}

interface Props {
  /** Trigger button label, e.g. "＋ New station". */
  label: string;
  options: AddPickerOption[];
  onPick: (value: string) => void;
  /** Optional className to apply to the trigger button. */
  triggerClassName?: string;
  /** Optional title attribute on the trigger. */
  title?: string;
}

/** Trigger button that opens a small popover of class-picker options.
 *  Picking an option calls `onPick(value)` and closes the popover. The
 *  caller is responsible for whatever creation/selection happens. */
export function AddPicker({ label, options, onPick, triggerClassName, title }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="add-picker">
      <button
        className={`add-row ${triggerClassName ?? ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        {label}
      </button>
      {open && (
        <div className="add-picker-popover">
          {options.map((o) => (
            <button
              key={o.value}
              className="add-picker-option"
              style={o.color ? { borderLeft: `3px solid ${o.color}` } : undefined}
              onClick={() => { onPick(o.value); setOpen(false); }}
            >
              <span className="emoji" aria-hidden>{o.emoji ?? '＋'}</span>
              <span className="label">{o.label}</span>
              {o.hint && <span className="hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
