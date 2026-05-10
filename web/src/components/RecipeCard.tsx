import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { humanizeAssetId } from './definitionsNaming';
import { DefRefSlot } from './DefRefSlot';
import { GrowStagesEditor } from './GrowStagesEditor';
import { NumberSlider } from './NumberSlider';

interface Props {
  recipeKey: string;
  /** Owning ARR — needed if we ever want to remove the recipe ref from
   *  the array on delete. */
  arrKey: string;
  /** Whether this card is the currently-selected recipe. Drives the
   *  visual outline + governs ItemPalette click-to-add behaviour. */
  selected?: boolean;
  /** Toggle selection on click. */
  onSelect?: () => void;
}

export function RecipeCard({ recipeKey, arrKey, selected, onSelect }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const deleteDefinition = useDefinitionsStore((s) => s.deleteDefinition);

  const rec = definitions.get(recipeKey);
  const cls = String(rec?.json?.class ?? '').replace(/^U/, '');

  const props = rec?.json?.properties ?? {};
  const inputMap: any = props.input;
  const outputMap: any = props.output;
  const duration: any = props.duration;
  const level: any = props.level;
  const upgradeTier: any = props.upgrade_tier;
  const upgraded: any = props.upgraded_furniture_definition;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `recipe-card:${recipeKey}`,
    data: { type: 'recipe-card', key: recipeKey, arrKey } as any,
  });

  const inputRows = useMemo(() => {
    if (!inputMap || inputMap.type !== 'map' || !Array.isArray(inputMap.value)) return [];
    return inputMap.value.map((entry: any, i: number) => ({ entry, i }));
  }, [inputMap]);
  const outputRows = useMemo(() => {
    if (!outputMap || outputMap.type !== 'map' || !Array.isArray(outputMap.value)) return [];
    return outputMap.value.map((entry: any, i: number) => ({ entry, i }));
  }, [outputMap]);

  if (!rec) return null;

  const inputKeyClass = inputMap?.key_type?.class ?? '';
  const outputKeyClass = outputMap?.key_type?.class ?? '';

  const ensureInputMap = () => {
    if (inputMap && inputMap.type === 'map') return inputMap;
    return { type: 'map', key_type: { type: 'definition_ref', class: 'CraftingMaterialDefinition' }, value_type: { type: 'int' }, value: [] };
  };
  const ensureOutputMap = () => {
    if (outputMap && outputMap.type === 'map') return outputMap;
    return { type: 'map', key_type: { type: 'definition_ref', class: 'ConsumableDefinition' }, value_type: { type: 'int' }, value: [] };
  };

  const addInputRow = () => {
    const cur = ensureInputMap();
    const list = Array.isArray(cur.value) ? cur.value.slice() : [];
    list.push({
      key: { type: 'definition_ref', class: cur.key_type?.class ?? 'CraftingMaterialDefinition', value: '' },
      value: { type: 'int', value: 1 },
    });
    updateValueAtPath(recipeKey, ['properties', 'input'], { ...cur, value: list });
  };
  const addOutputRow = () => {
    const cur = ensureOutputMap();
    const list = Array.isArray(cur.value) ? cur.value.slice() : [];
    list.push({
      key: { type: 'definition_ref', class: cur.key_type?.class ?? 'ConsumableDefinition', value: '' },
      value: { type: 'int', value: 1 },
    });
    updateValueAtPath(recipeKey, ['properties', 'output'], { ...cur, value: list });
  };
  const removeInputRow = (i: number) => {
    if (!inputMap || inputMap.type !== 'map') return;
    const list = (inputMap.value as any[]).filter((_, idx) => idx !== i);
    updateValueAtPath(recipeKey, ['properties', 'input'], { ...inputMap, value: list });
  };
  const removeOutputRow = (i: number) => {
    if (!outputMap || outputMap.type !== 'map') return;
    const list = (outputMap.value as any[]).filter((_, idx) => idx !== i);
    updateValueAtPath(recipeKey, ['properties', 'output'], { ...outputMap, value: list });
  };

  const setDuration = (v: number) => {
    if (duration && duration.type === 'float') updateValueAtPath(recipeKey, ['properties', 'duration'], { ...duration, value: v });
    else updateValueAtPath(recipeKey, ['properties', 'duration'], { type: 'float', value: v });
  };
  const setLevel = (v: number) => {
    if (level && level.type === 'int') updateValueAtPath(recipeKey, ['properties', 'level'], { ...level, value: v });
    else updateValueAtPath(recipeKey, ['properties', 'level'], { type: 'int', value: v });
  };
  const setUpgradeTier = (v: number) => {
    if (upgradeTier && upgradeTier.type === 'int') updateValueAtPath(recipeKey, ['properties', 'upgrade_tier'], { ...upgradeTier, value: v });
    else updateValueAtPath(recipeKey, ['properties', 'upgrade_tier'], { type: 'int', value: v });
  };

  const isPlant = cls === 'PlantRecipeDefinition';
  const isUpgrade = cls === 'FurnitureUpgradeRecipe';

  return (
    <div
      ref={setNodeRef}
      className={`recipe-card ${isDragging ? 'dragging' : ''} ${selected ? 'selected' : ''}`}
      onClick={(e) => {
        // Don't grab selection when the click happens on a real input,
        // button, slot, etc. — those have their own behaviour.
        const tag = (e.target as HTMLElement).closest('input,button,select,textarea,.def-ref-slot,.recipe-grab,[role=button]');
        if (tag) return;
        onSelect?.();
      }}
    >
      <header className="recipe-card-head">
        <span {...listeners} {...attributes} className="recipe-grab" title="drag to move">⋮⋮</span>
        <code className="recipe-id">{rec.id}</code>
        <span className="recipe-cls">{cls}</span>
        <div className="spacer" />
        <button
          className="danger"
          onClick={() => {
            if (!confirm(`Delete recipe ${rec.id}?\nThe ref in the ARR will dangle until you save.`)) return;
            void deleteDefinition(recipeKey);
          }}
          title="Delete this recipe"
        >×</button>
      </header>

      <div className="recipe-body">
        <div className="recipe-col input-col">
          <ArrayHeader label="Inputs" ownerKey={recipeKey} path={['properties', 'input']} />
          {inputRows.map(({ entry, i }: { entry: any; i: number }) => (
            <DefRefSlot
              key={i}
              ownerKey={recipeKey}
              path={['properties', 'input', 'value', i, 'key']}
              accept="recipe-input"
              defaultClass={inputKeyClass || (entry?.key?.class ?? '')}
              qtyPath={['properties', 'input', 'value', i, 'value']}
              onRemove={() => removeInputRow(i)}
            />
          ))}
          <button className="add-row" onClick={addInputRow}>＋ ingredient</button>
        </div>

        {!isUpgrade && (
          <>
            <div className="recipe-arrow">→</div>
            <div className="recipe-col output-col">
              <ArrayHeader label="Outputs" ownerKey={recipeKey} path={['properties', 'output']} />
              {outputRows.map(({ entry, i }: { entry: any; i: number }) => (
                <DefRefSlot
                  key={i}
                  ownerKey={recipeKey}
                  path={['properties', 'output', 'value', i, 'key']}
                  accept="recipe-output"
                  defaultClass={outputKeyClass || (entry?.key?.class ?? '')}
                  qtyPath={['properties', 'output', 'value', i, 'value']}
                  onRemove={() => removeOutputRow(i)}
                />
              ))}
              <button className="add-row" onClick={addOutputRow}>＋ output</button>
            </div>
          </>
        )}

        {isUpgrade && (
          <div className="recipe-col upgrade-col">
            <div className="col-label">Upgrade</div>
            <label className="recipe-meta-row">
              <span>Tier</span>
              <input
                type="number"
                min={1}
                value={Number(upgradeTier?.value ?? 1)}
                onChange={(e) => setUpgradeTier(Number(e.target.value || 1))}
              />
            </label>
            <div className="col-sub-label">Upgrades into</div>
            <DefRefSlot
              ownerKey={recipeKey}
              path={['properties', 'upgraded_furniture_definition']}
              accept="recipe-output"
              defaultClass={upgraded?.class ?? 'DamageableFurnitureDefinition'}
            />
          </div>
        )}
      </div>

      <div className="recipe-meta">
        <label className="recipe-meta-row">
          <span>Duration</span>
          <NumberSlider
            value={Number(duration?.value ?? 0)}
            onChange={setDuration}
            min={0}
            max={120}
          />
        </label>
        <label className="recipe-meta-row">
          <span>Level</span>
          <input
            type="number"
            min={1}
            value={Number(level?.value ?? 1)}
            onChange={(e) => setLevel(Number(e.target.value || 1))}
          />
        </label>
      </div>

      {isPlant && (
        <div className="grow-stages-section">
          <GrowStagesEditor recipeKey={recipeKey} />
        </div>
      )}
    </div>
  );
}

/** Clickable column / array label that sets pathSelection. Lets the
 *  user copy/paste the entire array (or map) the column represents. */
function ArrayHeader({ label, ownerKey, path }: { label: string; ownerKey: string; path: (string | number)[] }) {
  const pathSel = useAppStore((s) => s.pathSelection);
  const selectPath = useAppStore((s) => s.selectPath);
  const isSelected = !!pathSel && pathSel.ownerKey === ownerKey
    && pathSel.path.length === path.length
    && pathSel.path.every((p, i) => p === path[i]);
  return (
    <button
      className={`col-label col-label-button ${isSelected ? 'selected' : ''}`}
      onClick={(e) => { e.stopPropagation(); selectPath(isSelected ? null : { ownerKey, path }); }}
      title="Click to select this array (Ctrl+C / Ctrl+V)"
    >
      {label}
    </button>
  );
}
