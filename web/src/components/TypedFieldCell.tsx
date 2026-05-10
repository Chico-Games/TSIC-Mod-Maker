import { TypedField } from './TypedValueEditor';
import type { RefAdapter, PinAdapter } from './TypedValueEditor';

// Slim wrapper that drops the property-name label (the column header
// already shows it) and renders the same typed-envelope editor used in
// the regular per-asset form. Pin and meta lookups still flow through.

interface Props {
  typed: any;
  propertyName: string;
  parentTypeName: string;
  refAdapter: RefAdapter;
  pinAdapter: PinAdapter;
  onChange: (next: any) => void;
  path: (string | number)[];
}

export function TypedFieldCell(props: Props) {
  return (
    <div className="def-table-cell">
      <TypedField {...props} />
    </div>
  );
}
