import type { TechFilters } from './TechTreeSubTab';
import type { TechGraph, TechNode } from './graph';

/** Does this node survive the filter bar?
 *
 *  Level / kind / station are properties of the *recipes* that produce a
 *  thing, so they're evaluated against `producedBy`. Raw materials have no
 *  producer, so any recipe-shaped filter necessarily excludes them. */
export function nodePasses(graph: TechGraph, node: TechNode, f: TechFilters): boolean {
  if (f.text) {
    const q = f.text.trim().toLowerCase();
    if (q && !node.label.toLowerCase().includes(q) && !node.id.toLowerCase().includes(q)) {
      return false;
    }
  }

  const recipeFiltered = f.levels.size > 0 || f.kinds.size > 0 || !!f.station;
  if (!recipeFiltered) return true;

  const producers = node.producedBy.map((r) => graph.recipes.get(r)).filter(Boolean);
  if (producers.length === 0) return false;

  return producers.some((r) => {
    if (!r) return false;
    if (f.levels.size > 0 && !f.levels.has(r.level)) return false;
    if (f.kinds.size > 0 && !f.kinds.has(r.kind)) return false;
    if (f.station && !r.stations.includes(f.station)) return false;
    return true;
  });
}

export function filterNodes(graph: TechGraph, f: TechFilters): TechNode[] {
  return [...graph.nodes.values()].filter((n) => nodePasses(graph, n, f));
}
