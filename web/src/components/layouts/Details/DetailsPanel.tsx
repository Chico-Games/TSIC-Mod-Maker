import { Component, type ReactNode, type ErrorInfo } from 'react';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { TypedPropertiesEditor } from '../../TypedValueEditor';
import { useRefAdapter } from '../../useRefAdapter';
import type { LayoutObject } from '../types';

class DetailsErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DetailsPanel] render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="details-empty" style={{ color: '#f88' }}>
          <strong>Details panel error:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px', marginTop: '0.5em' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: '0.5em' }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <DetailsErrorBoundary>
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
      </DetailsErrorBoundary>
    </div>
  );
}
