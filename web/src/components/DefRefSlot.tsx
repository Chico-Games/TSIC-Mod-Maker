import { useMemo } from 'react';
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import { isClassCompatible, type DragSource, type DropTarget } from '../dnd/dispatch';

interface Props {
  ownerKey: string;
  path: (string | number)[];
  /** Which kind of drop target this is — affects DnD dispatch only. */
  accept: 'recipe-input' | 'recipe-output' | 'upgrade-cost' | 'loot-entry';
  /** When the underlying cell is empty, restrict the picker to this class
   *  (e.g. CraftingMaterialDefinition). When set on the cell already, the
   *  cell's class wins. */
  defaultClass?: string;
  /** Optional integer paired with the ref (count/qty). When provided,
   *  the cell shows a small input. */
  qtyPath?: (string | number)[];
  /** Optional float paired with the ref (chance, etc). */
  chancePath?: (string | number)[];
  /** Optional callback when the user wants to clear the slot (× button). */
  onRemove?: () => void;
}

export function DefRefSlot(props: Props) {
  const { ownerKey, path, accept, defaultClass, qtyPath, chancePath, onRemove } = props;
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const assetsOfClass = useDefinitionsStore((s) => s.assetsOfClass);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);

  const rec = definitions.get(ownerKey);
  let cur: any = rec?.json;
  for (const seg of path) cur = cur?.[seg as any];

  const isRef = cur && typeof cur === 'object' && cur.type === 'definition_ref';
  const refClass = isRef ? String(cur.class ?? '') : (defaultClass ?? '');
  const refValue = isRef ? String(cur.value ?? '') : '';

  const slotKey = `slot:${ownerKey}:${path.join('.')}`;

  // Class-aware drop gating: when something is being dragged, decide if
  // this slot should accept it. If not, mark the droppable disabled so
  // collision detection skips it and the user gets no `over` feedback.
  const dndCtx = useDndContext();
  const activeData = dndCtx.active?.data?.current as DragSource | undefined;
  const accepts = useMemo(() => {
    if (!activeData) return true;
    if (activeData.type === 'palette-item') {
      return isClassCompatible(activeData.class, refClass);
    }
    if (activeData.type === 'slot') {
      return isClassCompatible(activeData.class ?? '', refClass);
    }
    if (activeData.type === 'recipe-card') {
      // Recipe cards drop on station rows, not refs.
      return false;
    }
    return true;
  }, [activeData, refClass]);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${slotKey}`,
    data: { type: accept, ownerKey, path, expectedClass: refClass } satisfies DropTarget as any,
    disabled: !accepts,
  });

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag-${slotKey}`,
    data: { type: 'slot', ownerKey, path, class: refClass } as any,
    disabled: !refValue,
  });

  const targetKey = refValue ? findKeyById(refValue) : null;
  const targetRec = targetKey ? definitions.get(targetKey) : null;
  const theme = targetRec ? getFolderTheme(targetRec.folder) : { emoji: '·', color: '#9aa0a6' };

  const options = useMemo<SelectOption[]>(() => {
    if (!refClass) return [];
    return assetsOfClass(refClass).map((id) => {
      const key = findKeyById(id);
      const r = key ? definitions.get(key) : null;
      const t = r ? getFolderTheme(r.folder) : { emoji: '📦', color: '#9aa0a6' };
      return {
        value: id,
        label: `${t.emoji} ${humanizeAssetId(id)}`,
        hint: r?.folder ?? '',
        color: t.color,
      };
    });
  }, [refClass, assetsOfClass, definitions, findKeyById]);

  const setRef = (next: string) => {
    updateValueAtPath(ownerKey, path, {
      type: 'definition_ref',
      class: refClass,
      value: next,
    });
  };

  const setQty = (val: number) => {
    if (!qtyPath) return;
    // qty is typically wrapped in `{type: int, value: N}` envelope.
    let cur2: any = rec?.json;
    for (const seg of qtyPath) cur2 = cur2?.[seg as any];
    if (cur2 && typeof cur2 === 'object' && cur2.type === 'int') {
      updateValueAtPath(ownerKey, qtyPath, { ...cur2, value: val });
    } else {
      updateValueAtPath(ownerKey, qtyPath, { type: 'int', value: val });
    }
  };
  const setChance = (val: number) => {
    if (!chancePath) return;
    let cur2: any = rec?.json;
    for (const seg of chancePath) cur2 = cur2?.[seg as any];
    if (cur2 && typeof cur2 === 'object' && cur2.type === 'float') {
      updateValueAtPath(ownerKey, chancePath, { ...cur2, value: val });
    } else {
      updateValueAtPath(ownerKey, chancePath, { type: 'float', value: val });
    }
  };

  let qtyValue: number | null = null;
  if (qtyPath) {
    let cur3: any = rec?.json;
    for (const seg of qtyPath) cur3 = cur3?.[seg as any];
    qtyValue = cur3 && typeof cur3 === 'object' ? Number(cur3.value ?? 0) : null;
  }
  let chanceValue: number | null = null;
  if (chancePath) {
    let cur4: any = rec?.json;
    for (const seg of chancePath) cur4 = cur4?.[seg as any];
    chanceValue = cur4 && typeof cur4 === 'object' ? Number(cur4.value ?? 0) : null;
  }

  return (
    <div
      ref={setDropRef}
      className={`def-ref-slot ${isOver ? 'over' : ''} ${isDragging ? 'dragging' : ''} ${activeData && !accepts ? 'rejects' : ''}`}
      style={{ borderLeft: `3px solid ${theme.color}` }}
      title={refClass ? `Accepts ${refClass}` : undefined}
    >
      <span
        ref={setDragRef}
        {...listeners}
        {...attributes}
        className="def-ref-grab"
        title={refValue || 'empty slot'}
      >
        <span className="emoji" aria-hidden>{theme.emoji}</span>
      </span>
      <SearchableSelect
        value={refValue}
        options={options}
        placeholder={refClass ? `pick ${refClass}` : 'pick reference'}
        onChange={setRef}
      />
      {qtyPath && (
        <input
          className="qty-input"
          type="number"
          min={0}
          value={qtyValue ?? 0}
          onChange={(e) => setQty(Number(e.target.value || 0))}
          aria-label="quantity"
        />
      )}
      {chancePath && (
        <input
          className="qty-input"
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={chanceValue ?? 0}
          onChange={(e) => setChance(Number(e.target.value || 0))}
          aria-label="chance"
        />
      )}
      {onRemove && (
        <button className="def-ref-remove" onClick={onRemove} title="Remove">×</button>
      )}
    </div>
  );
}
