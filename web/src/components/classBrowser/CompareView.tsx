import { useMemo } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';

interface Props {
  selected: DefinitionsKey[];
}

function flatten(properties: any, prefix: string[] = []): { path: string; value: any }[] {
  const out: { path: string; value: any }[] = [];
  if (!properties || typeof properties !== 'object') return out;
  for (const [k, v] of Object.entries(properties)) {
    const path = [...prefix, k].join('.');
    if (v && typeof v === 'object' && (v as any).type === 'struct' && (v as any).value && typeof (v as any).value === 'object') {
      out.push(...flatten((v as any).value, [...prefix, k]));
    } else {
      out.push({ path, value: v });
    }
  }
  return out;
}

function shortValue(env: any): string {
  if (env == null) return '—';
  if (typeof env !== 'object') return String(env);
  if (env.type === 'array') return `[${(env.value ?? []).length}]`;
  if (env.type === 'map')   return `{${(env.value ?? []).length}}`;
  if (env.type === 'struct') return `struct ${env.struct_name ?? ''}`.trim();
  if ('value' in env) return String(env.value);
  return '?';
}

export function CompareView({ selected }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const recs = selected.map((k) => definitions.get(k)).filter(Boolean);

  const allPaths = useMemo(() => {
    const set = new Set<string>();
    for (const rec of recs) for (const f of flatten(rec!.json?.properties)) set.add(f.path);
    return [...set].sort();
  }, [recs]);

  const rows = useMemo(() => {
    return allPaths.map((p) => {
      const values = recs.map((rec) => {
        const segs = p.split('.');
        let cur: any = rec!.json?.properties;
        for (const s of segs) { if (cur == null) return undefined; cur = cur[s]; }
        return shortValue(cur);
      });
      const allSame = values.every((v) => v === values[0]);
      return { path: p, values, allSame };
    });
  }, [recs, allPaths]);

  const diffs = rows.filter((r) => !r.allSame);
  const same = rows.filter((r) => r.allSame);

  return (
    <div className="compare">
      <div className="compare-head">
        <div className="compare-cell muted">Property</div>
        {recs.map((rec) => (
          <div key={rec!.id} className="compare-cell"><strong>{humanizeAssetId(rec!.id)}</strong><br/><span className="muted small">{String(rec!.json?.class).replace(/^U/, '')}</span></div>
        ))}
      </div>
      {diffs.map((r) => (
        <div key={r.path} className="compare-row diff">
          <div className="compare-cell muted">{r.path}</div>
          {r.values.map((v, i) => <div key={i} className="compare-cell">{v ?? '—'}</div>)}
        </div>
      ))}
      <details className="compare-same">
        <summary>matching properties ({same.length})</summary>
        {same.map((r) => (
          <div key={r.path} className="compare-row">
            <div className="compare-cell muted">{r.path}</div>
            {r.values.map((v, i) => <div key={i} className="compare-cell muted">{v ?? '—'}</div>)}
          </div>
        ))}
      </details>
    </div>
  );
}
