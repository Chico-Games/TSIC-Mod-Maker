import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useLayoutResolverStore } from '../../../store/layoutResolverStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { useAssetCatalogStore } from '../../../store/assetCatalogStore';
import { LayoutObjectMesh } from './LayoutObjectMesh';
import { SelectionGizmo } from './SelectionGizmo';
import { UnrealCameraControls } from './UnrealCameraControls';

class ViewportErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Viewport] render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '1em', color: '#f88' }}>
          <strong>Viewport error:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Viewport() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const seed = useLayoutEditorStore((s) => s.seed);
  const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);
  const clearSelection = useLayoutEditorStore((s) => s.clearSelection);
  const resolveLayout = useLayoutResolverStore((s) => s.resolveLayout);
  const definitions = useDefinitionsStore((s) => s.definitions);
  // Subscribe to catalogs so the viewport re-renders (and re-resolves with
  // populated bounds) when the StaticMesh catalog finishes loading async.
  // Without this, the first render caches bounds=null for every actor and
  // every actor renders as the 100x100x100 fallback cube.
  useAssetCatalogStore((s) => s.catalogs);

  if (!layoutKey) {
    return <div className="viewport-empty">No layout selected.</div>;
  }

  const layoutRec = definitions.get(layoutKey);
  const tileTags = tileTagsOverride.length > 0
    ? tileTagsOverride
    : (layoutRec?.json?.properties?.gameplay_tags?.value as string[] | undefined) ?? [];
  const resolved = resolveLayout(layoutKey, seed, tileTags);

  return (
    <ViewportErrorBoundary>
      <Canvas
        camera={{ position: [1200, 1200, 1200], fov: 60, near: 10, far: 200000 }}
        onPointerMissed={() => clearSelection()}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[400, 600, 200]} intensity={0.6} />
        <Grid
          args={[40000, 40000]}
          cellSize={100}
          sectionSize={1000}
          cellColor="#333"
          sectionColor="#555"
          fadeDistance={30000}
          fadeStrength={1}
        />
        {/* Reorient Unreal (Z-up, left-handed) into three.js (Y-up).
            Unreal +Z → three.js +Y; actor positions/rotations stay raw in
            their local frame, so writes through SelectionGizmo round-trip
            without an extra coord conversion. */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {resolved.map((r, i) => <LayoutObjectMesh key={i} resolved={r} index={i} />)}
          <SelectionGizmo />
        </group>
        <UnrealCameraControls />
      </Canvas>
    </ViewportErrorBoundary>
  );
}
