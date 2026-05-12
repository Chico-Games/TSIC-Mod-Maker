import { create } from 'zustand';

export interface ClassNode {
  name: string;
  parents: string[];
  folder: string | null;
}

export interface EnumMember {
  name: string;
  display_name?: string;
}

export interface PropertyMeta {
  tooltip: string | null;
  category: string | null;
  cpp_type: string | null;
  element_class: string | null;
  clamp_min: number | string | null;
  clamp_max: number | string | null;
  ui_min: number | string | null;
  ui_max: number | string | null;
  edit_condition: string | null;
  edit_spec: string | null;
  display_name: string | null;
  categories: string | null;
}

const PINNED_KEY = 'tsic.def.pinned-props.v1';

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function savePinned(s: Set<string>) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...s])); } catch { /* noop */ }
}

interface AppSchemaStore {
  loaded: boolean;
  errorText: string | null;
  classNodes: Map<string, ClassNode>;
  hierarchySidecar: any | null;
  propertyMeta: Map<string, PropertyMeta>;
  enumMeta: Map<string, EnumMember[]>;
  pinnedProperties: Set<string>;
  propertySchema: Map<string, { element_type?: any; key_type?: any; value_type?: any }>;
  idTemplates: Map<string, { prefix: string; suffix: string }>;

  loadSchema: (fetcher?: typeof fetch) => Promise<void>;

  getPropertyMeta: (parentTypeName: string | null | undefined, propertyName: string) => PropertyMeta | null;
  lookupContainerType: (
    path: (string | number)[],
    slot: 'element_type' | 'key_type' | 'value_type',
  ) => any | null;
  lookupArrayElementClass: (parentTypeName: string | null | undefined, propertyName: string) => string | null;
  getEnumMembers: (enumName: string | null | undefined) => EnumMember[] | null;
  folderForClass: (bareClassName: string) => string | null;
  togglePinnedProperty: (name: string) => void;
}

function bareName(c: string): string { return c.startsWith('U') ? c.slice(1) : c; }

function buildClassNodes(payload: any): Map<string, ClassNode> {
  const m = new Map<string, ClassNode>();
  if (!payload?.classes) return m;
  const classes = payload.classes;
  // Support both array format (unit tests) and object format (real UE export).
  if (Array.isArray(classes)) {
    for (const c of classes) {
      if (!c?.name) continue;
      m.set(c.name, {
        name: c.name,
        parents: Array.isArray(c.parents) ? c.parents : [],
        folder: c.folder ?? null,
      });
    }
  } else {
    for (const [name, c] of Object.entries(classes) as [string, any][]) {
      m.set(name, {
        name,
        parents: Array.isArray(c?.parents) ? c.parents : [],
        folder: c?.folder ?? null,
      });
    }
  }
  return m;
}

function buildPropertyMeta(payload: any): Map<string, PropertyMeta> {
  const m = new Map<string, PropertyMeta>();
  const props = payload?.properties ?? {};
  for (const [k, raw] of Object.entries(props)) {
    const r = raw as Partial<PropertyMeta>;
    m.set(k, {
      tooltip: r.tooltip ?? null,
      category: r.category ?? null,
      cpp_type: r.cpp_type ?? null,
      element_class: r.element_class ?? null,
      clamp_min: r.clamp_min ?? null,
      clamp_max: r.clamp_max ?? null,
      ui_min: r.ui_min ?? null,
      ui_max: r.ui_max ?? null,
      edit_condition: r.edit_condition ?? null,
      edit_spec: r.edit_spec ?? null,
      display_name: r.display_name ?? null,
      categories: r.categories ?? null,
    });
  }
  return m;
}

function buildEnumMeta(payload: any): Map<string, EnumMember[]> {
  const m = new Map<string, EnumMember[]>();
  const enums = payload?.enums ?? {};
  for (const [name, members] of Object.entries(enums)) {
    if (!Array.isArray(members)) continue;
    const bare = name.startsWith('E') ? name.slice(1) : name;
    m.set(bare, (members as any[]).map((x) => ({
      name: x.name,
      display_name: x.display_name,
    })));
  }
  return m;
}

export const useAppSchemaStore = create<AppSchemaStore>((set, get) => ({
  loaded: false,
  errorText: null,
  classNodes: new Map(),
  hierarchySidecar: null,
  propertyMeta: new Map(),
  enumMeta: new Map(),
  pinnedProperties: loadPinned(),
  propertySchema: new Map(),
  idTemplates: new Map(),

  loadSchema: async (fetcher?: typeof fetch) => {
    if (get().loaded) return;
    // Default fetch needs `this === globalThis`; bind here so the call site is
    // robust whether the caller passes a mock or not.
    const doFetch = fetcher ?? fetch.bind(globalThis);
    try {
      const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
      const hUrl = `${baseUrl}schema/class-hierarchy.json`;
      const pUrl = `${baseUrl}schema/property-meta.json`;
      const [hResp, pResp] = await Promise.all([doFetch(hUrl), doFetch(pUrl)]);
      if (!hResp.ok) throw new Error(`class-hierarchy ${hResp.status}`);
      if (!pResp.ok) throw new Error(`property-meta ${pResp.status}`);
      const hierarchy = JSON.parse(await hResp.text());
      const propertyMeta = JSON.parse(await pResp.text());
      set({
        loaded: true,
        errorText: null,
        hierarchySidecar: hierarchy,
        classNodes: buildClassNodes(hierarchy),
        propertyMeta: buildPropertyMeta(propertyMeta),
        enumMeta: buildEnumMeta(propertyMeta),
      });
    } catch (e: any) {
      set({ errorText: String(e?.message ?? e) });
      throw e;
    }
  },

  lookupContainerType: (path, slot) => {
    // Walk the path key by key (strings only — numeric indices in arrays
    // mean any element, so the recorded schema key is the parent).
    const segs = path.filter((p) => typeof p === 'string') as string[];
    const dotted = segs.join('.');
    const entry = get().propertySchema.get(dotted);
    if (!entry) return null;
    return entry[slot] ?? null;
  },

  getPropertyMeta: (parentTypeName, propertyName) => {
    if (!parentTypeName || !propertyName) return null;
    const { classNodes, propertyMeta } = get();
    const full = parentTypeName.startsWith('U') ? parentTypeName : `U${parentTypeName}`;
    const chain = [full, ...(classNodes.get(full)?.parents ?? [])].map(bareName);
    chain.push(bareName(parentTypeName));
    for (const c of chain) {
      const m = propertyMeta.get(`${c}.${propertyName}`);
      if (m) return m;
    }
    return null;
  },

  lookupArrayElementClass: (parentTypeName, propertyName) => {
    const m = get().getPropertyMeta(parentTypeName, propertyName);
    return m?.element_class ?? null;
  },

  getEnumMembers: (enumName) => {
    if (!enumName) return null;
    const bare = enumName.startsWith('E') ? enumName.slice(1) : enumName;
    return get().enumMeta.get(bare) ?? null;
  },

  folderForClass: (bareClassName) => {
    const { classNodes } = get();
    const full = bareClassName.startsWith('U') ? bareClassName : `U${bareClassName}`;
    return classNodes.get(full)?.folder ?? null;
  },

  togglePinnedProperty: (name) => set((s) => {
    const next = new Set(s.pinnedProperties);
    if (next.has(name)) next.delete(name); else next.add(name);
    savePinned(next);
    return { pinnedProperties: next };
  }),
}));
