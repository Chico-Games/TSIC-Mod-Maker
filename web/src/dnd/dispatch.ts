import { useDefinitionsStore } from '../store/definitionsStore';

export type DragSource =
  | { type: 'palette-item'; class: string; value: string }
  | { type: 'recipe-card'; key: string; arrKey: string }
  | { type: 'slot'; ownerKey: string; path: (string | number)[]; class?: string };

/** Drop targets carry an `expectedClass` so the dispatcher (and droppable
 *  hooks) can reject incompatible palette items. The class name is the
 *  bare U-stripped form, e.g. "DamageableFurnitureDefinition".
 *
 *  `def-ref` is the generic type used by the typed-envelope editor in
 *  the Definitions tab and the Enemies / Biome sub-tabs — it matches
 *  every other slot type for the palette-item handler. */
export type DropTarget =
  | { type: 'def-ref'; ownerKey: string; path: (string | number)[]; expectedClass: string }
  | { type: 'recipe-input'; ownerKey: string; path: (string | number)[]; expectedClass: string }
  | { type: 'recipe-output'; ownerKey: string; path: (string | number)[]; expectedClass: string }
  | { type: 'upgrade-cost'; ownerKey: string; path: (string | number)[]; expectedClass: string }
  | { type: 'loot-entry'; ownerKey: string; path: (string | number)[]; expectedClass: string }
  | { type: 'arr-recipes'; arrKey: string; expectedClass: string }
  | { type: 'station-row'; stationKey: string };

/** True when an asset of `sourceClass` satisfies a slot expecting
 *  `expectedClass`. Walks the loaded class hierarchy so a
 *  `ConsumableDefinition` palette item is accepted by a slot expecting
 *  `ItemDefinition`. Empty `expectedClass` means "anything goes". */
export function isClassCompatible(sourceClass: string, expectedClass: string): boolean {
  if (!expectedClass) return true;
  if (!sourceClass) return false;
  const want = expectedClass.replace(/^U/, '');
  const src = sourceClass.replace(/^U/, '');
  if (src === want) return true;
  const store = useDefinitionsStore.getState();
  const node =
    store.classNodes.get(`U${src}`) ??
    store.classNodes.get(src);
  if (!node) return false;
  return node.parents.some((p) => {
    const bare = p.replace(/^U/, '');
    return bare === want;
  });
}

function get<T = any>(json: any, path: (string | number)[]): T | undefined {
  let cur: any = json;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg as any];
  }
  return cur as T;
}

/** Read the `definition_ref` typed envelope at the given path on the
 *  asset's json, return `{class, value}` or null if it's not a ref. */
function readRefAt(ownerKey: string, path: (string | number)[]): { class: string; value: string } | null {
  const rec = useDefinitionsStore.getState().definitions.get(ownerKey);
  if (!rec) return null;
  const v: any = get(rec.json, path);
  if (v && typeof v === 'object' && v.type === 'definition_ref') {
    return { class: String(v.class ?? ''), value: String(v.value ?? '') };
  }
  return null;
}

function writeAtPath(ownerKey: string, path: (string | number)[], value: any) {
  useDefinitionsStore.getState().updateValueAtPath(ownerKey, path, value);
}

/** Apply a drag → drop. Each (source.type, target.type) combination
 *  produces at most one mutation. Illegal pairings are no-ops. */
