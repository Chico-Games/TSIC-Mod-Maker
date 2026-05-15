import { useModIoStore } from '../../store/modIoStore';

export function SyncChip() {
  const cfg = useModIoStore((s) => s.cfg);
  const state = useModIoStore((s) => s.syncState);
  const sidecar = useModIoStore((s) => s.sidecar);
  if (!cfg || !sidecar) return null;
  const { label, color, title } = labelFor(state, sidecar.mod_id);
  return (
    <span
      className="modio-sync-chip"
      style={{
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 11,
        marginLeft: 8,
      }}
      title={title}
    >
      <span aria-hidden="true">●</span>
      {label}
    </span>
  );
}

function labelFor(state: string, modId: number | null): { label: string; color: string; title: string } {
  if (modId == null) return { label: 'mod.io: not bound', color: '#8a96a8', title: 'This project is not connected to a mod on mod.io. Use Publish to bind it.' };
  switch (state) {
    case 'clean': return { label: 'mod.io: synced', color: '#36c69b', title: 'Local matches last push and remote.' };
    case 'local-newer': return { label: 'mod.io: local newer', color: '#f0b35e', title: 'You have unpushed changes. Click Publish to upload.' };
    case 'remote-newer': return { label: 'mod.io: remote newer', color: '#5fb3ff', title: 'Remote has a newer modfile than your last push.' };
    case 'diverged': return { label: 'mod.io: diverged', color: '#ef6c6c', title: 'Both local and remote diverge from your last push.' };
    default: return { label: 'mod.io: unknown', color: '#8a96a8', title: 'Pack the project to compute sync state.' };
  }
}
