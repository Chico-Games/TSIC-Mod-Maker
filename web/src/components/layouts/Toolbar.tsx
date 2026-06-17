import { useEffect, useMemo } from 'react';
import { useLayoutEditorStore } from '../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { useValidationStore } from '../../store/validationStore';
import { TagPicker } from '../pickers/TagPicker';
import { LayoutPicker } from './LayoutPicker';
import { tagStrings } from './resolver/searchTree';

function defaultLayoutObject(actorType: string) {
  return {
    type: 'struct',
    struct_name: 'LayoutObject',
    value: {
      layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: actorType },
      b_visual_helper: { type: 'bool', value: false },
      definition_filter: {
        type: 'struct', struct_name: 'DefinitionFilter',
        value: {
          seed_offset: { type: 'int', value: -1 },
          search_queries: { type: 'array', element_type: null, value: [] },
          tile_requirements: { type: 'array', element_type: null, value: [] },
          spawn_chance_over: { type: 'float', value: 0 },
          spawn_chance_under: { type: 'float', value: 1 },
        },
      },
      transform: {
        type: 'struct', struct_name: 'Transform',
        value: {
          translation: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 0 }, y: { type: 'float', value: 0 }, z: { type: 'float', value: 0 } } },
          rotation: { type: 'struct', struct_name: 'Rotator', value: { pitch: { type: 'float', value: 0 }, yaw: { type: 'float', value: 0 }, roll: { type: 'float', value: 0 } } },
          scale3_d: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 1 }, y: { type: 'float', value: 1 }, z: { type: 'float', value: 1 } } },
        },
      },
    },
  };
}

export function Toolbar() {
  const selectedLayoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const setLayout = useLayoutEditorStore((s) => s.setLayout);
  const seed = useLayoutEditorStore((s) => s.seed);
  const setSeed = useLayoutEditorStore((s) => s.setSeed);
  const rerollSeed = useLayoutEditorStore((s) => s.rerollSeed);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const dirty = useDefinitionsStore((s) => s.dirty);
  const saveOne = useDefinitionsStore((s) => s.saveOne);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const isDirty = selectedLayoutKey ? dirty.has(selectedLayoutKey) : false;

  const onAdd = (actorType: string) => {
    if (!selectedLayoutKey) return;
    const rec = definitions.get(selectedLayoutKey);
    const cur = (rec?.json?.properties?.layout_objects?.value as any[] | undefined) ?? [];
    const next = [...cur, defaultLayoutObject(actorType)];
    updateValueAtPath(selectedLayoutKey, ['properties', 'layout_objects', 'value'], next);
  };
  const gizmoMode = useLayoutEditorStore((s) => s.gizmoMode);
  const setGizmoMode = useLayoutEditorStore((s) => s.setGizmoMode);
  const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);
  const setTileTagsOverride = useLayoutEditorStore((s) => s.setTileTagsOverride);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
      else if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
      else if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setGizmoMode]);

  const issuesByKey = useValidationStore((s) => s.issuesByKey);
  const layouts = useMemo(() => {
    return [...definitions.values()]
      .filter((d) => d.json?.class === 'ULayoutDefinition' || d.json?.class === 'LayoutDefinition')
      .map((d) => ({
        key: `${d.folder}/${d.id}`,
        label: d.id,
        tags: tagStrings(d.json?.properties?.gameplay_tags),
        issueCount: issuesByKey.get(`${d.folder}/${d.id}`)?.length ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [definitions, issuesByKey]);

  return (
    <div className="layouts-toolbar">
      <LayoutPicker
        value={selectedLayoutKey ?? ''}
        options={layouts}
        onChange={(k) => setLayout(k || null)}
      />
      <button
        disabled={!isDirty || !selectedLayoutKey}
        onClick={() => selectedLayoutKey && saveOne(selectedLayoutKey)}
        className="layouts-save"
      >
        Save{isDirty ? ' ●' : ''}
      </button>
      <select
        className="layouts-add"
        onChange={(e) => {
          if (e.target.value) {
            onAdd(e.target.value);
            e.target.value = '';
          }
        }}
        value=""
      >
        <option value="">+ Add…</option>
        <option value="ProxyActor">Proxy</option>
        <option value="Layout">Layout</option>
        <option value="EnemySpawnPoint">EnemySpawn</option>
        <option value="LootSpawnPoint">LootSpawn</option>
        <option value="VisualHelper">VisualHelper</option>
      </select>
      <label className="layouts-toolbar-seed">
        Seed
        <input
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
        />
      </label>
      <button onClick={rerollSeed}>Reroll</button>
      <div className="gizmo-buttons">
        <button className={gizmoMode === 'translate' ? 'active' : ''} onClick={() => setGizmoMode('translate')}>Move (W)</button>
        <button className={gizmoMode === 'rotate' ? 'active' : ''} onClick={() => setGizmoMode('rotate')}>Rotate (E)</button>
        <button className={gizmoMode === 'scale' ? 'active' : ''} onClick={() => setGizmoMode('scale')}>Scale (R)</button>
      </div>
      <div
        className="tile-tag-override"
        title="Overrides the gameplay tags the resolver uses as the tile context for this preview. When empty, the layout's own `gameplay_tags` are used as the fallback (matching Unreal's ALayoutLevelScriptActor.TestGameplayTags). Restricted to Tile.* tags."
      >
        <span className="label">Tile tags override:</span>
        <TagPicker
          multi
          value={tileTagsOverride}
          categories="Tile"
          onChange={(v) => setTileTagsOverride(v as string[])}
        />
      </div>
    </div>
  );
}
