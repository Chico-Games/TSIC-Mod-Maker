import { useEffect, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { humanizeAssetId, unhumanizeAssetId } from './definitionsNaming';

interface Props {
  /** Storage key (folder/id) of the record to rename. */
  assetKey: string;
  /** Optional callback when the rename completes. The new key
   *  (folder/id) is passed so the parent can re-target any local
   *  selection state — without this the previous selection becomes
   *  stale because renameAsset deletes the old map entry. */
  onRenamed?: (newKey: string) => void;
}

/** Editable asset title.
 *
 *  Display: humanizeAssetId(rec.id) — the under-the-hood id is
 *  prefix_CamelCase_suffix; the visible label strips the prefix /
 *  suffix and inserts spaces at camelCase / digit boundaries.
 *
 *  Edit: click → text input pre-filled with the same humanized
 *  display. The user can type with or without spaces; on commit the
 *  whitespace is stripped (`"Bench Tier 2"` → `"BenchTier2"`) and
 *  passed to `renameAsset`, which rebuilds the full
 *  `<prefix><stem><suffix>` form using the per-class id template.
 *
 *  Always reads from the asset's id, NOT its `display_name` property —
 *  so renames update the title on the next render. The `display_name`
 *  is a separate, localizable field edited in the typed editor. */
export function AssetTitle({ assetKey, onRenamed }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const renameAsset = useDefinitionsStore((s) => s.renameAsset);

  const rec = definitions.get(assetKey);
  const displayLabel = rec ? humanizeAssetId(rec.id) : '';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayLabel);

  useEffect(() => {
    setDraft(displayLabel);
    setEditing(false);
  }, [displayLabel, assetKey]);

  if (!rec) return null;

  if (!editing) {
    return (
      <h2
        className="asset-title"
        onClick={() => setEditing(true)}
        title={`Click to rename — current id: ${rec.id}`}
      >
        {displayLabel}
      </h2>
    );
  }

  const commit = () => {
    const stem = unhumanizeAssetId(draft).trim();
    setEditing(false);
    if (!stem) {
      setDraft(displayLabel);
      return;
    }
    // No-op when the typed stem matches what's already on disk.
    const currentStem = unhumanizeAssetId(displayLabel);
    if (stem === currentStem) {
      setDraft(displayLabel);
      return;
    }
    const newKey = renameAsset(assetKey, stem);
    if (newKey && newKey !== assetKey) onRenamed?.(newKey);
  };

  return (
    <input
      className="asset-title-input"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') {
          setDraft(displayLabel);
          setEditing(false);
        }
      }}
      title={`Spaces are visual only — saved as "${unhumanizeAssetId(draft)}" with the class prefix/suffix re-applied.`}
    />
  );
}
