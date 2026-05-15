import { useModIoStore } from '../../store/modIoStore';
import type { ModioMod } from '../../modio/types';

export function ModDetailPanel({ mod, onClose }: { mod: ModioMod; onClose: () => void }) {
  const files = useModIoStore((s) => s.selectedModfiles);
  const deps = useModIoStore((s) => s.selectedDependencies);
  const loading = useModIoStore((s) => s.selectedLoading);
  const openMod = useModIoStore((s) => s.openModAsProject);
  const promoteModfile = useModIoStore((s) => s.promoteModfile);
  const addDep = useModIoStore((s) => s.addModDependency);
  const removeDep = useModIoStore((s) => s.removeModDependency);
  const sidecar = useModIoStore((s) => s.sidecar);
  const busy = useModIoStore((s) => s.busy);

  const isOwnedBound = sidecar?.mod_id != null;
  const isThisModBound = sidecar?.mod_id === mod.id;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(440px, 50%)',
        background: 'var(--panel)',
        borderLeft: '1px solid var(--border)',
        padding: 14,
        overflowY: 'auto',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
        zIndex: 5,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{mod.name}</h3>
        <button onClick={onClose} title="Close panel">✕</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <a href={mod.profile_url} target="_blank" rel="noopener noreferrer">
          <button style={{ fontSize: 11 }}>View on mod.io ↗</button>
        </a>
        <button
          className="primary"
          disabled={busy === 'opening' || !mod.modfile?.download}
          onClick={() => void openMod(mod)}
          style={{ fontSize: 12 }}
        >
          Open as project
        </button>
      </div>

      {mod.logo?.thumb_640x360 && (
        <img src={mod.logo.thumb_640x360} alt="" style={{ width: '100%', borderRadius: 4, marginBottom: 8 }} />
      )}

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{mod.summary}</div>
      {mod.description_plaintext && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ fontSize: 12, cursor: 'pointer' }}>Full description</summary>
          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 6, color: 'var(--text)' }}>
            {mod.description_plaintext}
          </div>
        </details>
      )}

      {mod.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          {mod.tags.map((t) => (
            <span key={t.name} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--bg)', color: 'var(--muted)' }}>{t.name}</span>
          ))}
        </div>
      )}

      <Section title={`Modfile history (${files?.length ?? 0})`}>
        {loading && !files && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
        {files && files.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No modfiles published yet.</div>}
        {files && files.map((f) => {
          const isActive = mod.modfile?.id === f.id;
          return (
            <div
              key={f.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '4px 6px',
                borderRadius: 4,
                background: isActive ? 'rgba(54,198,155,0.08)' : 'transparent',
                marginBottom: 2,
              }}
            >
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: isActive ? 'var(--accent-2)' : 'var(--muted)', minWidth: 60 }}>
                {isActive ? '● active' : '○'} {f.version || `#${f.id}`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.changelog ?? ''}>
                {f.changelog || ''}
              </span>
              {isThisModBound && !isActive && (
                <button
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => void promoteModfile(f.id)}
                  title="Make this the active modfile"
                >
                  Promote
                </button>
              )}
            </div>
          );
        })}
      </Section>

      <Section title={`Dependencies (${deps?.length ?? 0})`}>
        {loading && !deps && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
        {deps && deps.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>None.</div>}
        {deps && deps.map((d) => (
          <div key={d.mod_id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 11, flex: 1 }}>{d.mod_name_id}</span>
            {isThisModBound && (
              <button style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => void removeDep(d.mod_id)}>Remove</button>
            )}
          </div>
        ))}
        {isOwnedBound && !isThisModBound && (
          <button
            style={{ fontSize: 11, marginTop: 4 }}
            onClick={() => void addDep(mod.id)}
            title={`Add this mod as a dependency of your bound mod (${sidecar?.name_id ?? '?'}).`}
          >
            + Make my mod depend on this
          </button>
        )}
      </Section>

      {mod.media?.images && mod.media.images.length > 0 && (
        <Section title={`Gallery (${mod.media.images.length})`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {mod.media.images.map((img) => (
              <img
                key={img.filename}
                src={img.thumb_320x180 ?? img.original}
                alt=""
                style={{ width: '100%', borderRadius: 3 }}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
      {children}
    </div>
  );
}
