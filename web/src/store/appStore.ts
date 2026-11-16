import { create } from 'zustand';

export type AppTab = 'recipes-loot' | 'items' | 'furniture' | 'systems' | 'definitions' | 'layouts' | 'ai' | 'validations';
/** The three tabs that are a rail of definition folders over a class browser. */
export type RailHome = 'items' | 'furniture' | 'systems';
export type AiSubTab = 'sandbox' | 'scenarios' | 'behavior' | 'perception' | 'attacks';
export type RecipesSubTab = 'stations' | 'furniture' | 'loot' | 'tech-tree' | 'enemies' | 'biome';

export type ItemsSubTab =
  | 'crafting-materials' | 'consumables' | 'constructables' | 'equippables'
  | 'gloves' | 'ammo' | 'seeds' | 'traps' | 'static-items';

export type FurnitureSubTab =
  | 'furniture' | 'damageable' | 'toggleable' | 'with-components'
  | 'storage' | 'universal-storage'
  | 'crafting-stations' | 'production-stations' | 'plantable'
  | 'elevator' | 'teleporter' | 'death-box' | 'containment-cage' | 'shopping-cart'
  | 'spawn-points' | 'enemy-spawn-points' | 'interactable-text' | 'html-game';

export const ITEMS_SUBTAB_FOLDER: Record<ItemsSubTab, string> = {
  'crafting-materials': 'crafting_material_definitions',
  'consumables': 'consumable_definitions',
  'constructables': 'constructable_item_definitions',
  'equippables': 'equippable_definitions',
  'gloves': 'glove_definitions',
  'ammo': 'ammo_definitions',
  'seeds': 'seed_item_definitions',
  'traps': 'trap_item_definitions',
  'static-items': 'static_item_definitions',
};

export const FURNITURE_SUBTAB_FOLDER: Record<FurnitureSubTab, string> = {
  'furniture': 'furniture_definitions',
  'damageable': 'damageable_furniture_definitions',
  'toggleable': 'toggleable_furniture_definitions',
  'with-components': 'furniture_with_components_definitions',
  'storage': 'storage_definitions',
  'universal-storage': 'universal_storage_definitions',
  'crafting-stations': 'crafting_station_definitions',
  'production-stations': 'production_station_definitions',
  'plantable': 'plantable_definitions',
  'elevator': 'elevator_definitions',
  'teleporter': 'teleporter_definitions',
  'death-box': 'death_box_definitions',
  'containment-cage': 'containment_cage_definitions',
  'shopping-cart': 'shopping_cart_definitions',
  'spawn-points': 'spawn_point_definitions',
  'enemy-spawn-points': 'enemy_spawn_point_definitions',
  'interactable-text': 'interactable_text_definitions',
  'html-game': 'html_game_definitions',
};

/** Path-anchored selection (an array or a slot inside a definition's
 *  `properties` tree). Used by the universal copy / paste keybindings. */
export interface PathSelection {
  ownerKey: string;
  path: (string | number)[];
}

/** What the user has copied. Lives on the appStore so it survives
 *  tab switches and re-renders. */
export type Clipboard =
  | null
  | { kind: 'array'; envelope: any /* the entire {type:'array', element_type, value} envelope */ }
  | { kind: 'map'; envelope: any /* the entire {type:'map', key_type, value_type, value} envelope */ }
  | { kind: 'slot'; envelope: any /* a single typed envelope, usually a definition_ref */ }
  | { kind: 'recipe'; sourceKey: string };

interface AppStore {
  tab: AppTab;
  recipesSubTab: RecipesSubTab;
  itemsSubTab: ItemsSubTab;
  furnitureSubTab: FurnitureSubTab;
  aiSubTab: AiSubTab;
  /** A loot table another view asked the Loot sub-tab to open. The Loot tab
   *  consumes it (selects the table) and clears it. */
  lootFocus: { kind: 'drop' | 'world' | 'enemy'; id: string } | null;
  /** Folder shown in each rail tab. Folders are discovered from the loaded
   *  project, so this is a folder name rather than a fixed sub-tab id. */
  railFolder: Record<RailHome, string | null>;
  searchOpen: boolean;

  /** Station rail selection on the Stations sub-tab — also used by
   *  the ItemPalette to decide what a click does (with no recipe
   *  selected, click creates a new recipe with that item as output). */
  selectedStationKey: string | null;
  /** Recipe card selection on the Stations sub-tab. Click on palette
   *  item adds it as an input on this recipe (stacking qty). */
  selectedRecipeKey: string | null;
  /** Path-anchored selection of an array or slot. Drives Ctrl+C/V. */
  pathSelection: PathSelection | null;
  /** Clipboard payload from the last copy. */
  clipboard: Clipboard;

  setTab: (t: AppTab) => void;
  setRecipesSubTab: (t: RecipesSubTab) => void;
  setItemsSubTab: (t: ItemsSubTab) => void;
  setFurnitureSubTab: (t: FurnitureSubTab) => void;
  setAiSubTab: (t: AiSubTab) => void;
  setRailFolder: (home: RailHome, folder: string) => void;
  /** Jump to Recipes & Loot › Loot with this table selected. */
  openLoot: (kind: 'drop' | 'world' | 'enemy', id: string) => void;
  clearLootFocus: () => void;
  setSearchOpen: (open: boolean) => void;

  selectStation: (k: string | null) => void;
  selectRecipe: (k: string | null) => void;
  selectPath: (sel: PathSelection | null) => void;
  setClipboard: (c: Clipboard) => void;
}

