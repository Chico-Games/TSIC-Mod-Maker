import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';

const DEFAULT_ITEM_FOLDERS = [
  'consumable_definitions',
  'crafting_material_definitions',
  'constructable_item_definitions',
  'ammo_definitions',
  'seed_item_definitions',
  'static_item_definitions',
  'equippable_definitions',
  'glove_definitions',
  'trap_item_definitions',
];

interface Props {
  /** Folders to show in the palette by default. */
  folders?: string[];
  /** Title above the palette. */
  title?: string;
}

export function ItemPalette({ folders, title }: Props) {
  const allFolders = useDefinitionsStore((s) => s.folders);
  const definitions = useDefinitionsStore((s) => s.definitions);

  const [filter, setFilter] = useState('');
  // Folder pick: persist between renders. Default to the prop folders that exist.
  const initialFolders = useMemo(() => {
    const seed = (folders ?? DEFAULT_ITEM_FOLDERS).filter((f) => allFolders.includes(f));
    return new Set(seed.length ? seed : allFolders);
  }, [folders, allFolders]);
  const [enabled, setEnabled] = useState<Set<string>>(initialFolders);

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out: { id: string; folder: string; class: string }[] = [];
    for (const rec of definitions.values()) {
      if (!enabled.has(rec.folder)) continue;
      if (q && !rec.id.toLowerCase().includes(q) && !humanizeAssetId(rec.id).toLowerCase().includes(q)) continue;
      out.push({ id: rec.id, folder: rec.folder, class: String(rec.json?.class ?? '').replace(/^U/, '') });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [definitions, enabled, filter]);

  const toggleFolder = (f: string) => {
    setEnabled((cur) => {
      const next = new Set(cur);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  return (
    <div className="item-palette">
      <div className="palette-header">
        <h3>{title ?? 'Items'}</h3>
        <input
          type="text"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="palette-folders">
        {(folders ?? DEFAULT_ITEM_FOLDERS).filter((f) => allFolders.includes(f)).map((f) => {
          const t = getFolderTheme(f);
          const on = enabled.has(f);
          return (
            <button
              key={f}
              className={`folder-chip ${on ? 'on' : ''}`}
              onClick={() => toggleFolder(f)}
              title={f}
              style={on ? { borderColor: t.color, color: t.color } : undefined}
            >
              <span aria-hidden>{t.emoji}</span>
              {f.replace(/_definitions?$/, '')}
            </button>
          );
        })}
      </div>
      <div className="palette-list">
        {items.slice(0, 200).map((it) => (
          <PaletteItem key={`${it.folder}/${it.id}`} id={it.id} folder={it.folder} cls={it.class} />
        ))}
        {items.length > 200 && (
          <div className="palette-more">+{items.length - 200} more — refine filter</div>
        )}
      </div>
    </div>
  );
}

function PaletteItem({ id, folder, cls }: { id: string; folder: string; cls: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${folder}/${id}`,
    data: { type: 'palette-item', class: cls, value: id } as any,
  });
  const t = getFolderTheme(folder);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`palette-item ${isDragging ? 'dragging' : ''}`}
      style={{ borderLeft: `3px solid ${t.color}` }}
      title={`${id} · ${cls}`}
    >
      <span className="emoji" aria-hidden>{t.emoji}</span>
      <span className="label">{humanizeAssetId(id)}</span>
      <span className="cls" style={{ color: t.color }}>{cls}</span>
    </div>
  );
}
