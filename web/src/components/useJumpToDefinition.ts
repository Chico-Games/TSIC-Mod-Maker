import { useCallback } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';

/** Returns a `(assetId) => void` that selects the asset in the
 *  Definitions tab and switches there. Wire it to `onAuxClick` (mouse
 *  middle button) on any UI element that represents a reference to an
 *  asset, so the user can quick-jump from anywhere. */
export function useJumpToDefinition(): (assetId: string) => void {
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);
  return useCallback((assetId: string) => {
    if (!assetId) return;
    const k = findKeyById(assetId);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  }, [findKeyById, definitions, selectFolder, selectDefinition, setTab]);
}

/** Pure helper: middle-click test for a React mouse event. The
 *  middle button gives `button === 1` on `onMouseDown` / `onAuxClick`
 *  in every browser the app targets. */
export function isMiddleClick(e: React.MouseEvent): boolean {
  return e.button === 1;
}