const LS_TAB = 'tsic.app.tab.v1';
const LS_SUB = 'tsic.app.recipesSub.v1';
const LS_ITEMS_SUB = 'tsic.app.itemsSub.v1';
const LS_FURN_SUB = 'tsic.app.furnitureSub.v1';
const LS_AI_SUB = 'tsic.app.aiSub.v1';

function loadTab(): AppTab {
  try {
    const v = localStorage.getItem(LS_TAB);
    if (
      v === 'recipes-loot' ||
      v === 'items' ||
      v === 'furniture' ||
      v === 'systems' ||
      v === 'definitions' ||
      v === 'layouts' ||
      v === 'ai' ||
      v === 'validations'
    ) return v;
    // Legacy: a previous build had a 'furniture-loot' top-level tab.
    // Map it onto Recipes & Loot so old localStorage doesn't strand
    // users on a blank tab.
    if (v === 'furniture-loot') return 'recipes-loot';
  } catch { /* noop */ }
  return 'recipes-loot';
}
function loadSub(): RecipesSubTab {
  try {
    const v = localStorage.getItem(LS_SUB);
    if (v === 'stations' || v === 'furniture' || v === 'loot' || v === 'tech-tree' || v === 'enemies' || v === 'biome') return v;
  } catch { /* noop */ }
  return 'stations';
}
function loadItemsSub(): ItemsSubTab {
  try {
    const v = localStorage.getItem(LS_ITEMS_SUB);
    if (v && v in ITEMS_SUBTAB_FOLDER) return v as ItemsSubTab;
  } catch { /* noop */ }
  return 'crafting-materials';
}
function loadAiSub(): AiSubTab {
  try {
    const v = localStorage.getItem(LS_AI_SUB);
    if (v === 'sandbox' || v === 'behavior' || v === 'perception' || v === 'attacks') return v;
  } catch { /* noop */ }
  return 'sandbox';
}
function loadFurnSub(): FurnitureSubTab {
  try {
    const v = localStorage.getItem(LS_FURN_SUB);
    if (v && v in FURNITURE_SUBTAB_FOLDER) return v as FurnitureSubTab;
  } catch { /* noop */ }
  return 'furniture';
}

const LS_RAIL = 'tsic.app.railFolder.v1';
function loadRailFolder(): Record<RailHome, string | null> {
  const out: Record<RailHome, string | null> = {
    items: ITEMS_SUBTAB_FOLDER[loadItemsSub()],
    furniture: FURNITURE_SUBTAB_FOLDER[loadFurnSub()],
    systems: null,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_RAIL) ?? 'null');
    if (raw && typeof raw === 'object') {
      for (const h of ['items', 'furniture', 'systems'] as RailHome[]) {
        if (typeof raw[h] === 'string' && raw[h]) out[h] = raw[h];
      }
    }
  } catch { /* noop */ }
  return out;
}
function saveRailFolder(v: Record<RailHome, string | null>) {
  try { localStorage.setItem(LS_RAIL, JSON.stringify(v)); } catch { /* noop */ }
}

export const useAppStore = create<AppStore>((set) => ({
  railFolder: loadRailFolder(),
  lootFocus: null,
  openLoot: (kind, id) => {
    try { localStorage.setItem(LS_TAB, 'recipes-loot'); localStorage.setItem(LS_SUB, 'loot'); } catch { /* noop */ }
    set({ tab: 'recipes-loot', recipesSubTab: 'loot', lootFocus: { kind, id } });
  },
  clearLootFocus: () => set({ lootFocus: null }),
  setRailFolder: (home, folder) => set((s) => {
    const railFolder = { ...s.railFolder, [home]: folder };
    saveRailFolder(railFolder);
    return { railFolder };
  }),
  tab: loadTab(),
  recipesSubTab: loadSub(),
  itemsSubTab: loadItemsSub(),
  furnitureSubTab: loadFurnSub(),
  aiSubTab: loadAiSub(),
  searchOpen: false,
  selectedStationKey: null,
  selectedRecipeKey: null,
  pathSelection: null,
  clipboard: null,
  setTab: (t) => {
    try { localStorage.setItem(LS_TAB, t); } catch { /* noop */ }
    set({ tab: t });
  },
  setRecipesSubTab: (t) => {
    try { localStorage.setItem(LS_SUB, t); } catch { /* noop */ }
    set({ recipesSubTab: t });
  },
  setItemsSubTab: (t) => {
    try { localStorage.setItem(LS_ITEMS_SUB, t); } catch { /* noop */ }
    set((s) => {
      const railFolder = { ...s.railFolder, items: ITEMS_SUBTAB_FOLDER[t] };
      saveRailFolder(railFolder);
      return { itemsSubTab: t, railFolder };
    });
  },
  setFurnitureSubTab: (t) => {
    try { localStorage.setItem(LS_FURN_SUB, t); } catch { /* noop */ }
    set((s) => {
      const railFolder = { ...s.railFolder, furniture: FURNITURE_SUBTAB_FOLDER[t] };
      saveRailFolder(railFolder);
      return { furnitureSubTab: t, railFolder };
    });
  },
  setAiSubTab: (t) => {
    try { localStorage.setItem(LS_AI_SUB, t); } catch { /* noop */ }
    set({ aiSubTab: t });
  },
  setSearchOpen: (open) => set({ searchOpen: open }),
  selectStation: (k) => set({
    selectedStationKey: k,
    // Clear recipe selection when the station changes — the previous
    // recipe key probably isn't part of the new station's ARR.
    selectedRecipeKey: null,
  }),
  selectRecipe: (k) => set({ selectedRecipeKey: k }),
  selectPath: (sel) => set({ pathSelection: sel }),
  setClipboard: (c) => set({ clipboard: c }),
}));
