// Full-width pill button replacing the checkbox for bool envelopes. Two
// labels by variant: 'yes-no' for plain bools, 'on-off' for b_apply_*
// gating booleans inside structs (where the visual reads as a switch).

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
  variant?: 'yes-no' | 'on-off';
  className?: string;
  title?: string;
}

const LABELS: Record<NonNullable<Props['variant']>, [string, string]> = {
  'yes-no': ['No', 'Yes'],
  'on-off': ['Off', 'On'],
};

export function WideToggle({
  value,
  onChange,
  variant = 'yes-no',
  className,
  title,
}: Props) {
  const [labelOff, labelOn] = LABELS[variant];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`wt-root ${value ? 'wt-on' : 'wt-off'} wt-${variant} ${className ?? ''}`}
      title={title}
      onClick={() => onChange(!value)}
    >
      <span className={`wt-half wt-half-off ${!value ? 'active' : ''}`}>{labelOff}</span>
      <span className={`wt-half wt-half-on ${value ? 'active' : ''}`}>{labelOn}</span>
    </button>
  );
}
