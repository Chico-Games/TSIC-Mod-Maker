import { useEffect, useState } from 'react';
import { useModIoStore, type PublishWizardStep } from '../../store/modIoStore';
import { getMyMods } from '../../modio/endpoints';
import type { ModioMod } from '../../modio/types';

export function PublishWizard() {
  const open = useModIoStore((s) => s.publishWizardOpen);
  const close = useModIoStore((s) => s.closePublishWizard);
  const step = useModIoStore((s) => s.publishWizardStep);
  const setStep = useModIoStore((s) => s.setPublishStep);
  const sidecar = useModIoStore((s) => s.sidecar);
  const error = useModIoStore((s) => s.lastError);

  // When the wizard opens with a mod already bound, jump straight to modfile.
  useEffect(() => {
    if (!open) return;
    if (sidecar?.mod_id != null && step === 'bind') setStep('meta');
  }, [open, sidecar?.mod_id, step, setStep]);

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, width: 'min(720px, 95vw)', maxHeight: '90vh', padding: 20, display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, flex: 1 }}>📤 Publish to mod.io</h2>
          <button onClick={close}>Close</button>
        </div>
        <Stepper step={step} />
        {error && (
          <div style={{ padding: 8, background: 'rgba(239,108,108,0.1)', border: '1px solid var(--error)', borderRadius: 4, color: 'var(--error)', fontSize: 12, margin: '8px 0' }}>
            {error.message}
          </div>
        )}
        <div style={{ overflowY: 'auto', flex: 1, paddingTop: 12 }}>
          {step === 'bind' && <BindStep />}
          {step === 'meta' && <MetadataStep />}
          {step === 'modfile' && <ModfileStep />}
          {step === 'done' && <DoneStep />}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: PublishWizardStep }) {
  const items: { id: PublishWizardStep; label: string }[] = [
    { id: 'bind', label: '1. Bind' },
    { id: 'meta', label: '2. Metadata' },
    { id: 'modfile', label: '3. Modfile' },
    { id: 'done', label: '4. Done' },
  ];
  const idx = items.findIndex((i) => i.id === step);
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 12 }}>
      {items.map((it, i) => (
        <span key={it.id} style={{ color: i <= idx ? 'var(--accent)' : 'var(--muted)' }}>{it.label}</span>
      ))}
    </div>
  );
}

