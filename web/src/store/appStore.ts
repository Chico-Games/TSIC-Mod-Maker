import { create } from 'zustand';

export type AppTab = 'recipes-loot' | 'furniture-loot' | 'definitions' | 'validations';
export type RecipesSubTab = 'stations' | 'furniture' | 'tech-tree' | 'enemies' | 'biome';

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
  setSearchOpen: (open: boolean) => void;

  selectStation: (k: string | null) => void;
  selectRecipe: (k: string | null) => void;
  selectPath: (sel: PathSelection | null) => void;
  setClipboard: (c: Clipboard) => void;
}

const LS_TAB = 'tsic.app.tab.v1';
const LS_SUB = 'tsic.app.recipesSub.v1';

function loadTab(): AppTab {
  try {
    const v = localStorage.getItem(LS_TAB);
    if (v === 'recipes-loot' || v === 'furniture-loot' || v === 'definitions' || v === 'validations') return v;
  } catch { /* noop */ }
  return 'recipes-loot';
}
function loadSub(): RecipesSubTab {
  try {
    const v = localStorage.getItem(LS_SUB);
    if (v === 'stations' || v === 'furniture' || v === 'tech-tree' || v === 'enemies' || v === 'biome') return v;
  } catch { /* noop */ }
  return 'stations';
}

export const useAppStore = create<AppStore>((set) => ({
  tab: loadTab(),
  recipesSubTab: loadSub(),
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
