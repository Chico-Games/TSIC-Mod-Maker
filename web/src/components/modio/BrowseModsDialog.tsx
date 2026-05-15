import { useEffect, useRef, useState } from 'react';
import { useModIoStore } from '../../store/modIoStore';
import { parseModioRef } from '../../modio/parseRef';
import { ModDetailPanel } from './ModDetailPanel';
import type { ModioMod } from '../../modio/types';

const SORTS: { value: string; label: string }[] = [
  { value: '-date_updated', label: 'Recently updated' },
  { value: '-date_live', label: 'Recently released' },
  { value: '-downloads_total', label: 'Most downloaded' },
  { value: '-subscribers_total', label: 'Most subscribed' },
  { value: '-ratings_weighted_aggregate', label: 'Highest rated' },
  { value: 'popular', label: 'Popular' },
  { value: 'name', label: 'Name A→Z' },
];

export function BrowseModsDialog() {
  const open = useModIoStore((s) => s.browseDialogOpen);
  const close = useModIoStore((s) => s.closeBrowse);
  const listing = useModIoStore((s) => s.listing);
  const search = useModIoStore((s) => s.searchBrowse);
  const loadMore = useModIoStore((s) => s.loadMoreBrowse);
  const openMod = useModIoStore((s) => s.openModAsProject);
  const openByRef = useModIoStore((s) => s.openModByRef);
  const selectMod = useModIoStore((s) => s.selectMod);
  const selectedMod = useModIoStore((s) => s.selectedMod);
  const gameTagOptions = useModIoStore((s) => s.gameTagOptions);
  const isSignedIn = useModIoStore((s) => !!s.token);
  const busy = useModIoStore((s) => s.busy);
  const lastError = useModIoStore((s) => s.lastError);

  const [q, setQ] = useState('');
  const [sort, setSort] = useState('-date_updated');
  const [scope, setScope] = useState<'public' | 'mine'>('public');
  const [tagsOr, setTagsOr] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const ref = parseModioRef(q);
  const isPasteOpenable = ref?.kind === 'url' || ref?.kind === 'id';

  // Sync local controls from store on open.
  useEffect(() => {
    if (open && listing) {
      setQ(listing.query);
      setSort(listing.sort);
      setScope(listing.scope);
      setTagsOr(listing.tagsOr);
    }
  }, [open, listing?.query, listing?.sort, listing?.scope, listing?.tagsOr]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (listing == null) return;
    if (isPasteOpenable) return;
    const sameTags =
      listing.tagsOr.length === tagsOr.length &&
      listing.tagsOr.every((t, i) => t === tagsOr[i]);
    if (q === listing.query && sort === listing.sort && scope === listing.scope && sameTags) return;
    const t = setTimeout(() => { void search({ q, sort, scope, tagsOr }); }, 300);
    return () => clearTimeout(t);
  }, [q, sort, scope, tagsOr, open, listing, isPasteOpenable, search]);

  // Infinite scroll.
  useEffect(() => {
    if (!open) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) void loadMore();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [open, loadMore, listing?.mods.length]);

  if (!open) return null;

  const exhausted = listing?.exhausted ?? false;
  const loading = listing?.loading ?? false;
  const total = listing?.total ?? 0;
  const shown = listing?.mods.length ?? 0;

  function toggleTag(t: string) {
    setTagsOr((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }

  return (
    <div
      onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, width: 'min(1100px, 95vw)', height: 'min(760px, 90vh)', padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, flex: 1 }}>📥 Browse mods</h2>
          {isSignedIn && (
            <div role="tablist" style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <button
                role="tab"
                aria-selected={scope === 'public'}
                onClick={() => setScope('public')}
                style={{ borderRadius: 0, borderRight: '1px solid var(--border)', padding: '4px 10px', background: scope === 'public' ? 'var(--accent)' : 'var(--panel-2)', color: scope === 'public' ? '#0a0d12' : 'var(--text)' }}
              >All</button>
              <button
                role="tab"
                aria-selected={scope === 'mine'}
                onClick={() => setScope('mine')}
                style={{ borderRadius: 0, padding: '4px 10px', background: scope === 'mine' ? 'var(--accent)' : 'var(--panel-2)', color: scope === 'mine' ? '#0a0d12' : 'var(--text)' }}
              >My mods</button>
            </div>
          )}
          <button onClick={close}>Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 200px', gap: 8, marginBottom: 12 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (ref) { void openByRef(q); setQ(''); }
            }}
            placeholder="Search by name, or paste a mod.io link / slug / ID…"
            style={{ width: '100%' }}
          />
          <button
            disabled={!isPasteOpenable || busy === 'fetching' || busy === 'opening'}
            onClick={() => { void openByRef(q); setQ(''); }}
            title={isPasteOpenable ? 'Open this mod' : 'Paste a mod.io URL or numeric ID to enable'}
          >
            {busy === 'fetching' || busy === 'opening' ? 'Opening…' : 'Open'}
          </button>
          <button onClick={() => setFiltersOpen((v) => !v)} title="Tag filters">
            🏷 Tags {tagsOr.length > 0 && <span style={{ background: 'var(--accent)', color: '#0a0d12', borderRadius: 999, padding: '0 6px', marginLeft: 4 }}>{tagsOr.length}</span>}
          </button>
          <select value={sort} onChange={(e) => setSort(e.target.value)} disabled={isPasteOpenable}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {filtersOpen && gameTagOptions && gameTagOptions.length > 0 && (
          <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 8, fontSize: 12, maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ flex: 1 }}>Filter by tags (any-of):</strong>
              <button style={{ fontSize: 11 }} onClick={() => setTagsOr([])} disabled={tagsOr.length === 0}>Clear</button>
            </div>
            {gameTagOptions.map((opt) => (
              <div key={opt.name} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>{opt.name}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {opt.tags.map((t) => {
                    const on = tagsOr.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => toggleTag(t)}
                        style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: on ? 'var(--accent)' : 'var(--bg)',
                          color: on ? '#0a0d12' : 'var(--text)',
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                        }}
                      >{t}</button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {lastError && (
          <div style={{ padding: 8, background: 'rgba(239,108,108,0.1)', border: '1px solid var(--error)', borderRadius: 4, color: 'var(--error)', fontSize: 12, marginBottom: 8 }}>
            {lastError.message}
          </div>
        )}

        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>
          {isPasteOpenable
            ? `Press Enter or click Open to load this ${ref?.kind === 'id' ? 'mod by ID' : 'mod by link'}.`
            : listing == null
              ? 'Loading…'
              : `${shown} of ${total} mods${q ? ` matching "${q}"` : ''}${scope === 'mine' ? ' (yours)' : ''}`}
        </div>

        <div
          data-modio-grid
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
            alignContent: 'start',
            paddingRight: selectedMod ? 'min(440px, 50%)' : 0,
            transition: 'padding-right 120ms ease-out',
          }}
        >
          {listing?.mods.map((m) => (
            <ModCard
              key={m.id}
              mod={m}
              isSelected={selectedMod?.id === m.id}
              onSelect={() => void selectMod(m)}
              onOpen={() => void openMod(m)}
              busy={busy === 'opening' || busy === 'fetching'}
            />
          ))}
          <div ref={sentinelRef} style={{ gridColumn: '1 / -1', minHeight: 1 }} />
          {loading && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--muted)', textAlign: 'center', padding: 12 }}>Loading more…</div>
          )}
          {!loading && exhausted && shown > 0 && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--muted)', textAlign: 'center', padding: 12, fontSize: 12 }}>
              — End of results —
            </div>
          )}
          {!loading && shown === 0 && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
              No mods found{q ? ` for "${q}"` : ''}.
            </div>
          )}
        </div>

        {selectedMod && (
          <ModDetailPanel mod={selectedMod} onClose={() => void selectMod(null)} />
        )}
      </div>
    </div>
  );
}

function ModCard({ mod, isSelected, onSelect, onOpen, busy }: { mod: ModioMod; isSelected: boolean; onSelect: () => void; onOpen: () => void; busy: boolean }) {
  return (
    <div
      data-modio-card
      data-mod-id={mod.id}
      onClick={onSelect}
      style={{
        background: 'var(--panel-2)',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 6,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
      }}
    >
      {mod.logo?.thumb_320x180 ? (
        <img src={mod.logo.thumb_320x180} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 4 }} />
      ) : (
        <div style={{ height: 110, background: 'var(--bg)', borderRadius: 4 }} />
      )}
      <div style={{ fontWeight: 600, fontSize: 13 }}>{mod.name}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
        {mod.summary}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 18 }}>
        {mod.tags.slice(0, 4).map((t) => (
          <span key={t.name} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--bg)', color: 'var(--muted)' }}>{t.name}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        <button
          disabled={busy || !mod.modfile?.download}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          style={{ flex: 1 }}
          className="primary"
        >
          Open
        </button>
        <a href={mod.profile_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <button>↗</button>
        </a>
      </div>
    </div>
  );
}
