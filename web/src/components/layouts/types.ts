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
    scale_3d: TypedVector;
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

/** Parsed enum value: the JSON shows enum values like
 *  `"<ELayoutActorType.PROXY_ACTOR: 0>"` or `"PROXY_ACTOR"`. This helper
 *  normalizes to our union string. */
export function parseLayoutActorType(raw: string): ELayoutActorType {
  const upper = raw.toUpperCase();
  if (upper.includes('PROXY_ACTOR')) return 'ProxyActor';
  if (upper.includes('LAYOUT')) return 'Layout';
  if (upper.includes('ENEMY_SPAWN')) return 'EnemySpawnPoint';
  if (upper.includes('LOOT_SPAWN')) return 'LootSpawnPoint';
  if (upper.includes('VISUAL_HELPER')) return 'VisualHelper';
  return 'ProxyActor';
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
