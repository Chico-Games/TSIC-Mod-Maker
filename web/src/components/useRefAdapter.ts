import { useMemo, useRef } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppSchemaStore } from '../store/appSchemaStore';
import type { RefAdapter } from './TypedValueEditor';

/** Build the RefAdapter that the TypedPropertiesEditor expects, sourced
 *  from the definitionsStore. The `navigate` callback is wired to the
 *  caller-supplied `onJumpToId` so each tab can decide what "open this
 *  asset" means.
 *
 *  Identity stability matters a lot here: child editors memoize their
 *  option lists on `[refAdapter, className, value]`, and building those
 *  lists is O(assets²) (a full `assetsOfClass` scan plus a per-option
 *  `folderForId` lookup that itself scans). If the adapter got a fresh
 *  identity on every render, every `definition_ref` dropdown would rebuild
 *  its options on every keystroke / toggle — the source of the editing lag.
 *
 *  So the adapter is memoized on a *structural* fingerprint of the catalog
 *  (`catalogSig`) that only changes when the set of records or any record's
 *  class changes — never when a property value is edited. Ordinary edits
 *  therefore keep the adapter (and the derived option lists) referentially
 *  stable, while genuine catalog changes still refresh the dropdowns.
 *
 *  Callbacks read live store state via `getState()` rather than closing over
 *  the `definitions` Map, so a stable adapter never serves stale data. */
export function useRefAdapter(onJumpToId?: (assetId: string) => void): RefAdapter {
  const definitions = useDefinitionsStore((s) => s.definitions);

  // Schema-store lookups are stable action references (created once when the
  // store is built), so closing over them keeps the adapter identity stable.
  const lookupContainerType = useAppSchemaStore((s) => s.lookupContainerType);
  const getPropertyMeta = useAppSchemaStore((s) => s.getPropertyMeta);
  const lookupArrayElementClass = useAppSchemaStore((s) => s.lookupArrayElementClass);
  const getEnumMembers = useAppSchemaStore((s) => s.getEnumMembers);

  // Keep the latest jump handler in a ref so a fresh closure from the caller
  // doesn't churn the adapter's identity.
  const jumpRef = useRef(onJumpToId);
  jumpRef.current = onJumpToId;

  // Structural fingerprint: a rolling hash over `${key}|${class}` for every
  // record. Changes on add / remove / rename / class-change, but is invariant
  // to property-value edits (which only mutate nested `value`s). Cheap O(N)
  // pass that replaces the previous O(N²)-per-edit option rebuilds.
  const catalogSig = useMemo(() => {
    let h = 0;
    for (const [k, rec] of definitions) {
      const s = `${k}|${rec.json?.class ?? ''}`;
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
    return h;
  }, [definitions]);

  return useMemo<RefAdapter>(() => ({
    options: (className) => useDefinitionsStore.getState().assetsOfClass(className),
    resolves: (assetId) => useDefinitionsStore.getState().findKeyById(assetId) != null,
    navigate: (assetId) => {
      const onJump = jumpRef.current;
      if (onJump) {
        onJump(assetId);
        return;
      }
      const s = useDefinitionsStore.getState();
      const k = s.findKeyById(assetId);
      if (!k) return;
      const rec = s.definitions.get(k);
      if (!rec) return;
      s.selectFolder(rec.folder);
      s.selectDefinition(k);
    },
    createNew: (className, id) => {
      if (!className || !id) return null;
      const k = useDefinitionsStore.getState().createDefinitionForClass(className, id);
      if (!k) return null;
      return id;
    },
    lookupContainerType,
    getPropertyMeta,
    lookupArrayElementClass,
    getEnumMembers,
    folderForId: (assetId) => {
      const s = useDefinitionsStore.getState();
      const k = s.findKeyById(assetId);
      if (!k) return null;
      return s.definitions.get(k)?.folder ?? null;
    },
  }), [
    // catalogSig refreshes option lists when the catalog structure changes;
    // property edits leave it untouched so the adapter stays stable.
    catalogSig,
    lookupContainerType, getPropertyMeta, lookupArrayElementClass, getEnumMembers,
  ]);
}
