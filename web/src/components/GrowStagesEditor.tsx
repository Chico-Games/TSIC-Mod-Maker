import { useDefinitionsStore } from '../store/definitionsStore';

interface Props {
  recipeKey: string;
}

const STAGE_TEMPLATE = {
  type: 'struct',
  struct_name: 'PlantGrowStage',
  value: {
    ratio: { type: 'float', value: 1 },
    start_scale: {
      type: 'struct', struct_name: 'Vector', value: {
        x: { type: 'float', value: 1 },
        y: { type: 'float', value: 1 },
        z: { type: 'float', value: 1 },
      },
    },
    end_scale: {
      type: 'struct', struct_name: 'Vector', value: {
        x: { type: 'float', value: 1 },
        y: { type: 'float', value: 1 },
        z: { type: 'float', value: 1 },
      },
    },
  },
};

export function GrowStagesEditor({ recipeKey }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

  const rec = definitions.get(recipeKey);
  const stagesEnvelope: any = rec?.json?.properties?.grow_stages;
  const isArray = stagesEnvelope && stagesEnvelope.type === 'array';
  const stages: any[] = isArray && Array.isArray(stagesEnvelope.value) ? stagesEnvelope.value : [];

  const writeStages = (next: any[]) => {
    if (isArray) {
      updateValueAtPath(recipeKey, ['properties', 'grow_stages'], { ...stagesEnvelope, value: next });
    } else {
      updateValueAtPath(recipeKey, ['properties', 'grow_stages'], {
        type: 'array',
        element_type: STAGE_TEMPLATE,
        value: next,
      });
    }
  };

  const setField = (idx: number, path: (string | number)[], val: number) => {
    const stage = stages[idx];
    if (!stage) return;
    const fullPath = ['properties', 'grow_stages', 'value', idx, 'value', ...path];
    // Read current envelope at the path, patch its `value`.
    let cur: any = rec?.json;
    for (const seg of fullPath) cur = cur?.[seg as any];
    if (cur && typeof cur === 'object' && cur.type === 'float') {
      updateValueAtPath(recipeKey, fullPath, { ...cur, value: val });
    } else {
      updateValueAtPath(recipeKey, fullPath, { type: 'float', value: val });
    }
  };

  const readField = (stage: any, path: (string | number)[]): number => {
    let cur = stage?.value;
    for (const seg of path) cur = cur?.[seg as any];
    return Number(cur?.value ?? 0);
  };

  const addStage = () => {
    writeStages([...stages, JSON.parse(JSON.stringify(STAGE_TEMPLATE))]);
  };
  const removeStage = (i: number) => writeStages(stages.filter((_, idx) => idx !== i));

  return (
    <div className="grow-stages">
      <div className="col-label">Grow stages</div>
      {stages.length === 0 && <div className="muted">No stages.</div>}
      {stages.map((s, i) => (
        <div key={i} className="grow-stage-row">
          <div className="grow-stage-no">#{i + 1}</div>
          <label>
            ratio
            <input
              type="number"
              step={0.1}
              value={readField(s, ['ratio'])}
              onChange={(e) => setField(i, ['ratio'], Number(e.target.value || 0))}
            />
          </label>
          <label>
            start
            <input
              type="number"
              step={0.05}
              value={readField(s, ['start_scale', 'value', 'x'])}
              onChange={(e) => {
                const v = Number(e.target.value || 0);
                setField(i, ['start_scale', 'value', 'x'], v);
                setField(i, ['start_scale', 'value', 'y'], v);
                setField(i, ['start_scale', 'value', 'z'], v);
              }}
            />
          </label>
          <label>
            end
            <input
              type="number"
              step={0.05}
              value={readField(s, ['end_scale', 'value', 'x'])}
              onChange={(e) => {
                const v = Number(e.target.value || 0);
                setField(i, ['end_scale', 'value', 'x'], v);
                setField(i, ['end_scale', 'value', 'y'], v);
                setField(i, ['end_scale', 'value', 'z'], v);
              }}
            />
          </label>
          <button className="danger" onClick={() => removeStage(i)} title="Remove">×</button>
        </div>
      ))}
      <button className="add-row" onClick={addStage}>＋ stage</button>
    </div>
  );
}
