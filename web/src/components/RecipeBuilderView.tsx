import { useMemo, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { humanizeAssetId } from './definitionsNaming';
import { SearchableSelect, type SelectOption } from './SearchableSelect';

// Recipe-builder view backed by the Definitions data. Operates on the
// loaded UCraftRecipeDefinition / UPlantRecipeDefinition / UFurnitureUpgradeRecipe
// records. Each recipe is rendered as a card with two columns:
//   - Inputs  — typed `map` envelope (key: ItemDefinition ref, value: int qty)
//   - Outputs — same shape
//
// Items are dragged in (or picked from a SearchableSelect) on each
// ingredient row. Quantities are inline integer inputs. Adding /
// removing rows mutates the underlying typed-envelope map. Saves go
// through the regular save path (so file relocation, dirty tracking
// and the ZIP export all keep working).

const RECIPE_FOLDERS = new Set([
  'craft_recipe_definitions',
  'plant_recipe_definitions',
  'furniture_upgrade_recipe',
  'available_recipe_rules_definitions',
]);

export function isRecipeFolder(folder: string | null | undefined): boolean {
  return !!folder && RECIPE_FOLDERS.has(folder);
}

export function RecipeBuilderView({
  folder,
}: {
  folder: string;
}) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const dirty = useDefinitionsStore((s) => s.dirty);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const replaceJson = useDefinitionsStore((s) => s.replaceJson);
  const saveOne = useDefinitionsStore((s) => s.saveOne);
  const deleteDefinition = useDefinitionsStore((s) => s.deleteDefinition);
  const assetsOfClass = useDefinitionsStore((s) => s.assetsOfClass);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const selectedKey = useDefinitionsStore((s) => s.selectedKey);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);

  const recipes = useMemo(() => {
    return [...definitions.values()]
      .filter((r) => r.folder === folder)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [definitions, folder]);

  const itemOptions = useMemo<SelectOption[]>(() => {
    const ids = assetsOfClass('ItemDefinition');
    return ids.map((id) => ({
      value: id,
      label: humanizeAssetId(id),
      hint: id,
    }));
  }, [assetsOfClass, definitions]);

  const [filter, setFilter] = useState('');
  const visibleRecipes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => r.id.toLowerCase().includes(q));
  }, [recipes, filter]);

  if (recipes.length === 0) {
    return (
      <div className="def-empty-state">
        <h3>No recipes in this folder</h3>
        <p>Open the Form view and create one, or import from your Definitions export.</p>
      </div>
    );
  }

  return (
    <div className="rb-root">
      <div className="rb-toolbar">
        <strong>{visibleRecipes.length} of {recipes.length} recipe{recipes.length === 1 ? '' : 's'}</strong>
        <input
          type="text"
          className="def-prop-search"
          placeholder="Filter recipes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="rb-cards">
        {visibleRecipes.map((rec) => (
          <RecipeCard
            key={rec.folder + '/' + rec.id}
            recordKey={`${rec.folder}/${rec.id}`}
            json={rec.json}
            isDirty={dirty.has(`${rec.folder}/${rec.id}`)}
            isSelected={selectedKey === `${rec.folder}/${rec.id}`}
            itemOptions={itemOptions}
            onSelect={() => {
              selectFolder(rec.folder);
              selectDefinition(`${rec.folder}/${rec.id}`);
            }}
            onChange={(path, v) => updateValueAtPath(`${rec.folder}/${rec.id}`, path, v)}
            onReplace={(json) => replaceJson(`${rec.folder}/${rec.id}`, json)}
            onSave={() => saveOne(`${rec.folder}/${rec.id}`)}
            onDelete={async () => {
              if (!window.confirm(`Delete ${rec.id}.json?`)) return;
              await deleteDefinition(`${rec.folder}/${rec.id}`);
            }}
            findKeyById={findKeyById}
          />
        ))}
      </div>
    </div>
  );
}

