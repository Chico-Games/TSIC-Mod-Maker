import { useMemo } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppSchemaStore } from '../store/appSchemaStore';
import type { RefAdapter } from './TypedValueEditor';

/** Build the RefAdapter that the TypedPropertiesEditor expects, sourced
 *  from the definitionsStore. Memoized per render. The `navigate`
 *  callback is wired to the caller-supplied `onJumpToKey` so each tab
 *  can decide what "open this asset" means. */
export function useRefAdapter(onJumpToId?: (assetId: string) => void): RefAdapter {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const assetsOfClass = useDefinitionsStore((s) => s.assetsOfClass);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const lookupContainerType = useDefinitionsStore((s) => s.lookupContainerType);
  const getPropertyMeta = useAppSchemaStore((s) => s.getPropertyMeta);
  const lookupArrayElementClass = useAppSchemaStore((s) => s.lookupArrayElementClass);
  const getEnumMembers = useAppSchemaStore((s) => s.getEnumMembers);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);

  return useMemo<RefAdapter>(() => ({
    options: (className) => assetsOfClass(className),
    resolves: (assetId) => findKeyById(assetId) != null,
    navigate: (assetId) => {
      if (onJumpToId) {
        onJumpToId(assetId);
        return;
      }
      const k = findKeyById(assetId);
      if (!k) return;
      const rec = definitions.get(k);
      if (!rec) return;
      selectFolder(rec.folder);
      selectDefinition(k);
    },
    createNew: (className, id) => {
      if (!className || !id) return null;
      const k = createDefinitionForClass(className, id);
      if (!k) return null;
      return id;
    },
    lookupContainerType,
    getPropertyMeta,
    lookupArrayElementClass,
    getEnumMembers,
    folderForId: (assetId) => {
      const k = findKeyById(assetId);
      if (!k) return null;
      return definitions.get(k)?.folder ?? null;
    },
  }), [
    definitions, findKeyById, assetsOfClass, createDefinitionForClass,
    lookupContainerType, getPropertyMeta, lookupArrayElementClass,
    getEnumMembers, selectFolder, selectDefinition, onJumpToId,
  ]);
}
