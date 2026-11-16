import { useEffect, useRef } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { ClassRailTab } from './classBrowser/ClassRailTab';
import { CONFIGS } from './classBrowser/configs';
import { deriveStaticPartnerId } from './classBrowser/RowWarnings';

export function ItemsTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const setToast = useDefinitionsStore((s) => s.setToast);
  const loadedAt = useDefinitionsStore((s) => s.loadedAt);

  const didAutoCreateForVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (definitions.size === 0) return;
    if (didAutoCreateForVersionRef.current === loadedAt) return;
    didAutoCreateForVersionRef.current = loadedAt;

    let minted = 0;
    let replacedBroken = 0;

    for (const [folder, cfg] of Object.entries(CONFIGS)) {
      if (!cfg.hasStaticPartner) continue;
      for (const [k, rec] of definitions) {
        if (rec.folder !== folder) continue;
        const slot = rec.json?.properties?.static_item_definition;
        if (!slot || slot.type !== 'definition_ref') continue;
        const cur = slot.value;
        const resolved = typeof cur === 'string' && cur && findKeyById(cur);
        if (resolved) continue;

        // Mint a new partner.
        let baseId = deriveStaticPartnerId(rec.id);
        let id = baseId;
        let n = 2;
        while (findKeyById(id)) id = `${baseId}_${n++}`;
        const newKey = createDefinitionForClass('StaticItemDefinition', id);
        if (!newKey) continue;
        updateValueAtPath(k, ['properties', 'static_item_definition'], {
          type: 'definition_ref', class: 'StaticItemDefinition', value: id,
        });
        minted++;
        if (typeof cur === 'string' && cur.length > 0) replacedBroken++;
      }
    }
    if (minted > 0) {
      const suffix = replacedBroken > 0 ? ` (${replacedBroken} replacing broken refs)` : '';
      setToast({ kind: 'info', text: `Created ${minted} missing static-item partners${suffix}` });
    }
  }, [definitions, loadedAt, findKeyById, createDefinitionForClass, updateValueAtPath, setToast]);

  return <ClassRailTab home="items" />;
}
