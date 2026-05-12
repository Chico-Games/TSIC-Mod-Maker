import { create } from 'zustand';

export type TagNode = {
  name: string;
  fullName: string;
  children: Record<string, TagNode>;
};

export function buildTagTree(tags: string[]): Record<string, TagNode> {
  const root: Record<string, TagNode> = {};
  for (const tag of tags) {
    const parts = tag.split('.');
    let cursor = root;
    let full = '';
    for (const part of parts) {
      full = full ? `${full}.${part}` : part;
      if (!cursor[part]) {
        cursor[part] = { name: part, fullName: full, children: {} };
      }
      cursor = cursor[part].children;
    }
  }
  return root;
}

export function isTagOrChild(candidate: string, parent: string): boolean {
  if (candidate === parent) return true;
  return candidate.startsWith(parent + '.');
}

type State = {
  tags: string[];
  tree: Record<string, TagNode>;
  loaded: boolean;
  load: (tags: string[]) => void;
};

export const useGameplayTagStore = create<State>((set) => ({
  tags: [],
  tree: {},
  loaded: false,
  load: (tags: string[]) => set({
    tags: [...tags].sort(),
    tree: buildTagTree(tags),
    loaded: true,
  }),
}));
