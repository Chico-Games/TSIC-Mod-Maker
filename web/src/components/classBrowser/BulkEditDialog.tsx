import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';

interface Props {
  selectedKeys: DefinitionsKey[];
  onClose: () => void;
}

export function BulkEditDialog({ selectedKeys, onClose }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

  // Build the set of property keys present on every selected record.
  const propertyKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of selectedKeys) {
      const rec = definitions.get(k);
      const props = rec?.json?.properties;
      if (!props || typeof props !== 'object') continue;
      for (const pk of Object.keys(props)) counts.set(pk, (counts.get(pk) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [selectedKeys, definitions]);

  const [propKey, setPropKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<any>(null);

  // The source envelope used to seed the editor — pick from the first record that has the property.
  const sourceEnvelope = useMemo(() => {
    if (!propKey) return null;
    for (const k of selectedKeys) {
      const env = definitions.get(k)?.json?.properties?.[propKey];
      if (env != null) return env;
    }
    return null;
  }, [propKey, selectedKeys, definitions]);

  const compatibleKeys = useMemo(() => {
    if (!propKey || !sourceEnvelope) return [] as DefinitionsKey[];
    return selectedKeys.filter((k) => {
      const env = definitions.get(k)?.json?.properties?.[propKey];
      return env && env.type === sourceEnvelope.type;
    });
  }, [propKey, sourceEnvelope, selectedKeys, definitions]);

  const apply = () => {
    if (!propKey || draftValue == null) return;
    for (const k of compatibleKeys) {
      updateValueAtPath(k, ['properties', propKey], draftValue);
    }
    onClose();
  };

  return (
    <div className="bulk-overlay" onClick={onClose}>
      <div className="bulk-dialog" onClick={(e) => e.stopPropagation()}>
        <header>Bulk edit {selectedKeys.length} records</header>
        <label>Property:
          <select value={propKey ?? ''} onChange={(e) => { setPropKey(e.target.value || null); setDraftValue(null); }}>
            <option value="">— pick —</option>
            {propertyKeys.map(([k, n]) => (
              <option key={k} value={k}>{k} ({n}/{selectedKeys.length})</option>
            ))}
          </select>
        </label>

        {propKey && sourceEnvelope && (
          <div className="bulk-editor">
            {renderEditor(sourceEnvelope, draftValue ?? sourceEnvelope, setDraftValue)}
          </div>
        )}

        {propKey && (
          <div className="muted">
            Will apply to {compatibleKeys.length} of {selectedKeys.length} records.
            {compatibleKeys.length < selectedKeys.length && ` (${selectedKeys.length - compatibleKeys.length} skipped — incompatible type)`}
          </div>
        )}

        <footer>
          <button onClick={onClose}>Cancel</button>
          <button disabled={!propKey || draftValue == null || compatibleKeys.length === 0} onClick={apply}>Apply</button>
        </footer>
      </div>
    </div>
  );
}

/** Scalar fallback for envelopes whose type matches one of the simple cases.
 *  For complex types (arrays, maps, structs), shows a "not supported" message
 *  so the user knows to edit those individually instead.
 */
function renderEditor(sourceEnvelope: any, current: any, onChange: (next: any) => void) {
  const t = sourceEnvelope?.type;
  const cur = current?.value;
  if (t === 'string' || t === 'text' || t === 'name' || t === 'gameplay_tag') {
    return (
      <input
        type="text"
        value={typeof cur === 'string' ? cur : ''}
        onChange={(e) => onChange({ ...sourceEnvelope, value: e.target.value })}
      />
    );
  }
  if (t === 'int' || t === 'float') {
    return (
      <input
        type="number"
        value={typeof cur === 'number' ? cur : 0}
        onChange={(e) => onChange({ ...sourceEnvelope, value: Number(e.target.value) })}
      />
    );
  }
  if (t === 'bool') {
    return (
      <label>
        <input
          type="checkbox"
          checked={!!cur}
          onChange={(e) => onChange({ ...sourceEnvelope, value: e.target.checked })}
        /> {cur ? 'true' : 'false'}
      </label>
    );
  }
  return <div className="muted">Bulk edit for "{t}" properties is not supported in this MVP. Edit each record individually.</div>;
}
