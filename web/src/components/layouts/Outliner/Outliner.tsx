import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useLayoutResolverStore } from '../../../store/layoutResolverStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { OutlinerRow } from './OutlinerRow';

export function Outliner() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const seed = useLayoutEditorStore((s) => s.seed);
  const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);
  const selected = useLayoutEditorStore((s) => s.selectedIndices);
  const setSelection = useLayoutEditorStore((s) => s.setSelection);
  const toggleSelection = useLayoutEditorStore((s) => s.toggleSelection);
  const extendSelection = useLayoutEditorStore((s) => s.extendSelection);
  const resolveLayout = useLayoutResolverStore((s) => s.resolveLayout);
  const definitions = useDefinitionsStore((s) => s.definitions);

  if (!layoutKey) {
    return <div className="outliner-empty">No layout selected.</div>;
  }

  const layoutRec = definitions.get(layoutKey);
  const tileTags = tileTagsOverride.length > 0
    ? tileTagsOverride
    : (layoutRec?.json?.properties?.gameplay_tags?.value as string[] | undefined) ?? [];
  const resolved = resolveLayout(layoutKey, seed, tileTags);

  return (
    <div className="outliner">
      {resolved.map((r, i) => (
        <OutlinerRow
          key={i}
          resolved={r}
          selected={selected.includes(i)}
          onClick={(e) => {
            if (e.shiftKey) extendSelection(i);
            else if (e.ctrlKey || e.metaKey) toggleSelection(i);
            else setSelection([i]);
          }}
        />
      ))}
    </div>
  );
}
