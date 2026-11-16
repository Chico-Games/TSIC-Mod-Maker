// Which tab each definition folder lives in.
//
// The Items / Furniture rails used to be hand-written lists, so every folder
// the game added later (outfits, computer terminals, sound slots, hotkeys…)
// was reachable only through the raw Definitions tab. Folders are now sorted
// into a home by what their class descends from, so a folder the editor has
// never heard of still shows up somewhere sensible the first time it loads.

import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';
import type { ClassNode } from '../../store/appSchemaStore';
import { FURNITURE_SUBTAB_FOLDER, ITEMS_SUBTAB_FOLDER, type RailHome } from '../../store/appStore';
import { getFolderTheme } from '../folderTheme';
import { CONFIGS } from './configs';
import type { ClassBrowserConfig } from './types';

/** Folders with a purpose-built editor elsewhere. They stay out of the rails
 *  so there is one obvious place to edit each kind of thing. */
const ELSEWHERE: Record<string, string> = {
  layout_definitions: 'Layouts',
  craft_recipe_definitions: 'Recipes & Loot › Stations',
  plant_recipe_definitions: 'Recipes & Loot › Stations',
  furniture_upgrade_recipe: 'Recipes & Loot › Furniture',
  available_recipe_rules_definitions: 'Recipes & Loot › Stations',
  loot_definitions: 'Recipes & Loot › Loot',
  loot_spawn_point_definitions: 'Recipes & Loot › Loot',
  enemy_definitions: 'Recipes & Loot › Enemies',
  biome_definitions: 'Recipes & Loot › Biome',
  behavior_definitions: 'AI',
  perception_definitions: 'AI',
};

const PINNED: Record<RailHome, string[]> = {
  items: Object.values(ITEMS_SUBTAB_FOLDER),
  furniture: Object.values(FURNITURE_SUBTAB_FOLDER),
  systems: [],
};

export interface RailGroup {
  label: string;
  folders: string[];
}

/** Display grouping for the Systems rail. Anything unlisted lands in "Other". */
const SYSTEM_GROUPS: Array<{ label: string; folders: string[] }> = [
  { label: 'World', folders: ['world_rules_definitions', 'scp_game_data', 'random_event_definitions', 'situation_definitions', 'enemy_spawn_parameter_definitions'] },
  { label: 'Rules', folders: ['inventory_rules_definitions', 'boss_summon_recipe_definitions', 'skill_definitions'] },
  { label: 'Audio & input', folders: ['sound_definitions', 'hotkey_definitions', 'input_behavior_definitions'] },
];

function familyOf(cls: string, classNodes: Map<string, ClassNode>): RailHome {
  const node = classNodes.get(cls) ?? classNodes.get(`U${cls}`) ?? classNodes.get(cls.replace(/^U/, ''));
  const chain = [cls, ...(node?.parents ?? [])].map((c) => c.replace(/^U/, ''));
  if (chain.includes('ItemDefinition')) return 'items';
  if (chain.includes('FurnitureDefinition')) return 'furniture';
  return 'systems';
}

/** Every loaded folder, with the class most of its records use. */
function loadedFolders(defs: Map<DefinitionsKey, DefinitionRecord>): Map<string, { cls: string; count: number }> {
  const tally = new Map<string, Map<string, number>>();
  for (const rec of defs.values()) {
    if (!rec.json) continue;
    const cls = String(rec.json.class ?? '');
    let t = tally.get(rec.folder);
    if (!t) { t = new Map(); tally.set(rec.folder, t); }
    t.set(cls, (t.get(cls) ?? 0) + 1);
  }
  const out = new Map<string, { cls: string; count: number }>();
  for (const [folder, t] of tally) {
    let best = '';
    let bestN = -1;
    let total = 0;
    for (const [cls, n] of t) { total += n; if (n > bestN) { best = cls; bestN = n; } }
    out.set(folder, { cls: best, count: total });
  }
  return out;
}

export interface RailModel {
  groups: RailGroup[];
  /** Flat, in display order. */
  folders: string[];
  counts: Map<string, number>;
  classOf: Map<string, string>;
}

export function railFor(
  home: RailHome,
  defs: Map<DefinitionsKey, DefinitionRecord>,
  classNodes: Map<string, ClassNode>,
): RailModel {
  const loaded = loadedFolders(defs);
  const pinnedAnywhere = new Set([...PINNED.items, ...PINNED.furniture]);
  const counts = new Map<string, number>();
  const classOf = new Map<string, string>();
  for (const [f, v] of loaded) { counts.set(f, v.count); classOf.set(f, v.cls); }

  const discovered: string[] = [];
  for (const [folder, v] of loaded) {
    if (ELSEWHERE[folder] || pinnedAnywhere.has(folder)) continue;
    if (familyOf(v.cls, classNodes) === home) discovered.push(folder);
  }
  discovered.sort((a, b) => labelFor(a).localeCompare(labelFor(b)));

  let groups: RailGroup[];
  if (home === 'systems') {
    const left = new Set(discovered);
    groups = [];
    for (const g of SYSTEM_GROUPS) {
      const fs = g.folders.filter((f) => left.has(f));
      for (const f of fs) left.delete(f);
      if (fs.length) groups.push({ label: g.label, folders: fs });
    }
    if (left.size) groups.push({ label: 'Other', folders: [...left].sort((a, b) => labelFor(a).localeCompare(labelFor(b))) });
  } else {
    // A pinned folder with nothing in it is still a class you can make the
    // first record of — but only when the schema actually knows the class.
    const pinned = PINNED[home].filter((f) => {
      if (loaded.has(f)) return true;
      const cls = CONFIGS[f]?.newRecordClass;
      return !!cls && (classNodes.has(`U${cls}`) || classNodes.has(cls));
    });
    groups = [{ label: '', folders: pinned }];
    if (discovered.length) groups.push({ label: 'More', folders: discovered });
  }
  return { groups, folders: groups.flatMap((g) => g.folders), counts, classOf };
}

export function labelFor(folder: string): string {
  const known = CONFIGS[folder]?.label;
  if (known) return known;
  const words = folder.replace(/_definitions?$/, '').split('_').filter(Boolean);
  const title = words.map((w) => (w === 'scp' ? 'SCP' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  if (!/_definitions?$/.test(folder)) return title;
  if (/(s|x|ch|sh)$/i.test(title)) return title;
  if (/[^aeiou]y$/i.test(title)) return `${title.slice(0, -1)}ies`;
  return `${title}s`;
}

/** The hand-written config when there is one, else one derived from the data:
 *  enough for the class browser to list, create and edit records of a folder
 *  it has no special knowledge of. */
export function configFor(folder: string, dominantClass: string | undefined): ClassBrowserConfig | null {
  const known = CONFIGS[folder];
  if (known) return known;
  if (!dominantClass) return null;
  const stem = folder.replace(/_definitions?$/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return {
    label: labelFor(folder),
    emoji: getFolderTheme(folder).emoji,
    newRecordClass: dominantClass.replace(/^U/, ''),
    columns: [],
    // Nothing is known about what these records reference, so no item palette.
    paletteFolders: [],
    newLabel: singular(labelFor(folder)),
    idTemplate: (n) => `${stem}_New${n}`,
  };
}

function singular(plural: string): string {
  if (/ies$/.test(plural)) return `${plural.slice(0, -3)}y`;
  if (/s$/.test(plural) && !/ss$/.test(plural)) return plural.slice(0, -1);
  return plural;
}

export function editedElsewhere(folder: string): string | null {
  return ELSEWHERE[folder] ?? null;
}
