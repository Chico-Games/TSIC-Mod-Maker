import { useEffect, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { humanizeAssetId } from './definitionsNaming';

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
 *  In display mode the title shows the asset's `display_name` property
 *  if set, falling back to the humanized id stem (e.g. "BenchTier2").
 *  Click the title to switch to edit mode — the input pre-fills with
 *  the BARE id stem, and on commit `renameAsset` is called. The store
 *  rebuilds the full prefix_stem_suffix form using the per-class id
 *  template; the underlying file is renamed on the next Save.
 *
 *  Editing the display_name uses the standard typed editor in the
 *  Definitions tab — this title only handles the id-stem rename so
 *  the user can change the on-disk filename without leaving the
 *  Stations / Furniture / Enemies / Loot pane. */
export function AssetTitle({ assetKey, onRenamed }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const renameAsset = useDefinitionsStore((s) => s.renameAsset);

  const rec = definitions.get(assetKey);
  const stem = rec ? humanizeAssetId(rec.id) : '';
  const displayName = rec ? readDisplayName(rec.json, stem) : '';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stem);

  useEffect(() => {
    setDraft(stem);
    setEditing(false);
  }, [stem, assetKey]);

  if (!rec) return null;

  if (!editing) {
    return (
      <h2
        className="asset-title"
        onClick={() => setEditing(true)}
        title={`Click to rename — current id: ${rec.id}`}
      >
        {displayName}
      </h2>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === stem) {
      setDraft(stem);
      return;
    }
    const newKey = renameAsset(assetKey, trimmed);
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
          setDraft(stem);
          setEditing(false);
        }
      }}
      title={`Rename — full id rebuilt as <prefix>${draft}<suffix> on save`}
    />
  );
}

function readDisplayName(json: any, fallback: string): string {
  const dn = json?.properties?.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) return dn.value;
  return fallback;
}
