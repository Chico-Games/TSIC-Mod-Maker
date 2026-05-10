interface Props {
  /** Which edge of the strip the chevron points toward when expanding. */
  side: 'left' | 'right';
  onExpand: () => void;
  /** Optional aria label. */
  label?: string;
}

export function CollapseStrip({ side, onExpand, label = 'Expand panel' }: Props) {
  const chevron = side === 'left' ? '›' : '‹';
  return (
    <button
      type="button"
      className={`collapse-strip ${side}`}
      title={label}
      aria-label={label}
      onClick={onExpand}
    >
      {chevron}
    </button>
  );
}
