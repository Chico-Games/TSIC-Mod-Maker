import { useEffect } from 'react';
import { useLayoutEditorStore } from '../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { Toolbar } from './Toolbar';
import { Outliner } from './Outliner/Outliner';
import { DetailsPanel } from './Details/DetailsPanel';
import { Viewport } from './Viewport/Viewport';

export function LayoutsTab() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const selected = useLayoutEditorStore((s) => s.selectedIndices);
  const clearSelection = useLayoutEditorStore((s) => s.clearSelection);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (!layoutKey || selected.length === 0) return;
      const rec = definitions.get(layoutKey);
      const cur = (rec?.json?.properties?.layout_objects?.value as any[] | undefined) ?? [];
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const next = cur.filter((_, i) => !selected.includes(i));
        updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value'], next);
        clearSelection();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const dupes = selected.map((i) => JSON.parse(JSON.stringify(cur[i])));
        for (const d of dupes) {
          const x = d?.value?.transform?.value?.translation?.value?.x;
          if (x) x.value += 50;
        }
        const next = [...cur, ...dupes];
        updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value'], next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layoutKey, selected, definitions, clearSelection, updateValueAtPath]);

  return (
    <div className="layouts-tab">
      <Toolbar />
      <div className="layouts-panes">
        <div className="layouts-outliner"><Outliner /></div>
        <div className="layouts-viewport"><Viewport /></div>
        <div className="layouts-details"><DetailsPanel /></div>
      </div>
    </div>
  );
}
