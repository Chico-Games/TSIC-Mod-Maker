// A number input that commits on change and shows the unit. Used everywhere the AI tab
// edits a definition value, so tuning always feels the same.

import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Rendered dimmer with an "inherited" hint — the value comes from the extends chain. */
  inherited?: boolean;
  title?: string;
  onChange: (v: number) => void;
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  inherited,
  title,
  onChange,
}: Props) {
  const [text, setText] = useState(value === undefined ? '' : String(value));

  // Follow the definition when it changes underneath us (undo, another view, a reload),
  // but never fight the user mid-keystroke.
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n)) return;
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (next !== value) onChange(next);
  };

  return (
    <label className={`num-field ${inherited ? 'inherited' : ''}`} title={title}>
      <span className="num-label">
        {label}
        {inherited && <span className="num-inherited">inherited</span>}
      </span>
      <span className="num-input">
        <input
          type="number"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={(e) => commit(e.target.value)}
        />
        {unit && <span className="num-unit">{unit}</span>}
      </span>
    </label>
  );
}
