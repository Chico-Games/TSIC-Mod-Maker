/** Type-safe shapes for the LayoutObject and DefinitionFilter envelopes
 *  that the exporter emits. These are IDE-only — the runtime JSON is
 *  consumed directly via the existing TypedValueEditor envelopes. */

export type TypedFloat = { type: 'float'; value: number };
export type TypedInt = { type: 'int'; value: number };
export type TypedBool = { type: 'bool'; value: boolean };
export type TypedString = { type: 'string'; value: string };

export type TypedVector = {
  type: 'struct';
  struct_name: 'Vector';
  value: { x: TypedFloat; y: TypedFloat; z: TypedFloat };
};

export type TypedRotator = {
  type: 'struct';
  struct_name: 'Rotator' | 'Quat';
  value: Record<string, TypedFloat>;
};

export type TypedTransform = {
  type: 'struct';
  struct_name: 'Transform';
  value: {
    translation: TypedVector;
    rotation: TypedRotator;
    scale3_d: TypedVector;
  };
};

export type ESearchQuery =
  | 'None'
  | 'HasAnyInclParents'
  | 'HasAnyExact'
  | 'HasAllInclParents'
  | 'HasAllExact';

export type ProxySearchTreeQuery = {
  type: 'struct';
  struct_name: 'ProxySearchTreeQuery';
  value: {
    search_query: { type: 'enum'; enum_name: 'ESearchQuery'; value: ESearchQuery };
    tags: { type: 'gameplay_tag_container'; value: string[] };
    b_not: TypedBool;
  };
};

export type DefinitionFilter = {
  type: 'struct';
  struct_name: 'DefinitionFilter';
  value: {
    seed_offset: TypedInt;
    search_queries: { type: 'array'; value: ProxySearchTreeQuery[]; element_type?: unknown };
    tile_requirements: { type: 'array'; value: ProxySearchTreeQuery[]; element_type?: unknown };
    spawn_chance_over: TypedFloat;
    spawn_chance_under: TypedFloat;
  };
};

export type ELayoutActorType =
  | 'ProxyActor'
  | 'Layout'
  | 'EnemySpawnPoint'
  | 'LootSpawnPoint'
  | 'VisualHelper';

export type DefinitionRef = {
  type: 'definition_ref';
  class: string;
  value: string;
};

export type LayoutObject = {
  type: 'struct';
  struct_name: 'LayoutObject';
  value: {
    layout_actor_type: { type: 'enum'; enum_name: 'ELayoutActorType' | 'LayoutActorType'; value: string };
    b_visual_helper: TypedBool;
    definition_filter: DefinitionFilter;
    furniture_definition?: DefinitionRef;
    layout_definition?: DefinitionRef;
    enemy_spawn_point_definition?: DefinitionRef;
    loot_spawn_point_definition?: DefinitionRef;
    transform: TypedTransform;
  };
};

/** Coerce an enum field's `.value` to its bare member-name string, tolerating
 *  the shapes the lean→envelope converter produces when `_schema.json` doesn't
 *  fully type a nested struct field (e.g. ProxySearchTreeQuery.search_query):
 *   - proper enum envelope value → a plain string ("PROXY_ACTOR")
 *   - struct-wrapped lean enum    → { name: { value: "HAS_ALL_EXACT" }, value: {…} }
 *   - bare lean enum dual format  → { name: "HAS_ALL_EXACT", value: 4 }
 *  Without this the resolver's `.toUpperCase()` crashes on the object form. */
export function coerceEnumString(raw: any): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const n = raw.name;
    if (typeof n === 'string') return n;
    if (n && typeof n === 'object' && typeof n.value === 'string') return n.value;
    if (typeof raw.value === 'string') return raw.value;
  }
  return '';
}

/** Parsed enum value: the JSON shows enum values in any of several forms:
 *  - Python repr from the asset exporter: `"<ELayoutActorType.PROXY_ACTOR: 0>"`
 *  - Bare UPPER_SNAKE: `"PROXY_ACTOR"`
 *  - C++ PascalCase from the dropdown: `"ProxyActor"`
 *  Normalize by stripping non-alphanumerics + uppercasing, then substring-match. */
export function parseLayoutActorType(raw: unknown): ELayoutActorType {
  const c = coerceEnumString(raw).toUpperCase().replace(/[^A-Z]/g, '');
  if (c.includes('PROXYACTOR')) return 'ProxyActor';
  if (c.includes('ENEMYSPAWN')) return 'EnemySpawnPoint';
  if (c.includes('LOOTSPAWN')) return 'LootSpawnPoint';
  if (c.includes('VISUALHELPER')) return 'VisualHelper';
  if (c.includes('LAYOUT')) return 'Layout';
  return 'ProxyActor';
}

/** Same normalization for ESearchQuery — the JSON dumps emit the Python
 *  repr form `"<SearchQuery.HAS_ALL_EXACT: 4>"`, which doesn't match the
 *  PascalCase union directly. Strip non-alphanumerics and substring-match. */
export function parseSearchQuery(raw: unknown): ESearchQuery {
  const c = coerceEnumString(raw).toUpperCase().replace(/[^A-Z]/g, '');
  if (!c) return 'None';
  if (c.includes('HASANYINCLPARENTS')) return 'HasAnyInclParents';
  if (c.includes('HASALLINCLPARENTS')) return 'HasAllInclParents';
  if (c.includes('HASANYEXACT')) return 'HasAnyExact';
  if (c.includes('HASALLEXACT')) return 'HasAllExact';
  return 'None';
}

export type ResolverStatus =
  | { kind: 'ok'; chosenDefinitionId: string; meshPath: string | null; bounds: { min: [number, number, number]; max: [number, number, number] } | null }
  | { kind: 'not-configured' }
  | { kind: 'filtered-by-tile-requirements' }
  | { kind: 'spawn-chance-skipped'; over: number; under: number }
  | { kind: 'no-matches' }
  | { kind: 'missing-mesh'; chosenDefinitionId: string }
  | { kind: 'cycle'; path: string[] };

export type ResolvedActor = {
  layoutObject: LayoutObject;
  actorType: ELayoutActorType;
  status: ResolverStatus;
  transform: TypedTransform;
  /** Populated only when actorType is 'Layout' and status is 'ok'. */
  children?: ResolvedActor[];
  /** Layout key in `definitionsStore.definitions`. */
  ownerLayoutKey: string;
  /** Index into the owner layout's `layout_objects.value` array. */
  ownerIndex: number;
};
