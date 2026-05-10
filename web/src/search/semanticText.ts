import type { DefinitionRecord } from '../store/definitionsStore';
import { humanizeAssetId } from '../components/definitionsNaming';

/** Build the natural-language string we hand to the semantic
 *  embedder for each asset. The richer the text, the better the
 *  embedding clusters — we throw in the humanized id, the
 *  display_name, the description, and the bare class so a query
 *  like "food" lights up Consumables and "wooden" picks up the
 *  wood-themed CraftingMaterials. Keep this stable; if it changes
 *  every cached embedding becomes stale. */
export function semanticTextFor(rec: DefinitionRecord): string {
  const parts: string[] = [humanizeAssetId(rec.id)];
  const props = rec.json?.properties ?? {};
  const dn = props.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) {
    parts.push(dn.value);
  }
  const desc = props.description;
  if (desc && typeof desc === 'object' && typeof desc.value === 'string' && desc.value) {
    parts.push(desc.value);
  }
  const cls = String(rec.json?.class ?? '').replace(/^U/, '').replace(/Definition$/, '');
  if (cls) parts.push(cls.replace(/([a-z])([A-Z])/g, '$1 $2'));
  return parts.join(' · ');
}
