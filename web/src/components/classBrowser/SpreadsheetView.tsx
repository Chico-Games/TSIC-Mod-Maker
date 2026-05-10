import { useMemo, useState } from 'react';
import type { ClassBrowserConfig, Column } from './types';
import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';
import { TypedFieldCell } from '../TypedFieldCell';
import type { RefAdapter } from '../TypedValueEditor';

interface Props {
  rows: { key: DefinitionsKey; rec: DefinitionRecord }[];
  config: ClassBrowserConfig;
  refAdapter: RefAdapter;
  onChange: (key: DefinitionsKey, path: (string | number)[], next: any) => void;
  onPickRow: (key: DefinitionsKey) => void;
}

function readPath(rec: DefinitionRecord, path: string[]): any {
  let cur: any = rec.json;
  for (const seg of path) { if (cur == null) return undefined; cur = cur[seg]; }
  return cur;
}

function fmt(v: any, kind: Column['kind']): string {
  if (v == null) return '—';
  switch (kind) {
    case 'number': return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
    case 'bool': return v ? '✓' : '·';
    case 'tag': return String(v).split('.').slice(-2).join('.');
    case 'ref': return String(v);
    case 'count': return Array.isArray(v) ? String(v.length) : '0';
    case 'string': default: return String(v);
  }
}

function envelopePathFor(col: Column): string[] | null {
  if (col.envelopePath) return col.envelopePath;
  if (col.path.length === 0) return null;
  if (col.path[col.path.length - 1] !== 'value') return null;
  return col.path.slice(0, -1);
}

function isTypedEnvelope(v: any): boolean {
  return v != null && typeof v === 'object' && typeof v.type === 'string';
}

function bareClass(rec: DefinitionRecord): string {
  return String(rec.json?.class ?? '').replace(/^U/, '');
}

export function SpreadsheetView({ rows, config, refAdapter, onChange, onPickRow }: Props) {
  const [sortKey, setSortKey] = useState<string>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const allCols: Column[] = useMemo(() => {
    const defaults: Column[] = [
      { key: 'id', label: 'ID', path: ['id'], kind: 'string' },
      { key: 'display_name', label: 'Name', path: ['properties','display_name','value'], kind: 'string' },
    ];
    const hasLevel = rows.some((r) => readPath(r.rec, ['properties','level','value']) != null);
    if (hasLevel) defaults.push({ key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 });
    return [...defaults, ...config.columns];
  }, [rows, config.columns]);

  const sorted = useMemo(() => {
    const col = allCols.find((c) => c.key === sortKey) ?? allCols[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = readPath(a.rec, col.path);
      const vb = readPath(b.rec, col.path);
      if (va == null && vb == null) return 0;
      if (va == null) return -1 * dir;
      if (vb == null) return 1 * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sortKey, sortDir, allCols]);

  const clickHeader = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="spreadsheet">
      <div className="spreadsheet-head">
        <div className="spreadsheet-h open-col" aria-hidden></div>
        {allCols.map((c) => (
          <div
            key={c.key}
            className={`spreadsheet-h ${sortKey === c.key ? 'sorted' : ''}`}
            style={{ width: c.width }}
            onClick={() => clickHeader(c.key)}
          >{c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : ''}</div>
        ))}
      </div>
      <div className="spreadsheet-body">
        {sorted.map(({ key, rec }) => (
          <div key={key} className="spreadsheet-row">
            <button
              className="spreadsheet-open"
              title="Open in Detail"
              onClick={(e) => { e.stopPropagation(); onPickRow(key); }}
            >↗</button>
            {allCols.map((c) => {
              if (c.key === 'id') {
                return (
                  <div key={c.key} className="spreadsheet-cell id" style={{ width: c.width }} onClick={() => onPickRow(key)}>{rec.id}</div>
                );
              }
              const envPath = envelopePathFor(c);
              const env = envPath ? readPath(rec, envPath) : null;
              const editable = isTypedEnvelope(env);
              if (!editable) {
                const raw = readPath(rec, c.path);
                const display = c.key === 'display_name' ? (raw ?? humanizeAssetId(rec.id)) : fmt(raw, c.kind);
                return <div key={c.key} className="spreadsheet-cell" style={{ width: c.width }}>{display as string}</div>;
              }
              return (
                <div key={c.key} className="spreadsheet-cell editable" style={{ width: c.width }}>
                  <TypedFieldCell
                    typed={env}
                    propertyName={envPath![envPath!.length - 1] as string}
                    parentTypeName={bareClass(rec)}
                    refAdapter={refAdapter}
                    onChange={(next) => onChange(key, envPath as (string | number)[], next)}
                    path={envPath as (string | number)[]}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
