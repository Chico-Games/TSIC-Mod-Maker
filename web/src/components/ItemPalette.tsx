import { useEffect, useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { VirtualList } from './VirtualList';
import { HighlightedText } from './HighlightedText';
import { fuzzyRankMulti, type RankedHit } from '../search/fuzzy';
import { useJumpToDefinition } from './useJumpToDefinition';

const RECIPE_FOLDERS = new Set([
  'craft_recipe_definitions',
  'plant_recipe_definitions',
  'furniture_upgrade_recipe',
]);

/** Tags the exporter typically appends to a class's asset ids. We use
 *  it to suggest a sensible default suffix when minting a new asset
 *  in a folder we don't have an idTemplate for yet. */
const FOLDER_ID_SUFFIX: Record<string, string> = {
  consumable_definitions: '_CN',
  crafting_material_definitions: '_CM',
  constructable_item_definitions: '_CI',
  ammo_definitions: '_AM',
  seed_item_definitions: '_SD',
  static_item_definitions: '_SI',
  equippable_definitions: '_EQ',
  glove_definitions: '_GL',
  trap_item_definitions: '_TR',
};
function inferIdSuffix(folder: string): string { return FOLDER_ID_SUFFIX[folder] ?? ''; }

/** Reverse the folder-naming convention used by the typed editor. */
function folderToClassName(folder: string): string {
  // Drop trailing "_definitions" / "_definition", camelCase the rest.
  const trimmed = folder.replace(/_definitions?$/, '');
  const camel = trimmed.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return `${camel}Definition`;
}

const DEFAULT_ITEM_FOLDERS = [
  'consumable_definitions',
  'crafting_material_definitions',
  'constructable_item_definitions',
  'ammo_definitions',
  'seed_item_definitions',
  'static_item_definitions',
  'equippable_definitions',
  'glove_definitions',
  'trap_item_definitions',
];

interface Props {
  /** Folders to show in the palette by default. */
  folders?: string[];
  /** Title above the palette. */
  title?: string;
}

export function ItemPalette({ folders, title }: Props) {
  const allFolders = useDefinitionsStore((s) => s.folders);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);

  const selectedRecipeKey = useAppStore((s) => s.selectedRecipeKey);
  const selectedStationKey = useAppStore((s) => s.selectedStationKey);
  const selectRecipe = useAppStore((s) => s.selectRecipe);
  const jumpToDef = useJumpToDefinition();

  const [filter, setFilter] = useState('');
  // Folder pick: starts from the requested defaults and re-seeds when
  // the loaded folder set arrives (the store is asynchronous, so the
  // first render usually has an empty allFolders).
  const initialFolders = useMemo(() => {
    const seed = (folders ?? DEFAULT_ITEM_FOLDERS).filter((f) => allFolders.includes(f));
    return new Set(seed.length ? seed : allFolders);
  }, [folders, allFolders]);
  const [enabled, setEnabled] = useState<Set<string>>(initialFolders);
  const [seeded, setSeeded] = useState(initialFolders.size > 0);
  useEffect(() => {
    if (!seeded && initialFolders.size > 0) {
      setEnabled(initialFolders);
      setSeeded(true);
    }
  }, [seeded, initialFolders]);

  type ItemRow = { id: string; folder: string; class: string; humanLabel: string };
  const inFolder = useMemo<ItemRow[]>(() => {
    const out: ItemRow[] = [];
    for (const rec of definitions.values()) {
      if (!enabled.has(rec.folder)) continue;
      out.push({
        id: rec.id,
        folder: rec.folder,
        class: String(rec.json?.class ?? '').replace(/^U/, ''),
        humanLabel: humanizeAssetId(rec.id),
      });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [definitions, enabled]);

  const items = useMemo<RankedHit<ItemRow>[]>(() => {
    return fuzzyRankMulti(inFolder, filter, (it) => [it.humanLabel, it.id]);
  }, [inFolder, filter]);

  /** Total usage of every item across every recipe in the dataset.
   *  Walks input + output maps once per render-of-changed-data and
   *  caches the result. ~2k recipes × ~3 entries = trivially cheap. */
  const totalUsage = useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string, n: number) => {
      if (!id) return;
      m.set(id, (m.get(id) ?? 0) + n);
    };
    for (const rec of definitions.values()) {
      if (!RECIPE_FOLDERS.has(rec.folder)) continue;
      const props = rec.json?.properties ?? {};
      for (const slot of ['input', 'output'] as const) {
        const env: any = props[slot];
        if (env?.type !== 'map' || !Array.isArray(env.value)) continue;
        for (const entry of env.value) {
          const k = entry?.key;
          const id = k && typeof k === 'object' ? String(k.value ?? '') : '';
          const qty = entry?.value && typeof entry.value === 'object' ? Number(entry.value.value ?? 1) : 1;
          add(id, qty || 1);
        }
      }
      // Furniture upgrade: upgraded_furniture_definition is also a "use".
      const upRef: any = props.upgraded_furniture_definition;
      if (upRef?.type === 'definition_ref' && typeof upRef.value === 'string') {
        add(String(upRef.value), 1);
      }
    }
    return m;
  }, [definitions]);

  /** Item usage in the currently-selected recipe's input + output. */
  const recipeUsage = useMemo(() => {
    const m = new Map<string, number>();
    if (!selectedRecipeKey) return m;
    const rec = definitions.get(selectedRecipeKey);
    if (!rec) return m;
    const props = rec.json?.properties ?? {};
    for (const slot of ['input', 'output'] as const) {
      const env: any = props[slot];
      if (env?.type !== 'map' || !Array.isArray(env.value)) continue;
      for (const entry of env.value) {
        const k = entry?.key;
        const id = k && typeof k === 'object' ? String(k.value ?? '') : '';
        const qty = entry?.value && typeof entry.value === 'object' ? Number(entry.value.value ?? 1) : 1;
        if (!id) continue;
        m.set(id, (m.get(id) ?? 0) + (qty || 1));
      }
    }
    return m;
  }, [definitions, selectedRecipeKey]);

  /** Click-to-author: with a recipe selected, add (or +1) the item to
   *  that recipe's `input` map. With only a station selected, create a
   *  new recipe whose `output` is the clicked item and append it to
   *  the station's ARR. */
  const onClickItem = (id: string, cls: string) => {
    if (selectedRecipeKey) {
      stackInputItem(selectedRecipeKey, id, cls, +1);
      return;
    }
    if (selectedStationKey) {
      const station = definitions.get(selectedStationKey);
      const arrId = station?.json?.properties?.available_recipe_rules_definition?.value;
      if (typeof arrId !== 'string' || !arrId) return;
      const arrKey = findKeyById(arrId);
      if (!arrKey) return;
      const arr = definitions.get(arrKey);
      // Decide recipe class by station group.
      const isPlantable =
        Array.isArray(station?.json?.parent_classes) &&
        station!.json.parent_classes.includes('UPlantableDefinition');
      const recipeCls = isPlantable ? 'PlantRecipeDefinition' : 'CraftRecipeDefinition';
      const tag = isPlantable ? 'PL' : 'CR';
      let stem = `From${humanizeAssetId(id).replace(/\s+/g, '')}`;
      let n = 1;
      while (findKeyById(`RD_${stem}_${tag}`)) stem = `${stem}${++n}`;
      const newId = `RD_${stem}_${tag}`;
      const newKey = createDefinitionForClass(recipeCls, newId);
      if (!newKey) return;
      // Set output map to a single entry pointing at this item.
      updateValueAtPath(newKey, ['properties', 'output'], {
        type: 'map',
        key_type: { type: 'definition_ref', class: cls },
        value_type: { type: 'int' },
        value: [{
          key: { type: 'definition_ref', class: cls, value: id },
          value: { type: 'int', value: 1 },
        }],
      });
      // Append the recipe ref to the ARR.
      const path = ['properties', 'production_machine_rules', 'value', 'recipes'];
      const cur: any = arr?.json?.properties?.production_machine_rules?.value?.recipes;
      let nextArr: any;
      if (cur?.type === 'array') {
        const list = Array.isArray(cur.value) ? cur.value.slice() : [];
        list.push({ type: 'definition_ref', class: recipeCls, value: newId });
        nextArr = { ...cur, value: list };
      } else {
        nextArr = {
          type: 'array',
          element_type: { type: 'definition_ref', class: recipeCls },
          value: [{ type: 'definition_ref', class: recipeCls, value: newId }],
        };
      }
      updateValueAtPath(arrKey, path, nextArr);
      // Make the new recipe selected so the next palette click goes
      // into its inputs.
      selectRecipe(newKey);
    }
  };

  /** Right-click decrements (or removes) the item from the selected
   *  recipe's input map. No-op without a recipe selected. */
  const onRightClickItem = (id: string) => {
    if (!selectedRecipeKey) return;
    stackInputItem(selectedRecipeKey, id, '', -1);
  };

  /** Mutate `recipeKey`'s input map: increment qty of `id` if present,
   *  else add a new row with qty=1 (delta>0); decrement qty / remove
   *  row when delta<0. Falls back to defaultClass when the entry has
   *  no class and we're inserting fresh. */
  const stackInputItem = (recipeKey: string, id: string, defaultClass: string, delta: number) => {
    const rec = definitions.get(recipeKey);
    if (!rec) return;
    const env: any = rec.json?.properties?.input;
    const list = env?.type === 'map' && Array.isArray(env.value) ? env.value.slice() : [];
    const idx = list.findIndex((e: any) => {
      const k = e?.key;
      return k && typeof k === 'object' && String(k.value ?? '') === id;
    });
    if (delta > 0) {
      if (idx === -1) {
        const cls = defaultClass || env?.key_type?.class || 'CraftingMaterialDefinition';
        list.push({
          key: { type: 'definition_ref', class: cls, value: id },
          value: { type: 'int', value: 1 },
        });
      } else {
        const cur = list[idx];
        const qty = Number(cur?.value?.value ?? 1) + delta;
        list[idx] = { ...cur, value: { ...cur.value, value: qty } };
      }
    } else {
      if (idx === -1) return;
      const cur = list[idx];
      const qty = Number(cur?.value?.value ?? 1) + delta;
      if (qty <= 0) list.splice(idx, 1);
      else list[idx] = { ...cur, value: { ...cur.value, value: qty } };
    }
    const next = env?.type === 'map'
      ? { ...env, value: list }
      : { type: 'map', key_type: { type: 'definition_ref', class: defaultClass || 'CraftingMaterialDefinition' }, value_type: { type: 'int' }, value: list };
    updateValueAtPath(recipeKey, ['properties', 'input'], next);
  };

  const toggleFolder = (f: string) => {
    setEnabled((cur) => {
      const next = new Set(cur);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  return (
    <div className="item-palette">
      <div className="palette-header">
        <h3>{title ?? 'Items'}</h3>
        <input
          type="text"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="palette-folders">
        {(folders ?? DEFAULT_ITEM_FOLDERS).filter((f) => allFolders.includes(f)).map((f) => {
          const t = getFolderTheme(f);
          const on = enabled.has(f);
          return (
            <button
              key={f}
              className={`folder-chip ${on ? 'on' : ''}`}
              onClick={() => toggleFolder(f)}
              title={f}
              style={on ? { borderColor: t.color, color: t.color } : undefined}
            >
              <span aria-hidden>{t.emoji}</span>
              {f.replace(/_definitions?$/, '')}
            </button>
          );
        })}
      </div>
      <div className="palette-folders palette-add-row">
        <span className="palette-add-label">＋ Add</span>
        {(folders ?? DEFAULT_ITEM_FOLDERS).filter((f) => allFolders.includes(f)).map((f) => {
          const t = getFolderTheme(f);
          // Derive the bare class name from the folder. e.g.
          // "consumable_definitions" → "ConsumableDefinition".
          const cls = folderToClassName(f);
          return (
            <button
              key={f}
              className="folder-chip"
              title={`Mint a new ${cls}`}
              style={{ color: t.color, borderColor: t.color }}
              onClick={() => {
                let n = 1;
                const tag = inferIdSuffix(f);
                let id = `ID_New${n}${tag}`;
                while (findKeyById(id)) {
                  n++;
                  id = `ID_New${n}${tag}`;
                }
                createDefinitionForClass(cls, id);
              }}
            >
              <span aria-hidden>{t.emoji}</span>
              {f.replace(/_definitions?$/, '')}
            </button>
          );
        })}
      </div>
      <div className="palette-list">
        <VirtualList
          items={items}
          rowHeight={32}
          keyOf={(h) => `${h.item.folder}/${h.item.id}`}
          renderItem={(h) => (
            <PaletteItem
              id={h.item.id}
              folder={h.item.folder}
              cls={h.item.class}
              ranges={h.ranges}
              recipeUse={recipeUsage.get(h.item.id) ?? 0}
              totalUse={totalUsage.get(h.item.id) ?? 0}
              onClick={onClickItem}
              onRightClick={onRightClickItem}
              onMiddleClick={(id) => jumpToDef(id)}
            />
          )}
        />
      </div>
      <div className="palette-count">
        {items.length.toLocaleString()} items
        {selectedRecipeKey
          ? <span className="palette-hint"> · click adds to recipe input · right-click −1</span>
          : selectedStationKey
            ? <span className="palette-hint"> · click creates a new recipe with that output</span>
            : <span className="palette-hint"> · pick a station to author</span>}
      </div>
    </div>
  );
}

interface PaletteItemProps {
  id: string;
  folder: string;
  cls: string;
  ranges: ReadonlyArray<readonly [number, number]>;
  recipeUse: number;
  totalUse: number;
  onClick: (id: string, cls: string) => void;
  onRightClick: (id: string) => void;
  onMiddleClick: (id: string) => void;
}

function PaletteItem({ id, folder, cls, ranges, recipeUse, totalUse, onClick, onRightClick, onMiddleClick }: PaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${folder}/${id}`,
    data: { type: 'palette-item', class: cls, value: id } as any,
  });
  const t = getFolderTheme(folder);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`palette-item ${isDragging ? 'dragging' : ''} ${recipeUse > 0 ? 'in-recipe' : ''}`}
      style={{ borderLeft: `3px solid ${t.color}` }}
      title={`${id} · ${cls}\nIn this recipe: ${recipeUse}\nAcross all recipes: ${totalUse}\nMiddle-click to open in Definitions`}
      onClick={() => onClick(id, cls)}
      onContextMenu={(e) => { e.preventDefault(); onRightClick(id); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onMiddleClick(id); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); /* suppress autoscroll */ }}
    >
      <span className="emoji" aria-hidden>{t.emoji}</span>
      <span className="label"><HighlightedText text={humanizeAssetId(id)} ranges={ranges} /></span>
      <span className="palette-counts">
        {recipeUse > 0 && <span className="palette-here" title={`${recipeUse} in selected recipe`}>{recipeUse}</span>}
        {totalUse > 0 && <span className="palette-total" title={`${totalUse} across all recipes`}>{totalUse}</span>}
      </span>
    </div>
  );
}
