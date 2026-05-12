import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useLayoutResolverStore } from '../../../store/layoutResolverStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { LayoutObjectMesh } from './LayoutObjectMesh';

export function Viewport() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const seed = useLayoutEditorStore((s) => s.seed);
  const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);
  const resolveLayout = useLayoutResolverStore((s) => s.resolveLayout);
  const definitions = useDefinitionsStore((s) => s.definitions);

  if (!layoutKey) {
    return <div className="viewport-empty">No layout selected.</div>;
  }

  const layoutRec = definitions.get(layoutKey);
  const tileTags = tileTagsOverride.length > 0
    ? tileTagsOverride
    : (layoutRec?.json?.properties?.gameplay_tags?.value as string[] | undefined) ?? [];
  const resolved = resolveLayout(layoutKey, seed, tileTags);

  return (
    <Canvas camera={{ position: [800, 800, 800], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[400, 600, 200]} intensity={0.6} />
      <Grid args={[2000, 2000]} cellColor="#333" sectionColor="#555" infiniteGrid />
      {resolved.map((r, i) => <LayoutObjectMesh key={i} resolved={r} index={i} />)}
      <OrbitControls makeDefault />
    </Canvas>
  );
}