function BindStep() {
  const client = useModIoStore((s) => s.client);
  const sidecar = useModIoStore((s) => s.sidecar);
  const bindToMod = useModIoStore((s) => s.bindToMod);
  const setStep = useModIoStore((s) => s.setPublishStep);
  const setDraft = useModIoStore((s) => s.setDraft);
  const [mods, setMods] = useState<ModioMod[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!client) return;
    setLoading(true);
    (async () => {
      try {
        const r = await getMyMods(client, { gameId: client.cfg.gameId, limit: 50 });
        setMods(r.data);
      } finally { setLoading(false); }
    })();
  }, [client]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
        Connect this project to a mod on mod.io. You can either create a new one or link to a mod you already own.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>Create a new mod</strong>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
          Choose a name and summary; we'll create the mod entry and bind it to this project.
        </p>
        <button
          className="primary"
          onClick={async () => {
            // Seed draft with project meta name if empty
            if (!sidecar || !sidecar.draft.name) await setDraft({ name: sidecar?.draft.name || 'My TSIC Mod' });
            setStep('meta');
          }}
        >
          → Create new mod
        </button>
      </div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>Or link to one of your existing mods</strong>
        {loading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
        {!loading && mods && mods.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>You have no mods on this game yet.</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {mods?.map((m) => (
            <button
              key={m.id}
              onClick={async () => { await bindToMod(m.id); setStep('meta'); }}
              style={{ textAlign: 'left', padding: 8 }}
            >
              <div style={{ fontWeight: 600 }}>{m.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>{m.summary.slice(0, 80)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetadataStep() {
  const sidecar = useModIoStore((s) => s.sidecar);
  const setDraft = useModIoStore((s) => s.setDraft);
  const createMod = useModIoStore((s) => s.createMod);
  const pushMetadata = useModIoStore((s) => s.pushMetadata);
  const saveLogo = useModIoStore((s) => s.saveLogoFromFile);
  const ensureTags = useModIoStore((s) => s.ensureGameTags);
  const tagOptions = useModIoStore((s) => s.gameTagOptions);
  const busy = useModIoStore((s) => s.busy);
  const setStep = useModIoStore((s) => s.setPublishStep);

  useEffect(() => { void ensureTags(); }, [ensureTags]);

  if (!sidecar) return <div>No project bound.</div>;
  const draft = sidecar.draft;
  const isNew = sidecar.mod_id == null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Mod name (≤80)">
        <input value={draft.name} maxLength={80} onChange={(e) => void setDraft({ name: e.target.value })} />
      </Field>
      <Field label="Summary (≤250)">
        <textarea
          value={draft.summary}
          maxLength={250}
          rows={2}
          onChange={(e) => void setDraft({ summary: e.target.value })}
        />
      </Field>
      <Field label="Description (markdown, optional)">
        <textarea
          value={draft.description_md ?? ''}
          rows={4}
          onChange={(e) => void setDraft({ description_md: e.target.value || null })}
        />
      </Field>
      <Field label="Logo (PNG/JPG/GIF, ≥512×288)">
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void saveLogo(f); }}
        />
        {draft.logo_path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Saved at <code>{draft.logo_path}</code></div>}
      </Field>
      {tagOptions && tagOptions.length > 0 && (
        <Field label="Tags">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {tagOptions.map((opt) => (
              <div key={opt.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong style={{ fontSize: 11 }}>{opt.name}</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {opt.tags.map((t) => {
                    const on = draft.tags.includes(t);
                    return (
                      <label key={t} style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type={opt.type === 'dropdown' ? 'radio' : 'checkbox'}
                          name={`tag-${opt.name}`}
                          checked={on}
                          onChange={(e) => {
                            const nextTags = new Set(draft.tags);
                            if (opt.type === 'dropdown') {
                              for (const x of opt.tags) nextTags.delete(x);
                            }
                            if (e.target.checked) nextTags.add(t); else nextTags.delete(t);
                            void setDraft({ tags: [...nextTags] });
                          }}
                        />
                        {t}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Field>
      )}
      <Field label="Visibility">
        <label style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={draft.visible === 1}
            onChange={(e) => void setDraft({ visible: e.target.checked ? 1 : 0 })}
          />
          Public (visible in mod.io listings)
        </label>
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => setStep('bind')}>← Back</button>
        <button
          className="primary"
          disabled={busy !== 'idle' || !draft.name || !draft.summary || (isNew && !draft.logo_path)}
          onClick={async () => {
            try {
              if (isNew) await createMod();
              else await pushMetadata();
              setStep('modfile');
            } catch { /* error shown above */ }
          }}
        >
          {busy === 'uploading' ? 'Saving…' : isNew ? 'Create mod →' : 'Save metadata →'}
        </button>
      </div>
    </div>
  );
}

function ModfileStep() {
  const sidecar = useModIoStore((s) => s.sidecar);
  const lastPack = useModIoStore((s) => s.lastPack);
  const packCurrent = useModIoStore((s) => s.packCurrent);
  const pushModfile = useModIoStore((s) => s.pushModfile);
  const setStep = useModIoStore((s) => s.setPublishStep);
  const busy = useModIoStore((s) => s.busy);
  const publishIssues = useModIoStore((s) => s.publishIssues);
  const [version, setVersion] = useState(sidecar?.draft.next_version ?? '0.1.0');
  const [changelog, setChangelog] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => { if (!lastPack) void packCurrent(); }, [lastPack, packCurrent]);

  const issues = publishIssues({ willPushModfile: true, pendingVersion: version });
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (!sidecar?.mod_id) return <div>Mod is not bound.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: 12 }}>
        {busy === 'packing' || !lastPack ? (
          <div style={{ color: 'var(--muted)' }}>Packing project…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div><strong>{lastPack.files.length}</strong> files in the modfile ({lastPack.added.length} new, {lastPack.modified.length} modified). {lastPack.unchangedCount} unchanged.</div>
            <div style={{ color: 'var(--muted)' }}>Size: {(lastPack.size / 1024).toFixed(1)} KB</div>
            <div style={{ color: 'var(--muted)' }}>MD5: <code>{lastPack.md5}</code></div>
          </div>
        )}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {errors.map((i, idx) => (
            <div key={`e${idx}`} style={{ fontSize: 12, color: 'var(--error)' }}>⚠ {i.message}</div>
          ))}
          {warnings.map((i, idx) => (
            <div key={`w${idx}`} style={{ fontSize: 12, color: 'var(--warn)' }}>ℹ {i.message}</div>
          ))}
        </div>
      )}

      <Field label="Version">
        <input value={version} onChange={(e) => setVersion(e.target.value)} />
      </Field>
      <Field label="Changelog">
        <textarea
          value={changelog}
          rows={5}
          placeholder={`- Added a new station\n- Tweaked recipe outputs`}
          onChange={(e) => setChangelog(e.target.value)}
        />
      </Field>
      <Field label="Activation">
        <label style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Make this the active modfile (users download this version)
        </label>
        {!active && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Will upload as a draft. You can promote it later from the mod detail panel.
          </div>
        )}
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => setStep('meta')}>← Back</button>
        <button
          className="primary"
          disabled={busy !== 'idle' || errors.length > 0}
          onClick={async () => {
            try { await pushModfile({ version, changelog, active }); } catch { /* shown */ }
          }}
        >
          {busy === 'uploading' ? 'Uploading…' : active ? 'Publish modfile' : 'Upload draft'}
        </button>
      </div>
    </div>
  );
}

function DoneStep() {
  const remoteMod = useModIoStore((s) => s.remoteMod);
  const close = useModIoStore((s) => s.closePublishWizard);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <h3 style={{ margin: 0, color: 'var(--accent-2)' }}>✓ Published!</h3>
      {remoteMod && (
        <a href={remoteMod.profile_url} target="_blank" rel="noopener noreferrer">
          View on mod.io ↗
        </a>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
        mod.io will run a virus scan on the file before it's downloadable. You can check status on the profile page.
      </p>
      <button className="primary" onClick={close}>Done</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  );
}
