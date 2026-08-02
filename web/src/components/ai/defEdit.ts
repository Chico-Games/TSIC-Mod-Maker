// Writing back to definitions from the AI views.
//
// Every edit goes through `updateValueAtPath`, the same call the Definitions tab uses, so
// AI edits land in the normal dirty / undo / Save pipeline instead of a side channel. The
// only extra work here is the typed-envelope translation and the inheritance rule.

import { useDefinitionsStore } from '../../store/definitionsStore';
import { aiKey, type AiFolderSlot } from '../../ai/loadPack';
import { buildLocalOverride, envelopeAt, envelopePath, plainOf, toEnvelope } from './envelope';

/**
 * Set `properties.<...path>` on an AI definition.
 *
 * `templateId` names another definition of the same class to copy envelope TYPES from when
 * the path isn't authored on this record yet. For perception profiles that's the base in
 * the `extends` chain — which is exactly how an inherited value gets a local override
 * instead of the base being retuned for every enemy that shares it.
 */
export function setAiValue(
  slot: AiFolderSlot,
  id: string,
  path: (string | number)[],
  value: any,
  templateId?: string,
) {
  const store = useDefinitionsStore.getState();
  const key = aiKey(slot, id);
  const record = store.definitions.get(key);
  if (!record) return;

  // Already authored here: set the leaf in place, keeping its envelope type.
  const direct = envelopePath(record.json, path);
  if (direct) {
    const leaf = envelopeAt(record.json, path);
    const typed = leaf?.type === 'int' && typeof value === 'number' ? Math.round(value) : value;
    store.updateValueAtPath(key, direct, typed);
    return;
  }

  // Not authored here — synthesise the override, borrowing types from the template.
  const template = templateId ? store.definitions.get(aiKey(slot, templateId))?.json : undefined;
  const override = buildLocalOverride(record.json, template ?? record.json, path, value);
  if (override) {
    store.updateValueAtPath(key, override.path, override.value);
    return;
  }

  // Last resort (a brand-new key with no precedent anywhere): write a fresh envelope.
  store.updateValueAtPath(key, ['properties', ...path], toEnvelope(value));
}

/** Replace a whole subtree with plain JSON, wrapping it back into envelopes. */
export function setAiJson(slot: AiFolderSlot, id: string, path: (string | number)[], plain: any) {
  const store = useDefinitionsStore.getState();
  const key = aiKey(slot, id);
  const record = store.definitions.get(key);
  if (!record) return;
  const real = envelopePath(record.json, path);
  if (real) {
    // envelopePath ends at `value`; drop it so we replace the whole envelope.
    store.updateValueAtPath(key, real.slice(0, -1), toEnvelope(plain));
    return;
  }
  store.updateValueAtPath(key, ['properties', ...path], toEnvelope(plain));
}

/** Read `properties.<...path>` as plain JSON, or undefined when not authored here. */
export function getAiValue(slot: AiFolderSlot, id: string, path: (string | number)[]): any {
  const record = useDefinitionsStore.getState().definitions.get(aiKey(slot, id));
  const node = envelopeAt(record?.json, path);
  return node === undefined ? undefined : plainOf(node);
}

/**
 * Is this field authored on THIS record, or inherited from the `extends` chain?
 *
 * PRC_BoneHead only authors `sight.range` and `sight.time_to_spot`; the rest comes from
 * PRC_BaseHostile. The editor shows which is which so you always know whether you're
 * tuning one enemy or all of them.
 */
export function isLocallyAuthored(json: any, path: (string | number)[]): boolean {
  return envelopeAt(json, path) !== undefined;
}
