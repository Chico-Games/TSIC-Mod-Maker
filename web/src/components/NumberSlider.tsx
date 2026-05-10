// Linked slider + number input pair. Used by NumberEditor when the
// .property-meta sidecar gives clamp/UI bounds — the slider is for
// quick coarse tuning, the input for precise values. The slider
// snaps to a step computed from the bound range.

interface Props {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  isInt?: boolean;
  title?: string;
}

export function NumberSlider({ value, onChange, min, max, isInt, title }: Props) {
  // Coarse-tune step: ints step by 1; floats divide the range into 100.
  const step = isInt ? 1 : Math.max((max - min) / 100, 0.001);
  const clamp = (n: number) => {
    if (!Number.isFinite(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return isInt ? Math.round(n) : n;
  };
  const safeValue = Number.isFinite(value) ? value : min;
  return (
    <div className="ns-root" title={title}>
      <input
        type="range"
        className="ns-slider"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <input
        type="number"
        className="ns-number"
        step={isInt ? 1 : 'any'}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(min);
          const n = isInt ? parseInt(raw, 10) : Number(raw);
          onChange(clamp(n));
        }}
      />
      <span className="ns-bounds">
        {formatBound(min, isInt)}–{formatBound(max, isInt)}
      </span>
    </div>
  );
}

function formatBound(n: number, isInt?: boolean): string {
  if (isInt) return String(Math.round(n));
  // Trim trailing zeros for compact display.
  return Number(n.toFixed(3)).toString();
}
