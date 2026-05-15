import { create } from 'zustand';

export type ToastKind = 'success' | 'info' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** Optional auto-dismiss timeout (ms). null = sticky. */
  ttlMs: number | null;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useModIoToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    const toast: Toast = { id, ...t };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (toast.ttlMs != null) {
      setTimeout(() => get().dismiss(id), toast.ttlMs);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Convenience helpers used throughout the mod.io store. */
export function toastSuccess(text: string, ttlMs = 4000): number {
  return useModIoToastStore.getState().push({ kind: 'success', text, ttlMs });
}
export function toastInfo(text: string, ttlMs = 4000): number {
  return useModIoToastStore.getState().push({ kind: 'info', text, ttlMs });
}
export function toastError(text: string, ttlMs: number | null = 8000): number {
  return useModIoToastStore.getState().push({ kind: 'error', text, ttlMs });
}
