import type {
  LayoutObject,
  ResolvedActor,
  ResolverStatus,
  ELayoutActorType,
  DefinitionRef,
} from '../types';
import { parseLayoutActorType } from '../types';
import type { AssetCatalogEntry } from '../../../persistence/dataSource';
import { allQueriesMatch } from './proxySearchQuery';
import { buildSearchTree, defsMatchingAllQueries } from './searchTree';
import { makeStream, pickFloat, pickIndex } from './randomStream';

export type ResolveContext = {
  layoutObject: LayoutObject;
  ownerLayoutKey: string;
  ownerIndex: number;
  tileTags: string[];
  seed: number;
  definitions: Map<string, { id: string; json: any; dirty: boolean }>;
  catalogLookup: (cls: string, path: string) => AssetCatalogEntry | null;
  visitedLayouts?: Set<string>;
};

const KLASS_BY_TYPE: Record<Exclude<ELayoutActorType, 'VisualHelper'>, string> = {
  ProxyActor: 'UFurnitureDefinition',
  Layout: 'ULayoutDefinition',
  EnemySpawnPoint: 'UEnemySpawnPointDefinition',
  LootSpawnPoint: 'ULootSpawnPointDefinition',
};

const REF_KEY_BY_TYPE: Record<Exclude<ELayoutActorType, 'VisualHelper'>, keyof LayoutObject['value']> = {
  ProxyActor: 'furniture_definition',
  Layout: 'layout_definition',
  EnemySpawnPoint: 'enemy_spawn_point_definition',
  LootSpawnPoint: 'loot_spawn_point_definition',
};

export function resolve(ctx: ResolveContext): ResolvedActor {
  const lo = ctx.layoutObject;
  const actorType = parseLayoutActorType(lo.value.layout_actor_type.value);

  const out: ResolvedActor = {
    layoutObject: lo,
    actorType,
    status: { kind: 'ok', chosenDefinitionId: '', meshPath: null, bounds: null } as ResolverStatus,
    transform: lo.value.transform,
    ownerLayoutKey: ctx.ownerLayoutKey,
    ownerIndex: ctx.ownerIndex,
  };

  if (actorType === 'VisualHelper' || lo.value.b_visual_helper.value === true) {
    out.status = { kind: 'ok', chosenDefinitionId: '', meshPath: null, bounds: null };
    return out;
  }

  const filter = lo.value.definition_filter.value;
  const refKey = REF_KEY_BY_TYPE[actorType as Exclude<ELayoutActorType, 'VisualHelper'>];
  const directRef = lo.value[refKey] as DefinitionRef | undefined;
  const hasDirectRef = !!directRef && typeof directRef.value === 'string' && directRef.value.length > 0;
  const queries = filter.search_queries.value;
  const tileReqs = filter.tile_requirements.value;

  if (!hasDirectRef && queries.length === 0) {
    out.status = { kind: 'not-configured' };
    return out;
  }

  if (tileReqs.length > 0 && !allQueriesMatch(tileReqs, ctx.tileTags)) {
    out.status = { kind: 'filtered-by-tile-requirements' };
    return out;
  }

  const seedOffset = filter.seed_offset.value;
  const baseSeed = (ctx.seed | 0) + (seedOffset === -1 ? ctx.ownerIndex : seedOffset);
  const stream = makeStream(baseSeed);
  const roll = pickFloat(stream);
  const over = filter.spawn_chance_over.value;
  const under = filter.spawn_chance_under.value;
  if (roll < over || roll >= under) {
    out.status = { kind: 'spawn-chance-skipped', over, under };
    return out;
  }

  let chosenDefId: string | null = null;
  if (hasDirectRef && directRef) {
    chosenDefId = directRef.value;
  } else {
    const klass = KLASS_BY_TYPE[actorType as Exclude<ELayoutActorType, 'VisualHelper'>];
    const tree = buildSearchTree(ctx.definitions, klass);
    const matches = defsMatchingAllQueries(tree, queries);
    if (matches.length === 0) {
      out.status = { kind: 'no-matches' };
      return out;
    }
    const idx = pickIndex(stream, matches.length);
    chosenDefId = matches[idx].id;
  }

  if (actorType === 'ProxyActor') {
    const defRec = ctx.definitions.get(chosenDefId);
    const sm = defRec?.json?.properties?.static_mesh;
    const meshPath = (sm?.value as string | null | undefined) ?? null;
    if (!meshPath) {
      out.status = { kind: 'missing-mesh', chosenDefinitionId: chosenDefId };
      return out;
    }
    const entry = ctx.catalogLookup('StaticMesh', meshPath);
    out.status = {
      kind: 'ok',
      chosenDefinitionId: chosenDefId,
      meshPath,
      bounds: entry?.bounds ?? null,
    };
    return out;
  }

  if (actorType === 'Layout') {
    const visited = ctx.visitedLayouts ?? new Set<string>();
    if (visited.has(chosenDefId)) {
      out.status = { kind: 'cycle', path: [...visited, chosenDefId] };
      return out;
    }
    const innerVisited = new Set(visited);
    innerVisited.add(chosenDefId);
    const innerRec = ctx.definitions.get(chosenDefId);
    const innerObjs = (innerRec?.json?.properties?.layout_objects?.value as LayoutObject[] | undefined) ?? [];
    const children: ResolvedActor[] = innerObjs.map((inner, i) => resolve({
      layoutObject: inner,
      ownerLayoutKey: chosenDefId!,
      ownerIndex: i,
      tileTags: ctx.tileTags,
      seed: ctx.seed,
      definitions: ctx.definitions,
      catalogLookup: ctx.catalogLookup,
      visitedLayouts: innerVisited,
    }));
    out.status = { kind: 'ok', chosenDefinitionId: chosenDefId, meshPath: null, bounds: null };
    out.children = children;
    return out;
  }

  // EnemySpawnPoint / LootSpawnPoint
  out.status = { kind: 'ok', chosenDefinitionId: chosenDefId, meshPath: null, bounds: null };
  return out;
}
