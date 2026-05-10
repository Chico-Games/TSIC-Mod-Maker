import { useAppStore, type RecipesSubTab } from '../store/appStore';
import { StationsSubTab } from './StationsSubTab';
import { FurnitureSubTab } from './FurnitureSubTab';
import { TechTreeSubTab } from './TechTreeSubTab';
import { EnemiesSubTab } from './EnemiesSubTab';
import { BiomeSubTab } from './BiomeSubTab';

const SUB_TABS: Array<{ id: RecipesSubTab; label: string; emoji: string }> = [
  { id: 'stations', label: 'Stations', emoji: '🛠️' },
  { id: 'furniture', label: 'Furniture', emoji: '🪑' },
  { id: 'tech-tree', label: 'Tech Tree', emoji: '🌳' },
  { id: 'enemies', label: 'Enemies', emoji: '👹' },
  { id: 'biome', label: 'Biome', emoji: '✨' },
];

export function RecipesAndLootTab() {
  const sub = useAppStore((s) => s.recipesSubTab);
  const setSub = useAppStore((s) => s.setRecipesSubTab);

  return (
    <div className="recipes-loot-layout">
      <div className="subtab-strip">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            className={`subtab ${sub === t.id ? 'active' : ''}`}
            onClick={() => setSub(t.id)}
          >
            <span aria-hidden>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>
      <div className="subtab-body">
        {sub === 'stations' && <StationsSubTab />}
        {sub === 'furniture' && <FurnitureSubTab />}
        {sub === 'tech-tree' && <TechTreeSubTab />}
        {sub === 'enemies' && <EnemiesSubTab />}
        {sub === 'biome' && <BiomeSubTab />}
      </div>
    </div>
  );
}
