import { create } from 'zustand';

export type AppTab = 'recipes-loot' | 'furniture-loot' | 'definitions' | 'validations';
export type RecipesSubTab = 'stations' | 'furniture' | 'tech-tree' | 'enemies' | 'biome';

interface AppStore {
  tab: AppTab;
  recipesSubTab: RecipesSubTab;
  searchOpen: boolean;
  setTab: (t: AppTab) => void;
  setRecipesSubTab: (t: RecipesSubTab) => void;
  setSearchOpen: (open: boolean) => void;
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
  setTab: (t) => {
    try { localStorage.setItem(LS_TAB, t); } catch { /* noop */ }
    set({ tab: t });
  },
  setRecipesSubTab: (t) => {
    try { localStorage.setItem(LS_SUB, t); } catch { /* noop */ }
    set({ recipesSubTab: t });
  },
  setSearchOpen: (open) => set({ searchOpen: open }),
}));
