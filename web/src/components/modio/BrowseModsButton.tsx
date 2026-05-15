import { useModIoStore } from '../../store/modIoStore';
import { BrowseModsDialog } from './BrowseModsDialog';

export function BrowseModsButton() {
  const cfg = useModIoStore((s) => s.cfg);
  const openBrowse = useModIoStore((s) => s.openBrowse);
  if (!cfg) return null;
  return (
    <>
      <button onClick={openBrowse} title="Browse mods on mod.io">
        📥 Browse mods
      </button>
      <BrowseModsDialog />
    </>
  );
}
