import { create } from 'zustand';
import { configFromEnv, loadModioConfig, switchEnv, type ModioConfig } from '../modio/config';
import { createClient, type ModioClient } from '../modio/client';
import {
  addDependencies,
  addMod,
  addModfile,
  deleteDependencies,
  editMod,
  editModfile,
  emailExchange,
  emailRequest,
  getGameTags,
  getMe,
  getMod,
  getModByNameId,
  getMyMods,
  listDependencies,
  listMods,
  listModEvents,
  listModfiles,
  logout,
} from '../modio/endpoints';
import { parseModioRef } from '../modio/parseRef';
import { normalizeLogoFile, validatePublish, type PublishIssue } from '../modio/validation';
import { toastError, toastInfo, toastSuccess } from './modIoToastStore';
import { ModioError } from '../modio/errors';
import { buildDeltaZip, defaultCatalogFromLoaded, type PackedMod, type StarterCatalog } from '../modio/packer';
import { readZipAsync } from '../modio/zip';
import { emptySidecar, readLogo, readSidecar, writeLogo, writeSidecar } from '../modio/sidecar';
import { InMemoryDataSource } from '../modio/inMemoryDataSource';
import { useDefinitionsStore } from './definitionsStore';
import type {
  ModioDependency,
  ModioEnv,
  ModioGameTagOption,
  ModioMod,
  ModioModEvent,
  ModioModfile,
  ModioSidecar,
  ModioSyncState,
  ModioUser,
} from '../modio/types';

const TOKEN_KEY = 'tsic.modio.token.v1';

interface StoredToken {
  token: string;
  expiresAt: number;
  env: ModioEnv;
  persistent: boolean;
}

function loadStoredToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.token || !parsed.expiresAt) return null;
    if (parsed.expiresAt * 1000 < Date.now()) return null;
    return parsed;
  } catch { return null; }
}

function writeStoredToken(t: StoredToken | null): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (!t) return;
    const target = t.persistent ? localStorage : sessionStorage;
    target.setItem(TOKEN_KEY, JSON.stringify(t));
  } catch { /* noop */ }
}

export type PublishWizardStep = 'bind' | 'meta' | 'modfile' | 'done';
export type WizardOpenReason = 'publish' | 'bind' | null;

