import { useDefinitionsStore } from './store/definitionsStore';
import { useAppStore, type Clipboard } from './store/appStore';

/** Read whatever the user has selected and copy a useful payload to
 *  the clipboard. Priority order:
 *  1. pathSelection: copy the typed envelope at that path (array, map,
 *     or definition_ref slot — preserves the type tag).
 *  2. selectedRecipeKey: copy a "recipe" payload (sourceKey).
 *  Returns the clipboard kind that was set, or null when nothing was
 *  selected. */
export function copyCurrentSelection(): Clipboard | null {
  const app = useAppStore.getState();
  const store = useDefinitionsStore.getState();
  if (app.pathSelection) {
    const rec = store.definitions.get(app.pathSelection.ownerKey);
    if (!rec) return null;
    let cur: any = rec.json;
    for (const seg of app.pathSelection.path) cur = cur?.[seg as any];
    if (cur == null || typeof cur !== 'object') return null;
    let kind: 'array' | 'map' | 'slot' | null = null;
    if (cur.type === 'array') kind = 'array';
    else if (cur.type === 'map') kind = 'map';
    else if (cur.type === 'definition_ref') kind = 'slot';
    if (!kind) return null;
    const payload: Clipboard = { kind, envelope: deepClone(cur) } as any;
    app.setClipboard(payload);
    return payload;
  }
  if (app.selectedRecipeKey) {
    const payload: Clipboard = { kind: 'recipe', sourceKey: app.selectedRecipeKey };
    app.setClipboard(payload);
    return payload;
  }
  return null;
}

/** Apply the clipboard to the current selection. The semantics depend
 *  on what's on the clipboard and what's selected:
 *  - clipboard:array/map → pasted ONTO an array/map pathSelection of
 *    the same kind: replaces the envelope wholesale (preserving the
 *    clipboard's element types).
 *  - clipboard:slot → pasted ONTO any slot: writes the ref value if
 *    classes are compatible.
 *  - clipboard:recipe → pasted with a station selected: clones the
 *    source recipe asset and appends the new ref to that station's
 *    ARR. */
export function pasteCurrentSelection(): { ok: boolean; reason?: string } {
  const app = useAppStore.getState();
  const store = useDefinitionsStore.getState();
  const cb = app.clipboard;
  if (!cb) return { ok: false, reason: 'clipboard empty' };

  if (cb.kind === 'array' || cb.kind === 'map') {
    if (!app.pathSelection) return { ok: false, reason: 'no array selected as paste target' };
    const rec = store.definitions.get(app.pathSelection.ownerKey);
    if (!rec) return { ok: false, reason: 'target not loaded' };
    let cur: any = rec.json;
    for (const seg of app.pathSelection.path) cur = cur?.[seg as any];
    if (!cur || cur.type !== cb.kind) {
      return { ok: false, reason: `target is not a ${cb.kind}` };
    }
    // Preserve target's key/value/element types when pasting — only
    // the `value` payload migrates. This stops a paste from changing
    // a slot's expected class out from under the editor.
    const next = { ...cur, value: deepClone(cb.envelope.value) };
    store.updateValueAtPath(app.pathSelection.ownerKey, app.pathSelection.path, next);
    return { ok: true };
  }

  if (cb.kind === 'slot') {
    if (!app.pathSelection) return { ok: false, reason: 'no slot selected' };
    const rec = store.definitions.get(app.pathSelection.ownerKey);
    if (!rec) return { ok: false, reason: 'target not loaded' };
    let cur: any = rec.json;
    for (const seg of app.pathSelection.path) cur = cur?.[seg as any];
    if (!cur || cur.type !== 'definition_ref') return { ok: false, reason: 'target is not a slot' };
    // Preserve the target's class — paste only the value.
    store.updateValueAtPath(app.pathSelection.ownerKey, app.pathSelection.path, {
      ...cur,
      value: cb.envelope.value,
    });
    return { ok: true };
  }

  if (cb.kind === 'recipe') {
    const src = store.definitions.get(cb.sourceKey);
    if (!src) return { ok: false, reason: 'source recipe not loaded' };
    const stationKey = app.selectedStationKey;
    if (!stationKey) return { ok: false, reason: 'no station selected' };
    const station = store.definitions.get(stationKey);
    const arrRefId = station?.json?.properties?.available_recipe_rules_definition?.value;
    if (typeof arrRefId !== 'string' || !arrRefId) return { ok: false, reason: 'station has no ARR' };
    const arrKey = store.findKeyById(arrRefId);
    if (!arrKey) return { ok: false, reason: 'station ARR missing' };
    const arr = store.definitions.get(arrKey);
    if (!arr) return { ok: false, reason: 'station ARR not loaded' };
    const cls = String(src.json?.class ?? '').replace(/^U/, '');
    const newId = newRecipeIdLike(src.id);
    const dup = store.duplicateDefinition(cb.sourceKey, newId);
    if (!dup) return { ok: false, reason: 'duplicate failed' };
    // Append the new ref to the target ARR.
    const path = ['properties', 'production_machine_rules', 'value', 'recipes'];
    const cur: any = arr.json?.properties?.production_machine_rules?.value?.recipes;
    let nextArr: any;
    if (cur?.type === 'array') {
      const list = Array.isArray(cur.value) ? cur.value.slice() : [];
      list.push({ type: 'definition_ref', class: cls, value: newId });
      nextArr = { ...cur, value: list };
    } else {
      nextArr = {
        type: 'array',
        element_type: { type: 'definition_ref', class: cls },
        value: [{ type: 'definition_ref', class: cls, value: newId }],
      };
    }
    store.updateValueAtPath(arrKey, path, nextArr);
    app.selectRecipe(dup);
    return { ok: true };
  }

  return { ok: false };
}

/** Generate a fresh asset id by appending `_Copy[N]` to the source id
 *  before its trailing exporter tag. Bumps N until the id is unique. */
export function newRecipeIdLike(sourceId: string): string {
  const m = sourceId.match(/^(.+?)(_[A-Z]{2,3})$/);
  const stem = m ? m[1] : sourceId;
  const tag = m ? m[2] : '';
  const store = useDefinitionsStore.getState();
  let candidate = `${stem}_Copy${tag}`;
  let n = 2;
  while (store.findKeyById(candidate)) {
    candidate = `${stem}_Copy${n++}${tag}`;
  }
  return candidate;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
