import { create } from 'zustand';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

type State = {
  selectedLayoutKey: string | null;
  selectedIndices: number[];
  gizmoMode: GizmoMode;
  seed: number;
  /** When empty, the resolver should use the layout's own gameplay_tags. */
  tileTagsOverride: string[];
  setLayout: (key: string | null) => void;
  setSelection: (indices: number[]) => void;
  toggleSelection: (index: number) => void;
  extendSelection: (toIndex: number) => void;
  clearSelection: () => void;
  setGizmoMode: (m: GizmoMode) => void;
  setSeed: (n: number) => void;
  rerollSeed: () => void;
  setTileTagsOverride: (t: string[]) => void;
};

export const useLayoutEditorStore = create<State>((set, get) => ({
  selectedLayoutKey: null,
  selectedIndices: [],
  gizmoMode: 'translate',
  seed: -1,
  tileTagsOverride: [],

  setLayout: (key) => set({ selectedLayoutKey: key, selectedIndices: [] }),
  setSelection: (indices) => set({ selectedIndices: indices }),
  toggleSelection: (i) => {
    const cur = get().selectedIndices;
    set({ selectedIndices: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] });
  },
  extendSelection: (toIndex) => {
    const cur = get().selectedIndices;
    if (cur.length === 0) { set({ selectedIndices: [toIndex] }); return; }
    const last = cur[cur.length - 1];
    const lo = Math.min(last, toIndex), hi = Math.max(last, toIndex);
    const range: number[] = [];
    for (let i = lo; i <= hi; i++) range.push(i);
    set({ selectedIndices: range });
  },
  clearSelection: () => set({ selectedIndices: [] }),
  setGizmoMode: (m) => set({ gizmoMode: m }),
  setSeed: (n) => set({ seed: n | 0 }),
  rerollSeed: () => set((s) => ({ seed: (s.seed === -1 ? 0 : s.seed) + 1 })),
  setTileTagsOverride: (t) => set({ tileTagsOverride: t }),
}));
