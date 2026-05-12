import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { TypedPropertiesEditor } from '../../TypedValueEditor';
import { useRefAdapter } from '../../useRefAdapter';
import type { LayoutObject } from '../types';

/** Right-pane details for the Layouts tab. Wraps `TypedPropertiesEditor`
 *  on the first selected LayoutObject's `value` map and writes back
 *  through `definitionsStore.updateValueAtPath`. Multi-select diff
 *  badges are deferred per the plan — for v1 we just edit the first
 *  selected actor. */
export function DetailsPanel() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const selectedIndices = useLayoutEditorStore((s) => s.selectedIndices);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const refAdapter = useRefAdapter();

  if (!layoutKey || selectedIndices.length === 0) {
    return <div className="details-empty">Select an actor to edit its properties.</div>;
  }

  const layoutRec = definitions.get(layoutKey);
  const objects = (layoutRec?.json?.properties?.layout_objects?.value as LayoutObject[] | undefined) ?? [];

  const idx = selectedIndices[0];
  const lo = objects[idx];
  if (!lo) return <div className="details-empty">(stale selection)</div>;

  return (
    <div className="details-panel">
      <TypedPropertiesEditor
        properties={lo.value as unknown as Record<string, any>}
        onChange={(next) => {
          updateValueAtPath(
            layoutKey,
            ['properties', 'layout_objects', 'value', idx, 'value'],
            next,
          );
        }}
        refAdapter={refAdapter}
        showAllFields={true}
        parentTypeName="LayoutObject"
      />
    </div>
  );
}