export function dispatchDnD(source: DragSource, target: DropTarget): void {
  const store = useDefinitionsStore.getState();

  // 1) palette-item → any cell (write a definition_ref envelope).
  //    Class compat is enforced — the slot's expectedClass (or the
  //    existing envelope's class) wins; the source must be compatible.
  if (source.type === 'palette-item' && (
    target.type === 'def-ref' ||
    target.type === 'recipe-input' ||
    target.type === 'recipe-output' ||
    target.type === 'upgrade-cost' ||
    target.type === 'loot-entry'
  )) {
    const rec = store.definitions.get(target.ownerKey);
    if (!rec) return;
    const existing: any = get(rec.json, target.path);
    const slotClass =
      (existing && typeof existing === 'object' && existing.type === 'definition_ref'
        ? String(existing.class ?? '')
        : '') || target.expectedClass;
    if (!isClassCompatible(source.class, slotClass)) return;
    if (existing && typeof existing === 'object' && existing.type === 'definition_ref') {
      // Preserve the slot's class — never let a palette item overwrite a
      // narrower expected type with its own (broader or unrelated) class.
      writeAtPath(target.ownerKey, target.path, {
        ...existing,
        value: source.value,
      });
    } else {
      writeAtPath(target.ownerKey, target.path, {
        type: 'definition_ref',
        class: slotClass || source.class,
        value: source.value,
      });
    }
    return;
  }

  // 2) palette-item → arr-recipes (append a recipe ref to ARR's recipes
  //    array). The ARR's expected class is the recipe class set by the
  //    Stations sub-tab (e.g. CraftRecipeDefinition); reject other items.
  if (source.type === 'palette-item' && target.type === 'arr-recipes') {
    if (!isClassCompatible(source.class, target.expectedClass)) return;
    appendRecipeToArr(target.arrKey, target.expectedClass || source.class, source.value);
    return;
  }

  // 3) recipe-card → station-row: pop the recipe from its current ARR,
  //    push it onto the target station's ARR.
  if (source.type === 'recipe-card' && target.type === 'station-row') {
    const targetArr = arrKeyForStation(target.stationKey);
    if (!targetArr || targetArr === source.arrKey) return;
    const rec = store.definitions.get(source.key);
    if (!rec) return;
    removeRecipeFromArr(source.arrKey, rec.id);
    appendRecipeToArr(targetArr, classOf(rec.json), rec.id);
    return;
  }

  // 4) slot → slot (swap or move ref between cells). Both ends keep
  //    their own class — only the `value` migrates. Compat is checked
  //    in both directions so a Consumable can't end up in a slot that
  //    expects ItemDefinition only because the source had it set.
  if (source.type === 'slot' && (
    target.type === 'def-ref' ||
    target.type === 'recipe-input' ||
    target.type === 'recipe-output' ||
    target.type === 'upgrade-cost' ||
    target.type === 'loot-entry'
  )) {
    const a = readRefAt(source.ownerKey, source.path);
    const b = readRefAt(target.ownerKey, target.path);
    if (!a) return;
    if (a.value && !isClassCompatible(a.class, target.expectedClass)) return;
    if (b && b.value && !isClassCompatible(b.class, source.class ?? a.class)) return;
    // Move A's value into target (preserving target's class).
    if (b) {
      writeAtPath(target.ownerKey, target.path, { ...readEnvelopeAt(target.ownerKey, target.path), value: a.value });
      writeAtPath(source.ownerKey, source.path, { ...readEnvelopeAt(source.ownerKey, source.path), value: b.value });
    } else {
      writeAtPath(target.ownerKey, target.path, { ...readEnvelopeAt(target.ownerKey, target.path), value: a.value });
      writeAtPath(source.ownerKey, source.path, { ...readEnvelopeAt(source.ownerKey, source.path), value: '' });
    }
  }
}

function readEnvelopeAt(ownerKey: string, path: (string | number)[]): any {
  const rec = useDefinitionsStore.getState().definitions.get(ownerKey);
  if (!rec) return { type: 'definition_ref', class: '', value: '' };
  const v: any = get(rec.json, path);
  if (v && typeof v === 'object' && v.type === 'definition_ref') return v;
  return { type: 'definition_ref', class: '', value: '' };
}

function classOf(json: any): string {
  const cls = String(json?.class ?? '');
  return cls.replace(/^U/, '');
}

function arrKeyForStation(stationKey: string): string | null {
  const rec = useDefinitionsStore.getState().definitions.get(stationKey);
  if (!rec) return null;
  const refTyped = rec.json?.properties?.available_recipe_rules_definition;
  const refValue = refTyped && typeof refTyped === 'object' ? String(refTyped.value ?? '') : '';
  if (!refValue) return null;
  return useDefinitionsStore.getState().findKeyById(refValue);
}

function appendRecipeToArr(arrKey: string, refClass: string, refValue: string): void {
  if (!refValue) return;
  const store = useDefinitionsStore.getState();
  const rec = store.definitions.get(arrKey);
  if (!rec) return;
  const path = ['properties', 'production_machine_rules', 'value', 'recipes'];
  const existing: any = get(rec.json, path);
  let nextArray: any;
  if (existing && typeof existing === 'object' && existing.type === 'array') {
    const arr = Array.isArray(existing.value) ? existing.value.slice() : [];
    if (arr.some((e: any) => e?.value === refValue)) return; // already there
    arr.push({ type: 'definition_ref', class: refClass || 'CraftRecipeDefinition', value: refValue });
    nextArray = { ...existing, value: arr };
  } else {
    nextArray = {
      type: 'array',
      element_type: { type: 'definition_ref', class: refClass || 'CraftRecipeDefinition' },
      value: [{ type: 'definition_ref', class: refClass || 'CraftRecipeDefinition', value: refValue }],
    };
  }
  writeAtPath(arrKey, path, nextArray);
}

function removeRecipeFromArr(arrKey: string, refValue: string): void {
  const store = useDefinitionsStore.getState();
  const rec = store.definitions.get(arrKey);
  if (!rec) return;
  const path = ['properties', 'production_machine_rules', 'value', 'recipes'];
  const existing: any = get(rec.json, path);
  if (!existing || existing.type !== 'array' || !Array.isArray(existing.value)) return;
  const filtered = existing.value.filter((e: any) => e?.value !== refValue);
  if (filtered.length === existing.value.length) return;
  writeAtPath(arrKey, path, { ...existing, value: filtered });
}
