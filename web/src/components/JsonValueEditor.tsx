import { useState } from 'react';

// Recursive form-style editor that adapts to the runtime type of a JSON value.
// Strings → text input, numbers → numeric input, booleans → checkbox,
// arrays → list with add/remove/reorder, objects → nested fields. We also
// support "freeform" mode where the user can edit raw JSON for that subtree.

export interface JsonValueEditorProps {
  value: any;
  onChange: (next: any) => void;
  /** Display label for the field — typically the parent key. */
  label?: string;
  /** Path is rendered as a breadcrumb at deeper nesting. Used as DOM keys. */
  path: (string | number)[];
  /** When true, render a Delete button (used by array-of-X editors). */
  onDelete?: () => void;
  /** Force a specific renderer. Defaults to type detection. */
  forceRaw?: boolean;
  /** Maximum depth before falling back to raw editor — prevents pathological
   *  nesting from blowing up React performance. Default 6. */
  maxDepth?: number;
  /** Cross-reference resolver. If provided and a string value resolves to a
   *  known asset, the editor renders a "Go" button next to the field. */
  resolveRef?: (value: string) => string | null; // returns target key or null
  /** Click handler when the user activates a resolved cross-reference. */
  onNavigateRef?: (key: string) => void;
}

function detectType(v: any): 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as any;
}