function RecipeCard({
  recordKey: _recordKey,  // eslint-disable-line @typescript-eslint/no-unused-vars
  json,
  isDirty,
  isSelected,
  itemOptions,
  onSelect,
  onChange,
  onReplace,
  onSave,
  onDelete,
  findKeyById,
}: {
  recordKey: string;
  json: any;
  isDirty: boolean;
  isSelected: boolean;
  itemOptions: SelectOption[];
  onSelect: () => void;
  onChange: (path: (string | number)[], v: any) => void;
  onReplace: (json: any) => void;
  onSave: () => void;
  onDelete: () => void;
  findKeyById: (id: string) => string | null;
}) {
  const props = json?.properties ?? {};
  const inputEnv = props.input;
  const outputEnv = props.output;

  return (
    <div className={`rb-card ${isSelected ? 'selected' : ''} ${isDirty ? 'dirty' : ''}`} onClick={onSelect}>
      <div className="rb-card-head">
        <h4 title={json.id}>{humanizeAssetId(json.id ?? '')}</h4>
        <div className="rb-card-actions">
          {isDirty && <button type="button" className="primary" onClick={(e) => { e.stopPropagation(); onSave(); }}>Save</button>}
          <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</button>
        </div>
      </div>
      <div className="rb-card-body">
        <RecipeMapColumn
          label="Inputs"
          envelope={inputEnv}
          itemOptions={itemOptions}
          onChange={(next) => onChange(['properties', 'input'], next)}
          onSeed={() => seedRecipeMap(json, 'input', onReplace)}
          findKeyById={findKeyById}
        />
        <div className="rb-arrow">→</div>
        <RecipeMapColumn
          label="Outputs"
          envelope={outputEnv}
          itemOptions={itemOptions}
          onChange={(next) => onChange(['properties', 'output'], next)}
          onSeed={() => seedRecipeMap(json, 'output', onReplace)}
          findKeyById={findKeyById}
        />
      </div>
    </div>
  );
}

function seedRecipeMap(
  json: any,
  field: 'input' | 'output',
  onReplace: (json: any) => void,
) {
  const seed = {
    type: 'map',
    key_type: { type: 'definition_ref', class: 'ItemDefinition', value: '' },
    value_type: { type: 'int', value: 0 },
    value: [],
  };
  onReplace({
    ...json,
    properties: { ...(json.properties ?? {}), [field]: seed },
  });
}

function RecipeMapColumn({
  label,
  envelope,
  itemOptions,
  onChange,
  onSeed,
  findKeyById,
}: {
  label: string;
  envelope: any;
  itemOptions: SelectOption[];
  onChange: (next: any) => void;
  onSeed: () => void;
  findKeyById: (id: string) => string | null;
}) {
  if (!envelope || envelope.type !== 'map') {
    return (
      <div className="rb-col">
        <div className="rb-col-head">{label}</div>
        <button type="button" className="rb-seed" onClick={(e) => { e.stopPropagation(); onSeed(); }}>
          + Add {label.toLowerCase()}
        </button>
      </div>
    );
  }
  const entries: Array<{ key: any; value: any }> = Array.isArray(envelope.value) ? envelope.value : [];
  return (
    <div className="rb-col">
      <div className="rb-col-head">{label}</div>
      <div className="rb-rows">
        {entries.length === 0 && <div className="rb-empty">(none)</div>}
        {entries.map((entry, i) => {
          const itemId = String(entry.key?.value ?? '');
          const qty = Number(entry.value?.value ?? 0);
          const resolves = !!itemId && findKeyById(itemId) != null;
          return (
            <div className={`rb-row ${resolves || !itemId ? '' : 'orphan'}`} key={i}>
              <SearchableSelect
                value={itemId}
                options={itemOptions}
                placeholder="Pick item…"
                triggerClassName="rb-row-item"
                onChange={(v) => {
                  const next = entries.slice();
                  next[i] = {
                    ...next[i],
                    key: { ...(next[i].key ?? { type: 'definition_ref', class: 'ItemDefinition' }), value: v },
                  };
                  onChange({ ...envelope, value: next });
                }}
              />
              <input
                type="number"
                className="rb-row-qty"
                min={0}
                step={1}
                value={Number.isFinite(qty) ? qty : 0}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const next = entries.slice();
                  const n = parseInt(e.target.value, 10);
                  next[i] = {
                    ...next[i],
                    value: { ...(next[i].value ?? { type: 'int' }), value: Number.isFinite(n) ? n : 0 },
                  };
                  onChange({ ...envelope, value: next });
                }}
              />
              <button
                type="button"
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...envelope, value: entries.filter((_, idx) => idx !== i) });
                }}
              >×</button>
            </div>
          );
        })}
        <button
          type="button"
          className="rb-add-row"
          onClick={(e) => {
            e.stopPropagation();
            onChange({
              ...envelope,
              value: [
                ...entries,
                {
                  key: { type: 'definition_ref', class: 'ItemDefinition', value: '' },
                  value: { type: 'int', value: 1 },
                },
              ],
            });
          }}
        >+ Add row</button>
      </div>
    </div>
  );
}
