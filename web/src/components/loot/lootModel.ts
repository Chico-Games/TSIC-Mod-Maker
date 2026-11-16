// Read/write helpers for the three shapes of loot the game pack has.
//
//   drop table   ULootDefinition.items_to_drop
//                What a piece of furniture leaves behind when it is destroyed.
//                Every row rolls on its own: `chance_to_drop` to appear at all,
//                then `count` copies.
//
//   world loot   ULootSpawnPointDefinition.loot_by_difficulty
//                What a spawn point on the floor / a furniture surface / inside
//                a container can produce. Per store difficulty: one roll of
//                `spawn_chance` to produce anything, then ONE row picked by
//                `weight`. With `accumulate_previous_tiers`, a harder tier
//                picks from its own rows plus every easier tier's.
//
//   enemy drops  UEnemyDefinition.death_drop_table
//                One row picked by `weight` when the enemy dies.
//
// Everything here works on the editor's typed envelopes and writes back the
// smallest possible change, cloning the shape of a sibling row where one
// exists so a save stays byte-compatible with what the game exported.

import type { DefinitionRecord } from '../../store/definitionsStore';

export type LootKind = 'drop' | 'world' | 'enemy';

export const LOOT_FOLDER: Record<LootKind, string> = {
  drop: 'loot_definitions',
  world: 'loot_spawn_point_definitions',
  enemy: 'enemy_definitions',
};

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_LABEL: Record<string, string> = { EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard' };

export const SOURCE_TYPES = ['FLOOR', 'FURNITURE', 'CONTAINER', 'ENEMY_DROP'] as const;
export const SOURCE_LABEL: Record<string, string> = {
  FLOOR: 'On the floor',
  FURNITURE: 'On furniture',
  CONTAINER: 'Inside containers',
  ENEMY_DROP: 'Enemy drop',
};

type Path = (string | number)[];

const num = (env: any, fallback = 0): number => {
  const v = env?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const str = (env: any): string => (typeof env?.value === 'string' ? env.value : '');

/** Enum envelopes usually hold the bare member name, but a schema gap can
 *  leave the lean `{name, value}` pair wrapped in a struct. Accept both. */
export function enumName(env: any): string {
  const v = env?.value;
  if (typeof v === 'string') return v.replace(/^.*::/, '').toUpperCase();
  if (v && typeof v === 'object') {
    const n = v.name?.value ?? v.name;
    if (typeof n === 'string') return n.toUpperCase();
  }
  return '';
}

// ── drop tables ────────────────────────────────────────────────────────────

export interface DropRow {
  item: string;
  count: number;
  /** 0..1 */
  chance: number;
  path: Path;
}

const DROP_PATH: Path = ['properties', 'items_to_drop'];

export function readDropRows(rec: DefinitionRecord | null | undefined): DropRow[] {
  const arr = rec?.json?.properties?.items_to_drop?.value;
  if (!Array.isArray(arr)) return [];
  return arr.map((e: any, i: number) => ({
    item: str(e?.value?.item_to_drop),
    count: num(e?.value?.count, 1),
    chance: num(e?.value?.chance_to_drop, 1),
    path: [...DROP_PATH, 'value', i],
  }));
}

function newDropEntry(rec: DefinitionRecord, item: string): any {
  const sibling = rec.json?.properties?.items_to_drop?.value?.[0];
  const refClass = sibling?.value?.item_to_drop?.class
    ?? rec.json?.properties?.items_to_drop?.element_type?.fields?.item_to_drop?.class
    ?? 'CraftingMaterialDefinition';
  const refType = sibling?.value?.item_to_drop?.type ?? 'soft_asset_ref';
  return {
    type: 'struct',
    struct_name: 'ItemToDrop',
    value: {
      item_to_drop: { type: refType, class: refClass, value: item },
      count: { type: 'int', value: 1 },
      chance_to_drop: { type: 'float', value: 1 },
    },
  };
}

/** The whole `items_to_drop` envelope with `item` appended. */
export function dropEnvelopeWith(rec: DefinitionRecord, item: string): any {
  const cur = rec.json?.properties?.items_to_drop;
  const base = cur && typeof cur === 'object' && Array.isArray(cur.value)
    ? cur
    : {
        type: 'array',
        element_type: {
          type: 'struct',
          struct_name: 'ItemToDrop',
          fields: {
            item_to_drop: { type: 'soft_asset_ref', class: 'CraftingMaterialDefinition' },
            count: { type: 'int' },
            chance_to_drop: { type: 'float' },
          },
        },
        value: [],
      };
  return { ...base, value: [...base.value, newDropEntry(rec, item)] };
}

export const dropListPath = (): Path => [...DROP_PATH];

/** Average copies of each item one destruction yields. */
export function expectedDrops(rows: DropRow[]): Array<{ item: string; avg: number }> {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (!r.item) continue;
    by.set(r.item, (by.get(r.item) ?? 0) + r.count * Math.max(0, Math.min(1, r.chance)));
  }
  return [...by.entries()].map(([item, avg]) => ({ item, avg })).sort((a, b) => b.avg - a.avg);
}

// ── weighted rows (world loot tiers, enemy drops) ──────────────────────────

export interface WeightedRow {
  item: string;
  count: number;
  weight: number;
  path: Path;
  /** Set on rows a tier only sees because an easier tier defined them. */
  inheritedFrom?: string;
}

function readWeighted(arr: any, base: Path, itemField: string): WeightedRow[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((e: any, i: number) => ({
    item: str(e?.value?.[itemField]),
    count: num(e?.value?.count, 1),
    weight: num(e?.value?.weight, 1),
    path: [...base, i],
  }));
}

function newWeightedEntry(siblings: any, itemField: string, structName: string, item: string): any {
  const sibling = Array.isArray(siblings) ? siblings[0] : null;
  if (sibling?.value && typeof sibling.value === 'object') {
    const clone = JSON.parse(JSON.stringify(sibling));
    clone.value[itemField] = { ...(clone.value[itemField] ?? { type: 'string' }), value: item };
    clone.value.count = { ...(clone.value.count ?? { type: 'int' }), value: 1 };
    clone.value.weight = { ...(clone.value.weight ?? { type: 'int' }), value: 1 };
    return clone;
  }
  return {
    type: 'struct',
    struct_name: structName,
    value: {
      [itemField]: { type: 'string', value: item },
      count: { type: 'int', value: 1 },
      weight: { type: 'int', value: 1 },
    },
  };
}

// ── world loot ─────────────────────────────────────────────────────────────

export interface WorldTier {
  difficulty: string;
  /** Index into `loot_by_difficulty.value`, or -1 when the tier isn't authored. */
  index: number;
  spawnChance: number;
  rows: WeightedRow[];
  /** Path to this tier's `loot_items` array envelope. */
  listPath: Path | null;
  spawnChancePath: Path | null;
}

export interface WorldLoot {
  tiers: WorldTier[];
  accumulate: boolean;
  source: string;
}

const TIERS_PATH: Path = ['properties', 'loot_by_difficulty'];

export function readWorldLoot(rec: DefinitionRecord | null | undefined): WorldLoot {
  const props = rec?.json?.properties ?? {};
  const entries: any[] = Array.isArray(props.loot_by_difficulty?.value) ? props.loot_by_difficulty.value : [];
  const seen = new Map<string, number>();
  entries.forEach((e, i) => { const n = enumName(e?.key); if (n && !seen.has(n)) seen.set(n, i); });
  const order = [...DIFFICULTIES, ...[...seen.keys()].filter((k) => !DIFFICULTIES.includes(k as Difficulty))];
  const tiers: WorldTier[] = order.map((difficulty) => {
    const index = seen.get(difficulty) ?? -1;
    if (index < 0) return { difficulty, index, spawnChance: 0, rows: [], listPath: null, spawnChancePath: null };
    const tierValue = entries[index]?.value?.value ?? {};
    const tierPath: Path = [...TIERS_PATH, 'value', index, 'value', 'value'];
    return {
      difficulty,
      index,
      spawnChance: num(tierValue.spawn_chance, 0),
      rows: readWeighted(tierValue.loot_items?.value, [...tierPath, 'loot_items', 'value'], 'item_entity'),
      listPath: [...tierPath, 'loot_items'],
      spawnChancePath: [...tierPath, 'spawn_chance', 'value'],
    };
  });
  return {
    tiers,
    accumulate: props.accumulate_previous_tiers?.value === true,
    source: enumName(props.source_type) || 'FLOOR',
  };
}

/** The rows a tier actually picks from in game: its own, plus every easier
 *  tier's when the table accumulates. */
export function effectiveRows(loot: WorldLoot, tierIdx: number): WeightedRow[] {
  const own = loot.tiers[tierIdx]?.rows ?? [];
  if (!loot.accumulate) return own;
  const out: WeightedRow[] = [];
  for (let i = 0; i < tierIdx; i++) {
    for (const r of loot.tiers[i].rows) out.push({ ...r, inheritedFrom: loot.tiers[i].difficulty });
  }
  return [...out, ...own];
}

/** A tier's `loot_items` envelope with `item` appended. */
export function worldListWith(rec: DefinitionRecord, tier: WorldTier, item: string): any {
  const entries = rec.json?.properties?.loot_by_difficulty?.value ?? [];
  const cur = entries[tier.index]?.value?.value?.loot_items;
  // Borrow the row shape from this tier, or failing that any other tier.
  let siblings: any = cur?.value;
  if (!Array.isArray(siblings) || siblings.length === 0) {
    for (const e of entries) {
      const v = e?.value?.value?.loot_items?.value;
      if (Array.isArray(v) && v.length > 0) { siblings = v; break; }
    }
  }
  const entry = newWeightedEntry(siblings, 'item_entity', '', item);
  const base = cur && Array.isArray(cur.value) ? cur : { type: 'array', element_type: null, value: [] };
  return { ...base, value: [...base.value, entry] };
}

/** The whole `loot_by_difficulty` envelope with an empty tier added in
 *  difficulty order. */
export function worldTiersWith(rec: DefinitionRecord, difficulty: string, spawnChance: number): any {
  const cur = rec.json?.properties?.loot_by_difficulty;
  const base = cur && Array.isArray(cur.value)
    ? cur
    : {
        type: 'map',
        key_type: { type: 'enum', enum_name: 'ECurrentStoreDifficulty' },
        value_type: { type: 'struct', struct_name: 'LootDifficultyTier', fields: { spawn_chance: { type: 'float' } } },
        value: [],
      };
  const sibling = base.value[0];
  const entry = {
    key: { ...(sibling?.key ?? { type: 'enum', enum_name: 'ECurrentStoreDifficulty' }), value: difficulty },
    value: {
      type: 'struct',
      struct_name: 'LootDifficultyTier',
      value: {
        loot_items: { type: 'array', element_type: null, value: [] },
        spawn_chance: { type: 'float', value: spawnChance },
      },
    },
  };
  const rank = (d: string) => { const i = DIFFICULTIES.indexOf(d as Difficulty); return i < 0 ? 99 : i; };
  const value = [...base.value, entry].sort((a, b) => rank(enumName(a.key)) - rank(enumName(b.key)));
  return { ...base, value };
}

// ── enemy drops ────────────────────────────────────────────────────────────

const ENEMY_PATH: Path = ['properties', 'death_drop_table'];

export function readEnemyRows(rec: DefinitionRecord | null | undefined): WeightedRow[] {
  return readWeighted(rec?.json?.properties?.death_drop_table?.value, [...ENEMY_PATH, 'value'], 'world_item');
}

export function enemyListWith(rec: DefinitionRecord, item: string): any {
  const cur = rec.json?.properties?.death_drop_table;
  const base = cur && Array.isArray(cur.value)
    ? cur
    : {
        type: 'array',
        element_type: { type: 'struct', struct_name: 'DeathDropEntry', fields: { count: { type: 'int' }, weight: { type: 'int' } } },
        value: [],
      };
  return { ...base, value: [...base.value, newWeightedEntry(base.value, 'world_item', 'DeathDropEntry', item)] };
}

export const enemyListPath = (): Path => [...ENEMY_PATH];

// ── shared ─────────────────────────────────────────────────────────────────

/** Share of picks each row gets, 0..1, by weight. */
export function shares(rows: WeightedRow[]): number[] {
  const total = rows.reduce((s, r) => s + Math.max(0, r.weight), 0);
  return rows.map((r) => (total > 0 ? Math.max(0, r.weight) / total : 0));
}

/** An array envelope with the element at `index` removed. */
export function without(listEnv: any, index: number): any {
  return { ...listEnv, value: (listEnv?.value ?? []).filter((_: any, i: number) => i !== index) };
}

/** Which folders a row of this kind may point at. Drop tables hold inventory
 *  items; world loot and enemy drops hold the world (static) item. */
export function pickableFolders(kind: LootKind): string[] {
  if (kind === 'drop') {
    return [
      'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions',
      'equippable_definitions', 'seed_item_definitions', 'glove_definitions',
      'constructable_item_definitions', 'trap_item_definitions', 'shoe_definitions', 'outfit_definitions',
    ];
  }
  return ['static_item_definitions'];
}

/** One-line summary of a table for the rail. */
export function summarise(kind: LootKind, rec: DefinitionRecord): { count: number; text: string } {
  if (kind === 'drop') {
    const n = readDropRows(rec).length;
    return { count: n, text: n === 0 ? 'empty' : `${n} item${n === 1 ? '' : 's'}` };
  }
  if (kind === 'enemy') {
    const n = readEnemyRows(rec).length;
    return { count: n, text: n === 0 ? 'drops nothing' : `${n} drop${n === 1 ? '' : 's'}` };
  }
  const loot = readWorldLoot(rec);
  const n = loot.tiers.reduce((s, t) => s + t.rows.length, 0);
  const authored = loot.tiers.filter((t) => t.index >= 0).length;
  return { count: n, text: n === 0 ? 'empty' : `${n} item${n === 1 ? '' : 's'} · ${authored} tier${authored === 1 ? '' : 's'}` };
}
