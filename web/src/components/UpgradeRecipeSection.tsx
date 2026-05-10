import { useDefinitionsStore } from '../store/definitionsStore';
import { humanizeAssetId } from './definitionsNaming';
import { RecipeCard } from './RecipeCard';

interface Props {
  /** The damageable-furniture / station record that owns the
   *  `upgrade_recipe` property. */
  hostKey: string;
  /** Optional class hint for `upgraded_furniture_definition` when
   *  minting a new upgrade — defaults to the host's own class so an
   *  empty upgrade recipe lands at "upgrades into <self>" by default. */
  upgradedTargetClass?: string;
}

/** Renders a host's `upgrade_recipe` property as a recipe card,
 *  matching the Stations sub-tab's recipe stack layout. When the
 *  property is unset (or unresolved), shows a "+ Add upgrade recipe"
 *  button that mints a fresh `UFurnitureUpgradeRecipe` asset and
 *  links it. The `arrKey` passed to RecipeCard is the host itself —
 *  upgrade recipes don't live in an ARR, so card-to-station drops are
 *  routed via the standard delete/move flows. */
export function UpgradeRecipeSection({ hostKey, upgradedTargetClass }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);

  const host = definitions.get(hostKey);
  const upgradeRef: any = host?.json?.properties?.upgrade_recipe;
  const upgradeId = upgradeRef && typeof upgradeRef === 'object' ? String(upgradeRef.value ?? '') : '';
  const upgradeKey = upgradeId ? findKeyById(upgradeId) : null;

  const onAdd = () => {
    if (!host || !hostKey) return;
    // Build a sensible new recipe id from the host's id by replacing
    // the trailing exporter tag with `_CN` (the convention for
    // FurnitureUpgradeRecipe). E.g. FD_BenchTier1_CS → RD_BenchTier1_CN.
    const stem = host.id.replace(/^FD_/, '').replace(/_[A-Z]{2,3}$/, '');
    let candidate = `RD_${stem}_CN`;
    let n = 2;
    while (findKeyById(candidate)) {
      candidate = `RD_${stem}_Copy${n}_CN`;
      n++;
    }
    const newKey = createDefinitionForClass('FurnitureUpgradeRecipe', candidate);
    if (!newKey) return;
    // Default the upgrade target to the host so the user has somewhere
    // sensible to start; the Editor / SearchableSelect lets them swap.
    if (upgradedTargetClass) {
      updateValueAtPath(newKey, ['properties', 'upgraded_furniture_definition'], {
        type: 'definition_ref',
        class: upgradedTargetClass,
        value: host.id,
      });
    }
    // Wire the host's upgrade_recipe to the new asset.
    updateValueAtPath(hostKey, ['properties', 'upgrade_recipe'], {
      type: 'definition_ref',
      class: 'FurnitureUpgradeRecipe',
      value: candidate,
    });
  };

  return (
    <div className="upgrade-recipe-section">
      <div className="upgrade-recipe-head">
        <span className="upgrade-recipe-badge">Upgrade</span>
        {upgradeId && upgradeKey && (
          <code className="muted small">{upgradeId}</code>
        )}
        {upgradeId && !upgradeKey && (
          <span className="muted small">unresolved → <code>{upgradeId}</code></span>
        )}
      </div>
      {upgradeKey ? (
        <RecipeCard recipeKey={upgradeKey} arrKey={hostKey} />
      ) : upgradeId ? (
        <div className="empty-state-mini">
          The upgrade ref doesn't resolve to a loaded asset.
        </div>
      ) : (
        <button className="add-row" onClick={onAdd}>
          ＋ Add upgrade recipe for <code>{humanizeAssetId(host?.id ?? '')}</code>
        </button>
      )}
    </div>
  );
}
