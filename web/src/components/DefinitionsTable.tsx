import { useMemo, useState } from 'react';
import type { RefAdapter, PinAdapter } from './TypedValueEditor';
import { TypedFieldCell } from './TypedFieldCell';
import { humanizeAssetId, humanizeProperty, isNoisyProperty } from './definitionsNaming';

// Multi-asset table editor. Columns are the union of property names across
// the selection (filtered by showAllFields + propertySearch). Each cell
// renders the row's value for that column via the typed-envelope editor;
// missing cells get an "+ Add" affordance that copies the default shape
// from the first row that does have the property. The header "× column"
// affordance removes a property from every selected row.

interface RecordLite {
  key: string;
  folder: string;
  id: string;
  json: any;
}

interface Props {
  records: RecordLite[];
  refAdapter: RefAdapter;
  pinAdapter: PinAdapter;
  showAllFields: boolean;
  onChangeAt: (key: string, path: (string | number)[], value: any) => void;
  /** Replace the entire record (used for add-property / remove-property). */
  onReplaceJson: (key: string, json: any) => void;
}

export function DefinitionsTable({
  records,
  refAdapter,
  pinAdapter,
  showAllFields,
  onChangeAt,
  onReplaceJson,
}: Props) {
  const [propSearch, setPropSearch] = useState('');
  const [addingPropName, setAddingPropName] = useState('');

  // Union of property names across all rows. We pull from each record's
  // `properties` map (the per-asset envelope dict) since that's what users
  // actually edit; top-level keys (id, class, etc.) stay in the regular
  // single-asset editor.
  const allProps = useMemo(() => {
    const set = new Set<string>();
    for (const rec of records) {
      const props = rec.json?.properties ?? {};
      for (const k of Object.keys(props)) set.add(k);
    }
    return [...set].sort();
  }, [records]);

  const visibleProps = useMemo(() => {
    let xs = showAllFields ? allProps : allProps.filter((k) => !isNoisyProperty(k));
    const q = propSearch.trim().toLowerCase();
    if (q) {
      xs = xs.filter((k) => k.toLowerCase().includes(q) || humanizeProperty(k).toLowerCase().includes(q));
    }
    // Pinned first.
    const pinned = xs.filter((k) => pinAdapter.isPinned(k));
    const rest = xs.filter((k) => !pinAdapter.isPinned(k));
    return [...pinned, ...rest];
  }, [allProps, propSearch, showAllFields, pinAdapter]);

  // Counts of how many rows have each property, so the column header can
  // call out "shared" vs "partial".
  const presence = useMemo(() => {
    const m = new Map<string, number>();
    for (const rec of records) {
      const props = rec.json?.properties ?? {};
      for (const k of Object.keys(props)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [records]);

  const seedTypedFor = (name: string): any | null => {
    // Use the first row that has this property as a template for new
    // cells. We deep-clone so edits don't mutate the donor.
    for (const rec of records) {
      const v = rec.json?.properties?.[name];
      if (v !== undefined) return JSON.parse(JSON.stringify(v));
    }
    return null;
  };

  const addPropertyToAll = (name: string) => {
    const seed = seedTypedFor(name) ?? { type: 'string', value: '' };
    for (const rec of records) {
      const props = rec.json?.properties ?? {};
      if (name in props) continue;
      const next = { ...rec.json, properties: { ...props, [name]: seed } };
      onReplaceJson(rec.key, next);
    }
    setAddingPropName('');
  };

  const removePropertyFromAll = (name: string) => {
    if (!window.confirm(`Remove "${name}" from all ${records.length} selected definitions?`)) return;
    for (const rec of records) {
      const props = { ...(rec.json?.properties ?? {}) };
      if (!(name in props)) continue;
      delete props[name];
      onReplaceJson(rec.key, { ...rec.json, properties: props });
    }
  };

  const addPropertyToRow = (rowKey: string, name: string) => {
    const seed = seedTypedFor(name) ?? { type: 'string', value: '' };
    const rec = records.find((r) => r.key === rowKey);
    if (!rec) return;
    const props = rec.json?.properties ?? {};
    if (name in props) return;
    onReplaceJson(rec.key, { ...rec.json, properties: { ...props, [name]: seed } });
  };

  return (
    <div className="def-table-root">
      <div className="def-table-toolbar">
        <strong>{records.length} selected</strong>
        <input
          type="text"
          className="def-prop-search"
          placeholder="Filter columns…"
          value={propSearch}
          onChange={(e) => setPropSearch(e.target.value)}
        />
        <input
          type="text"
          className="def-prop-search"
          placeholder="Add property name (snake_case)…"
          value={addingPropName}
          onChange={(e) => setAddingPropName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addingPropName.trim()) {
              addPropertyToAll(addingPropName.trim());
            }
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={!addingPropName.trim()}
          onClick={() => addPropertyToAll(addingPropName.trim())}
          title="Add this property to every selected definition (using the first row's value as a template if it exists)"
        >
          + Add to all
        </button>
      </div>
      <div className="def-table-scroll">
        <table className="def-table">
          <thead>
            <tr>
              <th className="def-table-id-col">Asset</th>
              {visibleProps.map((name) => {
                const count = presence.get(name) ?? 0;
                const shared = count === records.length;
                return (
                  <th key={name} className={shared ? 'shared' : 'partial'} title={`${count} of ${records.length} have this`}>
                    <div className="def-table-col-head">
                      <span>{humanizeProperty(name)}</span>
                      <span className="def-muted">{count}/{records.length}</span>
                      <button
                        type="button"
                        className={`def-pin-btn ${pinAdapter.isPinned(name) ? 'pinned' : ''}`}
                        title={pinAdapter.isPinned(name) ? 'Unpin' : 'Pin'}
                        onClick={() => pinAdapter.toggle(name)}
                      >
                        {pinAdapter.isPinned(name) ? '📌' : '📍'}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        title="Remove this property from every row"
                        onClick={() => removePropertyFromAll(name)}
                      >
                        ×
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const props = rec.json?.properties ?? {};
              const bareClass = String(rec.json?.class ?? '').replace(/^U/, '');
              return (
                <tr key={rec.key}>
                  <th className="def-table-id-col" title={rec.id}>
                    <div className="def-table-id-stack">
                      <span className="def-file-name">{humanizeAssetId(rec.id)}</span>
                      <span className="def-muted">{rec.folder}</span>
                    </div>
                  </th>
                  {visibleProps.map((name) => {
                    const has = name in props;
                    return (
                      <td key={name}>
                        {has ? (
                          <TypedFieldCell
                            typed={props[name]}
                            propertyName={name}
                            parentTypeName={bareClass}
                            refAdapter={refAdapter}
                            pinAdapter={pinAdapter}
                            onChange={(v) => onChangeAt(rec.key, ['properties', name], v)}
                            path={['properties', name]}
                          />
                        ) : (
                          <button
                            type="button"
                            className="def-table-add-cell"
                            onClick={() => addPropertyToRow(rec.key, name)}
                            title={`Add "${name}" to this row`}
                          >
                            + Add
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
