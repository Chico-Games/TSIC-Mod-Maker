import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** Standard text-filter input with a trailing × that clears the
 *  value when present. Used everywhere we have a search-as-you-type
 *  field so users can reset without selecting + deleting. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  onKeyDown,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={`search-box ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="search-box-clear"
          aria-label="Clear search"
          title="Clear (Esc)"
          onMouseDown={(e) => {
            // mousedown so the input keeps its focus context — by the
            // time onClick fires, blur on the input would have run and
            // closed any open popovers (e.g. command palette).
            e.preventDefault();
            onChange('');
            inputRef.current?.focus();
          }}
        >×</button>
      )}
    </div>
  );
}
