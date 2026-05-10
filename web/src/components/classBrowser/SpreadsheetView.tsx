import { useMemo, useState } from 'react';
import type { ClassBrowserConfig, Column } from './types';
import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';

interface Props {
  rows: { key: DefinitionsKey; rec: DefinitionRecord }[];
  config: ClassBrowserConfig;
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

export function SpreadsheetView({ rows, config, onPickRow }: Props) {
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

  const click = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="spreadsheet">
      <div className="spreadsheet-head">
        {allCols.map((c) => (
          <div
            key={c.key}
            className={`spreadsheet-h ${sortKey === c.key ? 'sorted' : ''}`}
            style={{ width: c.width }}
            onClick={() => click(c.key)}
          >{c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : ''}</div>
        ))}
      </div>
      <div className="spreadsheet-body">
        {sorted.map(({ key, rec }) => (
          <div key={key} className="spreadsheet-row" onClick={() => onPickRow(key)}>
            {allCols.map((c) => {
              const raw = readPath(rec, c.path);
              const display = c.key === 'id' ? rec.id : c.key === 'display_name' ? (raw ?? humanizeAssetId(rec.id)) : fmt(raw, c.kind);
              return <div key={c.key} className="spreadsheet-cell" style={{ width: c.width }}>{display as string}</div>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