function isPrimitiveArray(arr: any[]): boolean {
  return arr.every(
    (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );
}

function isHomogeneousObjectArray(arr: any[]): boolean {
  if (arr.length === 0) return false;
  return arr.every((v) => v != null && typeof v === 'object' && !Array.isArray(v));
}

/** A simple "Enter a tag" / "Enter an asset name" input for arrays of strings. */
function StringArrayEditor({
  value,
  onChange,
  refTargets,
  onNavigateRef,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  refTargets?: (string | null)[] | null;
  onNavigateRef?: (key: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="def-array-strings">
      {value.length === 0 && <div className="def-empty">(empty)</div>}
      {value.map((s, i) => (
        <div key={i} className="def-array-row">
          <input
            type="text"
            value={s}
            onChange={(e) => {
              const next = value.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          {refTargets?.[i] && onNavigateRef && (
            <button
              type="button"
              className="def-ref-go"
              title={`Go to ${s}`}
              onClick={() => onNavigateRef(refTargets[i]!)}
            >→</button>
          )}
          <button
            className="danger"
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            title="Remove"
          >×</button>
        </div>
      ))}
      <div className="def-array-row">
        <input
          type="text"
          placeholder="Add value…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onChange([...value, draft]);
              setDraft('');
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (!draft.trim()) return;
            onChange([...value, draft]);
            setDraft('');
          }}
        >+ Add</button>
      </div>
    </div>
  );
}

function PrimitiveInput({
  value,
  onChange,
}: {
  value: string | number | boolean | null;
  onChange: (v: string | number | boolean | null) => void;
}) {
  const t = detectType(value);
  if (t === 'boolean') {
    return (
      <label className="def-bool-label">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{value ? 'true' : 'false'}</span>
      </label>
    );
  }
  if (t === 'number') {
    return (
      <input
        type="number"
        value={value as number}
        step="any"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(0);
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    );
  }
  if (t === 'null') {
    return (
      <input
        type="text"
        value=""
        placeholder="(null)"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  // string
  const s = (value ?? '') as string;
  if (s.length > 60 || s.includes('\n')) {
    return (
      <textarea
        rows={Math.min(8, Math.max(2, s.split('\n').length))}
        value={s}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <input type="text" value={s} onChange={(e) => onChange(e.target.value)} />;
}

function RawJsonEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (v: any) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="def-raw">
      <textarea
        rows={Math.min(40, Math.max(6, text.split('\n').length))}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          try {
            const parsed = JSON.parse(v);
            setErr(null);
            onChange(parsed);
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
        spellCheck={false}
      />
      {err && <div className="def-raw-err">{err}</div>}
    </div>
  );
}

export function JsonValueEditor(props: JsonValueEditorProps) {
  const { value, onChange, label, path, onDelete, forceRaw, maxDepth = 6, resolveRef, onNavigateRef } = props;
  const [rawMode, setRawMode] = useState(false);
  const t = detectType(value);
  const showRawToggle = t === 'array' || t === 'object';
  const useRaw = forceRaw || rawMode || path.length >= maxDepth;

  const headerControls = (
    <>
      {showRawToggle && (
        <button
          type="button"
          className="def-raw-toggle"
          onClick={() => setRawMode(!rawMode)}
          title="Toggle raw JSON editor"
        >
          {rawMode ? '◀ Form' : 'JSON ▶'}
        </button>
      )}
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete} title="Remove">
          ×
        </button>
      )}
    </>
  );

  if (useRaw) {
    return (
      <div className="def-field">
        {label !== undefined && (
          <div className="def-field-head">
            <span className="def-field-label">{label}</span>
            <div className="def-field-controls">{headerControls}</div>
          </div>
        )}
        <RawJsonEditor value={value} onChange={onChange} />
      </div>
    );
  }

  if (t === 'array') {
    const arr = value as any[];
    const homogeneousObjects = isHomogeneousObjectArray(arr);
    const stringsOnly = isPrimitiveArray(arr) && arr.every((v) => typeof v === 'string');
    const refs = resolveRef && stringsOnly
      ? (arr as string[]).map((s) => resolveRef(s))
      : null;
    return (
      <div className="def-field">
        {label !== undefined && (
          <div className="def-field-head">
            <span className="def-field-label">{label} <span className="def-type">array · {arr.length}</span></span>
            <div className="def-field-controls">
              <button
                type="button"
                onClick={() => {
                  // Clone the first element if homogeneous, else add a sensible default.
                  const template = homogeneousObjects && arr.length > 0
                    ? JSON.parse(JSON.stringify(arr[0]))
                    : stringsOnly
                      ? ''
                      : null;
                  onChange([...arr, template]);
                }}
                title="Append item"
              >+ Add</button>
              {headerControls}
            </div>
          </div>
        )}
        {stringsOnly ? (
          <StringArrayEditor
            value={arr as string[]}
            onChange={(next) => onChange(next)}
            refTargets={refs}
            onNavigateRef={onNavigateRef}
          />
        ) : (
          <div className="def-array-items">
            {arr.length === 0 && <div className="def-empty">(empty)</div>}
            {arr.map((item, i) => (
              <div className="def-array-item" key={i}>
                <div className="def-array-item-head">
                  <span className="def-array-idx">[{i}]</span>
                  <div className="def-field-controls">
                    <button
                      type="button"
                      onClick={() => {
                        if (i === 0) return;
                        const next = arr.slice();
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        onChange(next);
                      }}
                      disabled={i === 0}
                      title="Move up"
                    >▲</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (i === arr.length - 1) return;
                        const next = arr.slice();
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        onChange(next);
                      }}
                      disabled={i === arr.length - 1}
                      title="Move down"
                    >▼</button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onChange(arr.filter((_, idx) => idx !== i))}
                      title="Remove"
                    >×</button>
                  </div>
                </div>
                <JsonValueEditor
                  value={item}
                  onChange={(v) => {
                    const next = arr.slice();
                    next[i] = v;
                    onChange(next);
                  }}
                  path={[...path, i]}
                  maxDepth={maxDepth}
                  resolveRef={resolveRef}
                  onNavigateRef={onNavigateRef}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (t === 'object') {
    const obj = value as Record<string, any>;
    const keys = Object.keys(obj);
    return (
      <div className="def-field">
        {label !== undefined && (
          <div className="def-field-head">
            <span className="def-field-label">{label} <span className="def-type">object · {keys.length} keys</span></span>
            <div className="def-field-controls">{headerControls}</div>
          </div>
        )}
        <div className="def-object-fields">
          {keys.length === 0 && <div className="def-empty">(empty object)</div>}
          {keys.map((k) => (
            <JsonValueEditor
              key={k}
              value={obj[k]}
              onChange={(v) => onChange({ ...obj, [k]: v })}
              label={k}
              path={[...path, k]}
              maxDepth={maxDepth}
              resolveRef={resolveRef}
              onNavigateRef={onNavigateRef}
            />
          ))}
          <AddPropertyControl
            onAdd={(name, type) => {
              if (!name || name in obj) return;
              const init = type === 'string' ? '' : type === 'number' ? 0 : type === 'boolean' ? false : type === 'array' ? [] : {};
              onChange({ ...obj, [name]: init });
            }}
          />
        </div>
      </div>
    );
  }

  // Primitive
  const refTarget = t === 'string' && resolveRef ? resolveRef(value as string) : null;
  return (
    <div className="def-field def-field-row">
      {label !== undefined && (
        <span className="def-field-label">{label} <span className="def-type">{t}</span></span>
      )}
      <PrimitiveInput value={value} onChange={onChange} />
      {refTarget && onNavigateRef && (
        <button
          type="button"
          className="def-ref-go"
          title={`Go to ${value}`}
          onClick={() => onNavigateRef(refTarget)}
        >→</button>
      )}
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete} title="Remove">×</button>
      )}
    </div>
  );
}

function AddPropertyControl({
  onAdd,
}: {
  onAdd: (name: string, type: 'string' | 'number' | 'boolean' | 'array' | 'object') => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'string' | 'number' | 'boolean' | 'array' | 'object'>('string');
  return (
    <div className="def-add-prop">
      <input
        type="text"
        placeholder="property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select value={type} onChange={(e) => setType(e.target.value as any)}>
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="array">array</option>
        <option value="object">object</option>
      </select>
      <button
        type="button"
        onClick={() => {
          if (name.trim()) {
            onAdd(name.trim(), type);
            setName('');
          }
        }}
        disabled={!name.trim()}
      >+ Add property</button>
    </div>
  );
}
