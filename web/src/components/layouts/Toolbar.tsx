import { useLayoutEditorStore } from '../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../store/definitionsStore';

export function Toolbar() {
  const selectedLayoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const setLayout = useLayoutEditorStore((s) => s.setLayout);
  const seed = useLayoutEditorStore((s) => s.seed);
  const setSeed = useLayoutEditorStore((s) => s.setSeed);
  const rerollSeed = useLayoutEditorStore((s) => s.rerollSeed);
  const definitions = useDefinitionsStore((s) => s.definitions);

  const layouts = [...definitions.values()]
    .filter((d) => d.json?.class === 'ULayoutDefinition' || d.json?.class === 'LayoutDefinition')
    .map((d) => d.id)
    .sort();

  return (
    <div className="layouts-toolbar">
      <select
        value={selectedLayoutKey ?? ''}
        onChange={(e) => setLayout(e.target.value || null)}
      >
        <option value="">— pick a layout —</option>
        {layouts.map((id) => <option key={id} value={id}>{id}</option>)}
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
    </div>
  );
}
