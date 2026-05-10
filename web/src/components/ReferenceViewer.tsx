import { useMemo, useState } from 'react';
import { humanizeAssetId, humanizeProperty } from './definitionsNaming';

// Two-column "what does this asset reference / what references it" panel.
// Each link jumps the editor to the target asset.

export interface OutgoingRef {
  refClass: string;
  refValue: string;
  refPath: string;
  targetKey: string | null;
}

export interface IncomingRef {
  sourceKey: string;
  sourceFolder: string;
  sourceId: string;
  refClass: string;
  refPath: string;
}

export function ReferenceViewer({
  outgoing,
  incoming,
  onJump,
  defaultOpen = false,
}: {
  outgoing: OutgoingRef[];
  incoming: IncomingRef[];
  onJump: (key: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Strip the leading `properties.` so paths are easier to scan, then
  // humanize each segment so users see "Effects To Apply › Instant Heal"
  // instead of "effects_to_apply.instant_heal".
  const fmtPath = (p: string) => {
    const trimmed = p.startsWith('properties.') ? p.slice('properties.'.length) : p;
    return trimmed
      .split('.')
      .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : humanizeProperty(seg)))
      .join(' › ');
  };

  const outgoingResolved = useMemo(() => outgoing.filter((r) => r.targetKey), [outgoing]);
  const outgoingOrphans = useMemo(() => outgoing.filter((r) => !r.targetKey), [outgoing]);

  return (
    <section className="def-section def-refs">
      <button
        type="button"
        className="def-refs-toggle"
        onClick={() => setOpen((v) => !v)}
        title="Toggle reference viewer"
      >
        <span className="def-refs-caret">{open ? '▾' : '▸'}</span>
        References ·{' '}
        <span className="def-muted">
          {outgoing.length} out · {incoming.length} in
        </span>
        {outgoingOrphans.length > 0 && (
          <span className="def-dirty"> · {outgoingOrphans.length} orphan</span>
        )}
      </button>
      {open && (
        <div className="def-refs-grid">
          <div className="def-refs-col">
            <div className="def-refs-col-head">Outgoing ({outgoing.length})</div>
            {outgoing.length === 0 && <div className="def-empty">no outgoing references</div>}
            {outgoingResolved.map((r, i) => (
              <div className="def-refs-row" key={`out-${i}`}>
                <a
                  className="def-refs-link"
                  onClick={() => onJump(r.targetKey!)}
                  title={r.refValue}
                >
                  {humanizeAssetId(r.refValue)}
                </a>
                <span className="def-muted">{r.refClass}</span>
                <code className="def-refs-path">{fmtPath(r.refPath)}</code>
              </div>
            ))}
            {outgoingOrphans.map((r, i) => (
              <div className="def-refs-row def-refs-orphan" key={`orphan-${i}`} title="Target not found in loaded set">
                <span
                  className="def-refs-link def-refs-link-broken"
                  title={r.refValue}
                >
                  {humanizeAssetId(r.refValue)}
                </span>
                <span className="def-muted">{r.refClass}</span>
                <code className="def-refs-path">{fmtPath(r.refPath)}</code>
              </div>
            ))}
          </div>
          <div className="def-refs-col">
            <div className="def-refs-col-head">Incoming ({incoming.length})</div>
            {incoming.length === 0 && <div className="def-empty">no incoming references</div>}
            {incoming.map((r, i) => (
              <div className="def-refs-row" key={`in-${i}`}>
                <a
                  className="def-refs-link"
                  onClick={() => onJump(r.sourceKey)}
                  title={r.sourceId}
                >
                  {humanizeAssetId(r.sourceId)}
                </a>
                <span className="def-muted">{r.sourceFolder}</span>
                <code className="def-refs-path">{fmtPath(r.refPath)}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
