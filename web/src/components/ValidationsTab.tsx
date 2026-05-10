import { useMemo } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { getFolderTheme } from './folderTheme';

interface Issue {
  severity: 'error' | 'warning';
  category: string;
  detail: string;
  jumpKey?: string;
}

const STATION_FOLDERS = new Set([
  'crafting_station_definitions',
  'production_station_definitions',
  'plantable_definitions',
]);
const RECIPE_FOLDERS = new Set([
  'craft_recipe_definitions',
  'plant_recipe_definitions',
  'furniture_upgrade_recipe',
]);

export function ValidationsTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const findOrphanReferences = useDefinitionsStore((s) => s.findOrphanReferences);
  const findItemStaticOrphans = useDefinitionsStore((s) => s.findItemStaticOrphans);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);

  const issues = useMemo<Issue[]>(() => {
    const out: Issue[] = [];

    // 1) Orphan refs.
    for (const o of findOrphanReferences()) {
      out.push({
        severity: 'error',
        category: 'orphan ref',
        detail: `${o.id} → ${o.refValue} (${o.refPath}) does not resolve`,
        jumpKey: o.key,
      });
    }
    // 2) Item↔StaticItem partners.
    for (const o of findItemStaticOrphans()) {
      out.push({
        severity: 'warning',
        category: 'item↔static',
        detail: `${o.id}: ${o.detail}`,
        jumpKey: o.key,
      });
    }

    // Build ARR usage index (which stations point at which ARRs).
    const arrUsedBy = new Map<string, string[]>();
    for (const rec of definitions.values()) {
      if (!STATION_FOLDERS.has(rec.folder)) continue;
      const r = rec.json?.properties?.available_recipe_rules_definition;
      const v = r && typeof r === 'object' ? String(r.value ?? '') : '';
      if (!v) {
        out.push({
          severity: 'warning',
          category: 'station has no ARR',
          detail: `${rec.id} has no available_recipe_rules_definition`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
        continue;
      }
      const k = findKeyById(v);
      if (!k) {
        out.push({
          severity: 'error',
          category: 'station ARR missing',
          detail: `${rec.id} → ${v} (ARR not loaded)`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
        continue;
      }
      const list = arrUsedBy.get(v) ?? [];
      list.push(rec.id);
      arrUsedBy.set(v, list);
    }
    // 3) ARRs not referenced by any station.
    for (const rec of definitions.values()) {
      if (rec.folder !== 'available_recipe_rules_definitions') continue;
      if (!arrUsedBy.has(rec.id)) {
        out.push({
          severity: 'warning',
          category: 'orphan ARR',
          detail: `${rec.id} is not referenced by any station`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
      }
      // 4) Empty ARR.
      const arr: any = rec.json?.properties?.production_machine_rules?.value?.recipes;
      const count = arr?.type === 'array' && Array.isArray(arr.value) ? arr.value.length : 0;
      if (count === 0) {
        out.push({
          severity: 'warning',
          category: 'empty ARR',
          detail: `${rec.id} has no recipes`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
      }
    }

    // 5) Recipes with empty input or output map.
    for (const rec of definitions.values()) {
      if (!RECIPE_FOLDERS.has(rec.folder)) continue;
      const cls = String(rec.json?.class ?? '');
      const inputs: any = rec.json?.properties?.input;
      const outputs: any = rec.json?.properties?.output;
      const inputCount = inputs?.type === 'map' && Array.isArray(inputs.value) ? inputs.value.length : 0;
      const outputCount = outputs?.type === 'map' && Array.isArray(outputs.value) ? outputs.value.length : 0;
      if (inputCount === 0) {
        out.push({
          severity: 'warning',
          category: 'recipe has no inputs',
          detail: `${rec.id}`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
      }
      // FurnitureUpgradeRecipe is allowed to have an empty output map (output
      // is conveyed via upgraded_furniture_definition).
      if (outputCount === 0 && cls !== 'UFurnitureUpgradeRecipe') {
        out.push({
          severity: 'warning',
          category: 'recipe has no outputs',
          detail: `${rec.id}`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
      }
      // 6) FurnitureUpgradeRecipe.upgraded_furniture_definition must resolve.
      if (cls === 'UFurnitureUpgradeRecipe') {
        const ref: any = rec.json?.properties?.upgraded_furniture_definition;
        const v = ref && typeof ref === 'object' ? String(ref.value ?? '') : '';
        if (!v) {
          out.push({
            severity: 'warning',
            category: 'upgrade missing target',
            detail: `${rec.id} has no upgraded_furniture_definition`,
            jumpKey: `${rec.folder}/${rec.id}`,
          });
        } else if (!findKeyById(v)) {
          out.push({
            severity: 'error',
            category: 'upgrade target missing',
            detail: `${rec.id} → ${v} not loaded`,
            jumpKey: `${rec.folder}/${rec.id}`,
          });
        }
      }
    }

    // 7) Loot tables not referenced anywhere.
    const lootRefs = new Set<string>();
    for (const rec of definitions.values()) {
      // walk for ref where class is LootDefinition.
      const walk = (v: any) => {
        if (!v || typeof v !== 'object') return;
        if (v.type === 'definition_ref' && v.class === 'LootDefinition' && typeof v.value === 'string' && v.value) {
          lootRefs.add(v.value);
          return;
        }
        if (Array.isArray(v)) {
          for (const e of v) walk(e);
          return;
        }
        for (const k of Object.keys(v)) walk(v[k]);
      };
      walk(rec.json?.properties);
    }
    for (const rec of definitions.values()) {
      if (rec.folder !== 'loot_definitions') continue;
      if (!lootRefs.has(rec.id)) {
        out.push({
          severity: 'warning',
          category: 'orphan loot',
          detail: `${rec.id} is not referenced by anything`,
          jumpKey: `${rec.folder}/${rec.id}`,
        });
      }
    }

    return out;
  }, [definitions, findKeyById, findOrphanReferences, findItemStaticOrphans]);

  const grouped = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) {
      const a = m.get(i.category);
      if (a) a.push(i);
      else m.set(i.category, [i]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [issues]);

  const onJump = (k: string) => {
    const parts = k.split('/');
    if (parts.length < 2) return;
    const folder = parts[0];
    selectFolder(folder);
    selectDefinition(k);
    setTab('definitions');
  };

  return (
    <div className="validations-layout">
      <header className="station-header">
        <div className="station-title">
          <span aria-hidden>🩺</span>
          <h2>Validations</h2>
          <span className="cls">{issues.length} issue{issues.length === 1 ? '' : 's'}</span>
        </div>
      </header>
      {grouped.length === 0 && (
        <div className="empty-state-mini">No issues found. ✨</div>
      )}
      {grouped.map(([category, list]) => (
        <section key={category} className="val-group">
          <h3>{category} <span className="muted">({list.length})</span></h3>
          <ul className="val-list">
            {list.map((i, n) => {
              const folderName = i.jumpKey ? i.jumpKey.split('/')[0] : '';
              const t = folderName ? getFolderTheme(folderName) : { emoji: '·', color: '#9aa0a6' };
              return (
                <li key={n} className={`val-row val-${i.severity}`}>
                  <span className="emoji" aria-hidden>{t.emoji}</span>
                  <span className="detail">{i.detail}</span>
                  {i.jumpKey && (
                    <button onClick={() => onJump(i.jumpKey!)} className="link">Open</button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