export interface ModIoStore {
  cfg: ModioConfig | null;
  client: ModioClient | null;
  // auth
  token: string | null;
  tokenExpiresAt: number | null;
  user: ModioUser | null;
  authBusy: 'idle' | 'requesting' | 'exchanging' | 'signing-out';
  emailFlow: { email: string | null; step: 'idle' | 'awaiting-code' | 'done' };
  // sidecar + remote
  sidecar: ModioSidecar | null;
  remoteMod: ModioMod | null;
  gameTagOptions: ModioGameTagOption[] | null;
  // pack / sync
  starterCatalog: StarterCatalog | null;
  lastPack: PackedMod | null;
  syncState: ModioSyncState;
  // browse listing
  listing: {
    mods: ModioMod[];
    query: string;
    sort: string;
    /** Either 'public' (GET /games/{id}/mods) or 'mine' (GET /me/mods). */
    scope: 'public' | 'mine';
    /** AND-tags filter (comma-joined when sent). */
    tagsAnd: string[];
    /** OR-tags filter. */
    tagsOr: string[];
    /** Offset of the NEXT page to fetch (i.e. mods.length once paging is in
     *  flight). Always reflects what we'd ask the server for via `loadMore`. */
    nextOffset: number;
    pageSize: number;
    total: number;
    loading: boolean;
    /** True once we've fetched the last page (nextOffset >= total). */
    exhausted: boolean;
  } | null;
  // Selected mod in the browse dialog (for the detail panel).
  selectedMod: ModioMod | null;
  selectedModfiles: ModioModfile[] | null;
  selectedDependencies: ModioDependency[] | null;
  selectedLoading: boolean;
  // Events polling (for the bound mod, while the publish wizard is open).
  lastRemoteEvent: ModioModEvent | null;
  // ui
  signInModalOpen: boolean;
  publishWizardOpen: boolean;
  publishWizardStep: PublishWizardStep;
  browseDialogOpen: boolean;
  busy: 'idle' | 'packing' | 'uploading' | 'fetching' | 'opening';
  lastError: { http: number; ref?: number; message: string } | null;
  // actions
  bootstrap: () => Promise<void>;
  signInRequest: (email: string) => Promise<void>;
  signInExchange: (code: string, persistent: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  setEnv: (env: ModioEnv) => void;
  // sidecar
  loadSidecar: () => Promise<void>;
  setDraft: (patch: Partial<ModioSidecar['draft']>) => Promise<void>;
  bindToMod: (modId: number) => Promise<void>;
  unbindFromMod: () => Promise<void>;
  saveLogoFromFile: (file: File) => Promise<void>;
  // remote
  refreshRemoteMod: () => Promise<void>;
  ensureGameTags: () => Promise<void>;
  // pack
  packCurrent: () => Promise<void>;
  // publish
  createMod: () => Promise<void>;
  pushMetadata: () => Promise<void>;
  pushModfile: (args: { version: string; changelog: string; active: boolean }) => Promise<void>;
  // browse
  openBrowse: () => void;
  closeBrowse: () => void;
  /** Reset the listing and fetch the first page. */
  searchBrowse: (args?: { q?: string; sort?: string; pageSize?: number; scope?: 'public' | 'mine'; tagsAnd?: string[]; tagsOr?: string[] }) => Promise<void>;
  /** Fetch the next page (infinite-scroll). No-op when loading or exhausted. */
  loadMoreBrowse: () => Promise<void>;
  /** Resolve a pasted reference (URL / slug / numeric id) → fetch the Mod
   *  and open it as a project. Throws via lastError on failure. */
  openModByRef: (input: string) => Promise<void>;
  openModAsProject: (mod: ModioMod) => Promise<void>;
  // mod detail panel
  selectMod: (mod: ModioMod | null) => Promise<void>;
  // dependencies (acting on the currently-bound mod)
  addModDependency: (modId: number) => Promise<void>;
  removeModDependency: (modId: number) => Promise<void>;
  refreshDependencies: () => Promise<void>;
  // modfile history + promotion
  refreshModfileHistory: () => Promise<void>;
  promoteModfile: (fileId: number) => Promise<void>;
  // events polling
  pollRemoteEvents: () => Promise<void>;
  // pure validation pass for UI
  publishIssues: (args: { willPushModfile: boolean; pendingVersion?: string }) => PublishIssue[];
  // ui flags
  openSignInModal: () => void;
  closeSignInModal: () => void;
  openPublishWizard: (step?: PublishWizardStep) => void;
  closePublishWizard: () => void;
  setPublishStep: (step: PublishWizardStep) => void;
  clearError: () => void;
}

function deriveSyncState(s: { sidecar: ModioSidecar | null; remoteMod: ModioMod | null; lastPack: PackedMod | null; }): ModioSyncState {
  const sc = s.sidecar;
  if (!sc || sc.mod_id == null) return 'unbound';
  const lp = sc.last_pushed;
  const localMd5 = s.lastPack?.md5;
  const remoteMd5 = s.remoteMod?.modfile?.filehash.md5;
  if (!lp || !localMd5) return 'unknown';
  const localMatch = localMd5 === lp.md5;
  const remoteMatch = !remoteMd5 || remoteMd5 === lp.md5;
  if (localMatch && remoteMatch) return 'clean';
  if (!localMatch && remoteMatch) return 'local-newer';
  if (localMatch && !remoteMatch) return 'remote-newer';
  return 'diverged';
}

function toFriendlyError(e: unknown): { http: number; ref?: number; message: string } {
  if (e instanceof ModioError) return { http: e.http, ref: e.errorRef, message: e.friendly };
  return { http: 0, message: (e as Error)?.message ?? String(e) };
}

export const useModIoStore = create<ModIoStore>((set, get) => {
  let _client: ModioClient | null = null;

  function tokenGetter(): string | null { return get().token; }

  function rebuildClient(cfg: ModioConfig | null): void {
    if (!cfg) { _client = null; set({ client: null }); return; }
    _client = createClient(cfg, tokenGetter);
    set({ client: _client });
  }

  const initialCfg = loadModioConfig();
  if (initialCfg) {
    const stored = loadStoredToken();
    const env: ModioEnv = stored?.env ?? initialCfg.env;
    const cfg = switchEnv(initialCfg, env);
    rebuildClient(cfg);
    return {
      cfg,
      client: _client,
      token: stored?.token ?? null,
      tokenExpiresAt: stored?.expiresAt ?? null,
      user: null,
      authBusy: 'idle',
      emailFlow: { email: null, step: 'idle' },
      sidecar: null,
      remoteMod: null,
      gameTagOptions: null,
      starterCatalog: null,
      lastPack: null,
      syncState: 'unbound',
      listing: null,
      selectedMod: null,
      selectedModfiles: null,
      selectedDependencies: null,
      selectedLoading: false,
      lastRemoteEvent: null,
      signInModalOpen: false,
      publishWizardOpen: false,
      publishWizardStep: 'bind',
      browseDialogOpen: false,
      busy: 'idle',
      lastError: null,
      ...buildActions(set, get, rebuildClient),
    };
  }
  return {
    cfg: null,
    client: null,
    token: null,
    tokenExpiresAt: null,
    user: null,
    authBusy: 'idle',
    emailFlow: { email: null, step: 'idle' },
    sidecar: null,
    remoteMod: null,
    gameTagOptions: null,
    starterCatalog: null,
    lastPack: null,
    syncState: 'unbound',
    listing: null,
    selectedMod: null,
    selectedModfiles: null,
    selectedDependencies: null,
    selectedLoading: false,
    lastRemoteEvent: null,
    signInModalOpen: false,
    publishWizardOpen: false,
    publishWizardStep: 'bind',
    browseDialogOpen: false,
    busy: 'idle',
    lastError: null,
    ...buildActions(set, get, rebuildClient),
  };
});

function buildActions(
  set: (s: Partial<ModIoStore> | ((s: ModIoStore) => Partial<ModIoStore>)) => void,
  get: () => ModIoStore,
  rebuildClient: (cfg: ModioConfig | null) => void,
) {
  function requireClient(): ModioClient {
    const c = get().client;
    if (!c) throw new Error('mod.io is not configured (missing VITE_MODIO_GAME_ID / VITE_MODIO_API_KEY).');
    return c;
  }

  async function probeMe(): Promise<void> {
    const client = get().client;
    const token = get().token;
    if (!client || !token) return;
    try {
      const user = await getMe(client);
      set({ user });
    } catch (e) {
      if (e instanceof ModioError && e.isAuthFailure) {
        writeStoredToken(null);
        set({ token: null, tokenExpiresAt: null, user: null });
      } else {
        set({ lastError: toFriendlyError(e) });
      }
    }
  }

  function recomputeSync(): void {
    const s = get();
    set({ syncState: deriveSyncState(s) });
  }

  return {
    async bootstrap() {
      // 1. Probe stored token.
      await probeMe();
      // 2. Try to load sidecar for the current data source.
      await get().loadSidecar();
      // 3. Lazily build the starter catalog from the already-loaded DefaultProject.
      const cfg = get().cfg;
      if (cfg && !get().starterCatalog) {
        try {
          const def = useDefinitionsStore.getState().defaultProject
            ?? (await (async () => {
              await useDefinitionsStore.getState().loadDefaultProject();
              return useDefinitionsStore.getState().defaultProject;
            })());
          if (!def) throw new Error('Default project not available');
          const cat = defaultCatalogFromLoaded(def);
          set({ starterCatalog: cat });
        } catch (e) {
          console.warn('[modio] starter catalog load failed', e);
        }
      }
    },

    async signInRequest(email: string) {
      try {
        set({ authBusy: 'requesting', lastError: null });
        await emailRequest(requireClient(), { email });
        set({ emailFlow: { email, step: 'awaiting-code' } });
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      } finally {
        set({ authBusy: 'idle' });
      }
    },

    async signInExchange(code: string, persistent: boolean) {
      try {
        set({ authBusy: 'exchanging', lastError: null });
        const r = await emailExchange(requireClient(), { code });
        const env = get().cfg?.env ?? 'live';
        writeStoredToken({ token: r.access_token, expiresAt: r.date_expires, env, persistent });
        set({ token: r.access_token, tokenExpiresAt: r.date_expires, emailFlow: { email: get().emailFlow.email, step: 'done' }, signInModalOpen: false });
        await probeMe();
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      } finally {
        set({ authBusy: 'idle' });
      }
    },

    async signOut() {
      try {
        set({ authBusy: 'signing-out' });
        try { await logout(requireClient()); } catch { /* ignore */ }
      } finally {
        writeStoredToken(null);
        set({
          token: null,
          tokenExpiresAt: null,
          user: null,
          authBusy: 'idle',
          emailFlow: { email: null, step: 'idle' },
        });
      }
    },

    setEnv(env: ModioEnv) {
      const cur = get().cfg;
      if (!cur) return;
      const next = switchEnv(cur, env);
      rebuildClient(next);
      set({ cfg: next });
      // Signed-in token was issued in the previous env — drop it.
      writeStoredToken(null);
      set({ token: null, tokenExpiresAt: null, user: null });
    },

    async loadSidecar() {
      const ds = useDefinitionsStore.getState().dataSource;
      const sc = await readSidecar(ds);
      set({ sidecar: sc, remoteMod: null });
      if (sc?.mod_id != null) {
        // Best-effort fetch the remote mod (browse uses api_key, no auth required).
        try { await get().refreshRemoteMod(); } catch { /* noop */ }
      }
      recomputeSync();
    },

    async setDraft(patch) {
      const cur = get().sidecar ?? emptySidecar(get().cfg?.env ?? 'live');
      const next: ModioSidecar = { ...cur, draft: { ...cur.draft, ...patch } };
      set({ sidecar: next });
      try {
        await writeSidecar(useDefinitionsStore.getState().dataSource, next);
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      }
    },

    async bindToMod(modId: number) {
      try {
        const client = requireClient();
        const mod = await getMod(client, modId);
        const cur = get().sidecar ?? emptySidecar(get().cfg?.env ?? 'live');
        const next: ModioSidecar = {
          ...cur,
          mod_id: mod.id,
          name_id: mod.name_id,
          draft: {
            ...cur.draft,
            name: mod.name,
            summary: mod.summary,
            description_md: mod.description ?? null,
            tags: mod.tags.map((t) => t.name),
            visible: mod.visible,
            next_version: cur.draft.next_version || '0.1.0',
          },
        };
        set({ sidecar: next, remoteMod: mod });
        await writeSidecar(useDefinitionsStore.getState().dataSource, next);
        recomputeSync();
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
        throw e;
      }
    },

    async unbindFromMod() {
      const cur = get().sidecar;
      if (!cur) return;
      const next: ModioSidecar = { ...cur, mod_id: null, name_id: null, last_pushed: null };
      set({ sidecar: next, remoteMod: null });
      try { await writeSidecar(useDefinitionsStore.getState().dataSource, next); } catch (e) { set({ lastError: toFriendlyError(e) }); }
      recomputeSync();
    },

    async saveLogoFromFile(file: File) {
      const ds = useDefinitionsStore.getState().dataSource;
      try {
        // Auto-upscale to ≥512×288 if needed; otherwise pass through.
        const { blob, width, height, resized } = await normalizeLogoFile(file);
        const ext = resized ? 'png' : (() => {
          const m = file.type.match(/image\/(png|jpe?g|gif)/);
          if (m) return m[1].replace('jpeg', 'jpg');
          const dot = file.name.lastIndexOf('.');
          if (dot > 0) return file.name.slice(dot + 1).toLowerCase();
          return 'png';
        })();
        const path = await writeLogo(ds, blob, ext);
        await get().setDraft({ logo_path: path });
        if (resized) toastInfo(`Logo upscaled to ${width}×${height} (mod.io needs ≥512×288).`);
        else toastSuccess(`Logo saved (${width}×${height}).`);
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
        toastError(toFriendlyError(e).message);
      }
    },

    async refreshRemoteMod() {
      const sc = get().sidecar;
      if (!sc?.mod_id) return;
      try {
        const mod = await getMod(requireClient(), sc.mod_id);
        set({ remoteMod: mod });
        recomputeSync();
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      }
    },

    async ensureGameTags() {
      if (get().gameTagOptions) return;
      try {
        const r = await getGameTags(requireClient());
        set({ gameTagOptions: r.data });
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      }
    },

    async packCurrent() {
      try {
        set({ busy: 'packing', lastError: null });
        const cat = get().starterCatalog;
        if (!cat) {
          // Lazy build from in-memory DefaultProject.
          const def = useDefinitionsStore.getState().defaultProject
            ?? (await (async () => {
              // Should be loaded already at bootstrap, but tolerate not-yet-loaded by triggering a load.
              await useDefinitionsStore.getState().loadDefaultProject();
              return useDefinitionsStore.getState().defaultProject;
            })());
          if (!def) throw new Error('Default project not available');
          const fresh = defaultCatalogFromLoaded(def);
          set({ starterCatalog: fresh });
        }
        const starter = get().starterCatalog ?? new Map();
        const defs = useDefinitionsStore.getState().definitions;
        const editorVersion = '0.2.0';
        const pack = await buildDeltaZip(defs.values(), starter, { editorVersion, baseSource: 'default-project' });
        set({ lastPack: pack });
        recomputeSync();
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      } finally {
        set({ busy: 'idle' });
      }
    },

    async createMod() {
      const sc = get().sidecar;
      if (!sc) throw new Error('No project bound.');
      if (sc.mod_id != null) throw new Error('Mod already bound.');
      const ds = useDefinitionsStore.getState().dataSource;
      const logo = sc.draft.logo_path ? await readLogo(ds, sc.draft.logo_path) : null;
      if (!logo) throw new Error('Pick a logo before creating the mod.');
      try {
        set({ busy: 'uploading', lastError: null });
        const mod = await addMod(requireClient(), {
          logo,
          name: sc.draft.name,
          summary: sc.draft.summary,
          description: sc.draft.description_md ?? undefined,
          visible: sc.draft.visible,
          tags: sc.draft.tags,
        });
        const next: ModioSidecar = { ...sc, mod_id: mod.id, name_id: mod.name_id };
        set({ sidecar: next, remoteMod: mod });
        await writeSidecar(ds, next);
        recomputeSync();
        toastSuccess(`Created mod “${mod.name}” on mod.io.`);
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
        toastError(toFriendlyError(e).message);
        throw e;
      } finally {
        set({ busy: 'idle' });
      }
    },

    async pushMetadata() {
      const sc = get().sidecar;
      if (!sc?.mod_id) throw new Error('Mod is not bound.');
      try {
        set({ busy: 'uploading', lastError: null });
        const mod = await editMod(requireClient(), sc.mod_id, {
          name: sc.draft.name,
          summary: sc.draft.summary,
          description: sc.draft.description_md ?? undefined,
          visible: sc.draft.visible,
        });
        set({ remoteMod: mod });
        recomputeSync();
        toastSuccess('Metadata saved to mod.io.');
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
        toastError(toFriendlyError(e).message);
        throw e;
      } finally {
        set({ busy: 'idle' });
      }
    },

    async pushModfile(args: { version: string; changelog: string; active: boolean }) {
      const sc = get().sidecar;
      if (!sc?.mod_id) throw new Error('Mod is not bound.');
      // Pack first if we haven't, or if records may have changed since last pack.
      await get().packCurrent();
      const pack = get().lastPack;
      if (!pack) throw new Error('Packing failed.');
      try {
        set({ busy: 'uploading', lastError: null });
        const file = await addModfile(requireClient(), sc.mod_id, {
          filedata: pack.blob,
          filehash: pack.md5,
          version: args.version,
          changelog: args.changelog,
          active: args.active,
        });
        const next: ModioSidecar = {
          ...sc,
          last_pushed: {
            modfile_id: file.id,
            md5: pack.md5,
            size: pack.size,
            version: args.version,
            date: file.date_added,
          },
          draft: { ...sc.draft, next_version: bumpVersion(args.version) },
        };
        set({ sidecar: next });
        await writeSidecar(useDefinitionsStore.getState().dataSource, next);
        await get().refreshRemoteMod();
        await get().refreshModfileHistory();
        recomputeSync();
        set({ publishWizardStep: 'done' });
        if (args.active) toastSuccess(`Published version ${args.version}.`);
        else toastInfo(`Uploaded version ${args.version} as a draft (not yet active).`);
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
        toastError(toFriendlyError(e).message);
        throw e;
      } finally {
        set({ busy: 'idle' });
      }
    },

    openBrowse() { set({ browseDialogOpen: true }); void get().searchBrowse({ q: '' }); void get().ensureGameTags(); },
    closeBrowse() { set({ browseDialogOpen: false, selectedMod: null, selectedModfiles: null, selectedDependencies: null }); },

    async searchBrowse({ q, sort, pageSize, scope, tagsAnd, tagsOr } = {}) {
      const cur = get().listing;
      const newQ = q ?? cur?.query ?? '';
      const newSort = sort ?? cur?.sort ?? '-date_updated';
      const ps = pageSize ?? cur?.pageSize ?? 24;
      const newScope: 'public' | 'mine' = scope ?? cur?.scope ?? 'public';
      const tA = tagsAnd ?? cur?.tagsAnd ?? [];
      const tO = tagsOr ?? cur?.tagsOr ?? [];
      try {
        set({
          listing: { mods: [], query: newQ, sort: newSort, scope: newScope, tagsAnd: tA, tagsOr: tO, nextOffset: 0, pageSize: ps, total: 0, loading: true, exhausted: false },
          lastError: null,
        });
        const args = {
          q: newQ,
          sort: newSort,
          limit: ps,
          offset: 0,
          tags: tA.length ? tA.join(',') : undefined,
          tagsIn: tO.length ? tO.join(',') : undefined,
        };
        const r = newScope === 'mine'
          ? await getMyMods(requireClient(), { gameId: requireClient().cfg.gameId, q: newQ, limit: ps, offset: 0 })
          : await listMods(requireClient(), args);
        const nextOffset = r.data.length;
        set({
          listing: {
            mods: r.data,
            query: newQ,
            sort: newSort,
            scope: newScope,
            tagsAnd: tA,
            tagsOr: tO,
            nextOffset,
            pageSize: ps,
            total: r.result_total,
            loading: false,
            exhausted: nextOffset >= r.result_total,
          },
        });
      } catch (e) {
        const err = toFriendlyError(e);
        toastError(err.message);
        set({
          lastError: err,
          listing: { mods: [], query: newQ, sort: newSort, scope: newScope, tagsAnd: tA, tagsOr: tO, nextOffset: 0, pageSize: ps, total: 0, loading: false, exhausted: true },
        });
      }
    },

    async loadMoreBrowse() {
      const cur = get().listing;
      if (!cur || cur.loading || cur.exhausted) return;
      try {
        set({ listing: { ...cur, loading: true } });
        const args = {
          q: cur.query,
          sort: cur.sort,
          limit: cur.pageSize,
          offset: cur.nextOffset,
          tags: cur.tagsAnd.length ? cur.tagsAnd.join(',') : undefined,
          tagsIn: cur.tagsOr.length ? cur.tagsOr.join(',') : undefined,
        };
        const r = cur.scope === 'mine'
          ? await getMyMods(requireClient(), { gameId: requireClient().cfg.gameId, q: cur.query, limit: cur.pageSize, offset: cur.nextOffset })
          : await listMods(requireClient(), args);
        // De-dup defensively in case the server returns overlap.
        const seen = new Set(cur.mods.map((m) => m.id));
        const merged = cur.mods.concat(r.data.filter((m) => !seen.has(m.id)));
        const nextOffset = cur.nextOffset + r.data.length;
        set({
          listing: {
            ...cur,
            mods: merged,
            nextOffset,
            total: r.result_total,
            loading: false,
            exhausted: r.data.length === 0 || nextOffset >= r.result_total,
          },
        });
      } catch (e) {
        set({ lastError: toFriendlyError(e), listing: { ...cur, loading: false } });
      }
    },

    async selectMod(mod) {
      if (!mod) { set({ selectedMod: null, selectedModfiles: null, selectedDependencies: null }); return; }
      set({ selectedMod: mod, selectedLoading: true, selectedModfiles: null, selectedDependencies: null });
      try {
        const [files, deps] = await Promise.all([
          listModfiles(requireClient(), mod.id, { limit: 24, sort: '-date_added' }).catch(() => null),
          listDependencies(requireClient(), mod.id).catch(() => null),
        ]);
        set({
          selectedModfiles: files?.data ?? [],
          selectedDependencies: deps?.data ?? [],
          selectedLoading: false,
        });
      } catch (e) {
        toastError(toFriendlyError(e).message);
        set({ selectedLoading: false });
      }
    },

    async addModDependency(modId) {
      const sc = get().sidecar;
      if (!sc?.mod_id) { toastError('Bind the project to a mod first.'); return; }
      try {
        await addDependencies(requireClient(), sc.mod_id, [modId]);
        toastSuccess('Dependency added.');
        await get().refreshDependencies();
      } catch (e) { toastError(toFriendlyError(e).message); }
    },

    async removeModDependency(modId) {
      const sc = get().sidecar;
      if (!sc?.mod_id) return;
      try {
        await deleteDependencies(requireClient(), sc.mod_id, [modId]);
        toastInfo('Dependency removed.');
        await get().refreshDependencies();
      } catch (e) { toastError(toFriendlyError(e).message); }
    },

    async refreshDependencies() {
      const sc = get().sidecar;
      if (!sc?.mod_id) { set({ selectedDependencies: null }); return; }
      try {
        const r = await listDependencies(requireClient(), sc.mod_id);
        set({ selectedDependencies: r.data });
      } catch (e) { toastError(toFriendlyError(e).message); }
    },

    async refreshModfileHistory() {
      const sc = get().sidecar;
      if (!sc?.mod_id) { set({ selectedModfiles: null }); return; }
      try {
        const r = await listModfiles(requireClient(), sc.mod_id, { limit: 24 });
        set({ selectedModfiles: r.data });
      } catch (e) { toastError(toFriendlyError(e).message); }
    },

    async promoteModfile(fileId) {
      const sc = get().sidecar;
      if (!sc?.mod_id) return;
      try {
        await editModfile(requireClient(), sc.mod_id, fileId, { active: true });
        toastSuccess(`Modfile ${fileId} is now active.`);
        await get().refreshRemoteMod();
        await get().refreshModfileHistory();
      } catch (e) { toastError(toFriendlyError(e).message); }
    },

    async pollRemoteEvents() {
      const sc = get().sidecar;
      if (!sc?.mod_id) return;
      // Only fetch events newer than the last one we saw to keep it cheap.
      const cur = get().lastRemoteEvent;
      const since = cur ? cur.date_added : Math.floor(Date.now() / 1000) - 60;
      try {
        const r = await listModEvents(requireClient(), sc.mod_id, { dateAddedMin: since + 1, limit: 5 });
        if (r.data.length > 0) {
          const newest = r.data[0];
          set({ lastRemoteEvent: newest });
          if (newest.event_type === 'MODFILE_CHANGED' || newest.event_type === 'MOD_EDITED') {
            toastInfo('Remote mod was updated. Click Publish to refresh sync state.');
            await get().refreshRemoteMod();
          }
        }
      } catch { /* swallow — polling is best-effort */ }
    },

    publishIssues({ willPushModfile, pendingVersion }) {
      const s = get();
      const sc = s.sidecar;
      if (!sc) return [{ field: 'general', severity: 'error', message: 'No project bound.' }];
      return validatePublish({
        sidecar: sc,
        isNew: sc.mod_id == null,
        lastPack: s.lastPack,
        willPushModfile,
        pendingVersion,
      });
    },

    async openModByRef(input: string) {
      const ref = parseModioRef(input);
      if (!ref) {
        set({ lastError: { http: 0, message: 'That doesn’t look like a mod.io link, slug, or id.' } });
        return;
      }
      try {
        set({ busy: 'fetching', lastError: null });
        let mod: ModioMod | null = null;
        if (ref.kind === 'id') {
          mod = await getMod(requireClient(), ref.modId);
        } else {
          // For slug refs (bare slug or full URL), look up by name_id within
          // the configured game. The game part of the URL is informational —
          // a different game's slug just won't resolve and we surface that.
          const slug = ref.kind === 'slug' ? ref.modSlug : ref.modSlug;
          mod = await getModByNameId(requireClient(), slug);
          if (!mod) {
            set({ lastError: { http: 404, message: `No mod with slug "${slug}" in this game.` } });
            return;
          }
        }
        await get().openModAsProject(mod);
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      } finally {
        set({ busy: 'idle' });
      }
    },

    async openModAsProject(mod: ModioMod) {
      try {
        set({ busy: 'opening', lastError: null });
        if (!mod.modfile?.download?.binary_url) throw new Error('This mod has no published modfile yet.');
        const r = await fetch(mod.modfile.download.binary_url);
        if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        const entries = await readZipAsync(buf);
        if (!entries) throw new Error('Could not read the mod ZIP (unsupported compression).');
        // Build folder/id -> text map. Skip mod.json and any non-JSON files.
        const dec = new TextDecoder();
        const map = new Map<string, string>();
        for (const e of entries) {
          if (e.path === 'mod.json' || !e.path.toLowerCase().endsWith('.json')) continue;
          const slash = e.path.lastIndexOf('/');
          if (slash < 0) continue;
          const folder = e.path.slice(0, slash);
          const id = e.path.slice(slash + 1).replace(/\.json$/i, '');
          map.set(`${folder}/${id}`, dec.decode(e.data));
        }
        const ds = new InMemoryDataSource(`mod.io: ${mod.name}`, map, { schema_version: 1, name: mod.name });
        await useDefinitionsStore.getState().loadFromCustomDataSource(ds);
        set({ browseDialogOpen: false });
        // The opened project is in-memory; user will Save As to commit.
      } catch (e) {
        set({ lastError: toFriendlyError(e) });
      } finally {
        set({ busy: 'idle' });
      }
    },

    openSignInModal() { set({ signInModalOpen: true, lastError: null, emailFlow: { email: null, step: 'idle' } }); },
    closeSignInModal() { set({ signInModalOpen: false }); },
    openPublishWizard(step) { set({ publishWizardOpen: true, publishWizardStep: step ?? 'bind', lastError: null }); },
    closePublishWizard() { set({ publishWizardOpen: false }); },
    setPublishStep(step) { set({ publishWizardStep: step }); },
    clearError() { set({ lastError: null }); },
  } satisfies Omit<ModIoStore, 'cfg' | 'client' | 'token' | 'tokenExpiresAt' | 'user' | 'authBusy' | 'emailFlow' | 'sidecar' | 'remoteMod' | 'gameTagOptions' | 'starterCatalog' | 'lastPack' | 'syncState' | 'listing' | 'signInModalOpen' | 'publishWizardOpen' | 'publishWizardStep' | 'browseDialogOpen' | 'busy' | 'lastError' | 'selectedMod' | 'selectedModfiles' | 'selectedDependencies' | 'selectedLoading' | 'lastRemoteEvent'>;
}

/** Bump a semver-ish "0.1.3" → "0.1.4". Falls back to appending "+next". */
export function bumpVersion(v: string): string {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (m) {
    const patch = Number(m[3]) + 1;
    return `${m[1]}.${m[2]}.${patch}`;
  }
  return v + '.1';
}

// Re-export for tests
export { configFromEnv as _configFromEnv, deriveSyncState as _deriveSyncState };
