import type { ModioClient } from './client';
import type {
  ModioDependency,
  ModioGameTags,
  ModioMessage,
  ModioMod,
  ModioModEvent,
  ModioModfile,
  ModioOAuthTokenResponse,
  ModioPagedResult,
  ModioUser,
} from './types';

// --- Auth -------------------------------------------------------------------

export interface EmailRequestArgs { email: string; }

export async function emailRequest(c: ModioClient, { email }: EmailRequestArgs): Promise<ModioMessage> {
  // POST /oauth/emailrequest takes api_key + email as form fields. We send
  // api_key in the form body (not header) per the docs.
  return c.post<ModioMessage>('/oauth/emailrequest', {
    api_key: c.cfg.apiKey,
    email,
  }, { auth: false });
}

export interface EmailExchangeArgs { code: string; dateExpires?: number; }

export async function emailExchange(c: ModioClient, args: EmailExchangeArgs): Promise<ModioOAuthTokenResponse> {
  const body: Record<string, string | number> = {
    api_key: c.cfg.apiKey,
    security_code: args.code,
  };
  if (args.dateExpires) body.date_expires = args.dateExpires;
  return c.post<ModioOAuthTokenResponse>('/oauth/emailexchange', body, { auth: false });
}

export async function logout(c: ModioClient): Promise<void> {
  await c.post<unknown>('/oauth/logout', {});
}

// --- Me / Users -------------------------------------------------------------

export async function getMe(c: ModioClient, signal?: AbortSignal): Promise<ModioUser> {
  return c.get<ModioUser>('/me', { signal });
}

export interface ListMyModsArgs {
  q?: string;
  limit?: number;
  offset?: number;
  gameId?: number;
}

export async function getMyMods(c: ModioClient, args: ListMyModsArgs = {}, signal?: AbortSignal): Promise<ModioPagedResult<ModioMod>> {
  return c.get<ModioPagedResult<ModioMod>>('/me/mods', {
    signal,
    query: {
      _q: args.q,
      _limit: args.limit ?? 24,
      _offset: args.offset ?? 0,
      game_id: args.gameId,
    },
  });
}

// --- Mods (game-scoped) -----------------------------------------------------

export interface ListModsArgs {
  q?: string;
  limit?: number;
  offset?: number;
  submittedById?: number;
  /** _sort value. Use a leading "-" for descending. Valid columns for the
   *  Mods endpoint (per mod.io docs): name, date_live, date_updated,
   *  submitted_by, downloads_today, downloads_total, subscribers_total,
   *  ratings_weighted_aggregate, popular. */
  sort?: string;
  /** Comma-separated AND tags (`tags=A,B` → must have both). */
  tags?: string;
  /** Comma-separated OR tags (`tags-in=A,B` → must have either). */
  tagsIn?: string;
  /** Exact name_id (slug) match. Phantom -eq suffix is silently ignored by
   *  the API, so we always use the bare form. */
  nameId?: string;
}

export async function listMods(c: ModioClient, args: ListModsArgs = {}, signal?: AbortSignal): Promise<ModioPagedResult<ModioMod>> {
  // Default auth: when a token is present we use Bearer (so the caller sees
  // their own hidden mods); when not, the client falls back to ?api_key for
  // public browsing. Either way the request is authorized.
  return c.get<ModioPagedResult<ModioMod>>(`/games/${c.cfg.gameId}/mods`, {
    signal,
    query: {
      _q: args.q,
      _limit: args.limit ?? 24,
      _offset: args.offset ?? 0,
      _sort: args.sort,
      submitted_by: args.submittedById,
      tags: args.tags,
      'tags-in': args.tagsIn,
      name_id: args.nameId,
    },
  });
}

export async function getMod(c: ModioClient, modId: number, signal?: AbortSignal): Promise<ModioMod> {
  // Same bearer-or-api_key fallback as listMods. Hidden mods are only visible
  // to the owner so we MUST use the token when available.
  return c.get<ModioMod>(`/games/${c.cfg.gameId}/mods/${modId}`, { signal });
}

/** Look up a mod by its `name_id` (URL slug). Returns null if no mod
 *  matches in this game. Used by the "paste link" UX. */
export async function getModByNameId(c: ModioClient, nameId: string, signal?: AbortSignal): Promise<ModioMod | null> {
  const r = await listMods(c, { nameId, limit: 1 }, signal);
  return r.data[0] ?? null;
}

export interface AddModArgs {
  logo: Blob;
  name: string;
  summary: string;
  description?: string;
  visible?: 0 | 1;
  tags?: string[];
  metadata_blob?: string;
}

export async function addMod(c: ModioClient, args: AddModArgs, signal?: AbortSignal): Promise<ModioMod> {
  const fd = new FormData();
  fd.set('logo', args.logo, 'logo.png');
  fd.set('name', args.name);
  fd.set('summary', args.summary);
  if (args.description != null) fd.set('description', args.description);
  if (args.visible != null) fd.set('visible', String(args.visible));
  if (args.metadata_blob != null) fd.set('metadata_blob', args.metadata_blob);
  if (args.tags && args.tags.length) {
    for (const t of args.tags) fd.append('tags[]', t);
  }
  return c.postMultipart<ModioMod>(`/games/${c.cfg.gameId}/mods`, fd, { signal });
}

export interface EditModArgs {
  name?: string;
  summary?: string;
  description?: string;
  visible?: 0 | 1;
  metadata_blob?: string;
}

export async function editMod(c: ModioClient, modId: number, args: EditModArgs, signal?: AbortSignal): Promise<ModioMod> {
  // mod.io requires multipart/form-data on this endpoint specifically (the
  // server rejects urlencoded with HTTP 415). POST, not PUT.
  const fd = new FormData();
  if (args.name != null) fd.set('name', args.name);
  if (args.summary != null) fd.set('summary', args.summary);
  if (args.description != null) fd.set('description', args.description);
  if (args.visible != null) fd.set('visible', String(args.visible));
  if (args.metadata_blob != null) fd.set('metadata_blob', args.metadata_blob);
  return c.postMultipart<ModioMod>(`/games/${c.cfg.gameId}/mods/${modId}`, fd, { signal });
}

export async function deleteMod(c: ModioClient, modId: number, signal?: AbortSignal): Promise<void> {
  await c.delete(`/games/${c.cfg.gameId}/mods/${modId}`, { signal });
}

// --- Modfile listing + promotion ----------------------------------------

export async function listModfiles(c: ModioClient, modId: number, args: { limit?: number; offset?: number; sort?: string } = {}, signal?: AbortSignal): Promise<ModioPagedResult<ModioModfile>> {
  return c.get<ModioPagedResult<ModioModfile>>(`/games/${c.cfg.gameId}/mods/${modId}/files`, {
    signal,
    query: {
      _limit: args.limit ?? 24,
      _offset: args.offset ?? 0,
      _sort: args.sort ?? '-date_added',
    },
  });
}

export interface EditModfileArgs {
  version?: string;
  changelog?: string;
  active?: boolean;
  metadata_blob?: string;
}

export async function editModfile(c: ModioClient, modId: number, fileId: number, args: EditModfileArgs, signal?: AbortSignal): Promise<ModioModfile> {
  // mod.io's edit-modfile endpoint uses PUT with form-urlencoded
  // (unlike edit-mod which uses POST multipart — verified live).
  const body: Record<string, string | number | boolean> = {};
  if (args.version != null) body.version = args.version;
  if (args.changelog != null) body.changelog = args.changelog;
  if (args.active != null) body.active = args.active;
  if (args.metadata_blob != null) body.metadata_blob = args.metadata_blob;
  return c.put<ModioModfile>(`/games/${c.cfg.gameId}/mods/${modId}/files/${fileId}`, body, { signal });
}

// --- Dependencies -------------------------------------------------------

export async function listDependencies(c: ModioClient, modId: number, signal?: AbortSignal): Promise<ModioPagedResult<ModioDependency>> {
  return c.get<ModioPagedResult<ModioDependency>>(`/games/${c.cfg.gameId}/mods/${modId}/dependencies`, { signal });
}

export async function addDependencies(c: ModioClient, modId: number, deps: number[], opts: { sync?: boolean } = {}, signal?: AbortSignal): Promise<void> {
  // mod.io's add-dependencies endpoint requires application/x-www-form-urlencoded
  // (verified live: multipart returns 415). Pass repeated dependencies[]=<id>.
  const body: Array<[string, string | number | boolean]> = deps.map((d) => ['dependencies[]', d]);
  if (opts.sync != null) body.push(['sync', opts.sync]);
  await c.post<unknown>(`/games/${c.cfg.gameId}/mods/${modId}/dependencies`, body, { signal });
}

export async function deleteDependencies(c: ModioClient, modId: number, deps: number[], signal?: AbortSignal): Promise<void> {
  const body: Array<[string, string | number | boolean]> = deps.map((d) => ['dependencies[]', d]);
  await c.delete(`/games/${c.cfg.gameId}/mods/${modId}/dependencies`, { body, signal });
}

// --- Events -------------------------------------------------------------

export interface ListModEventsArgs {
  /** Unix seconds — only events at or after this time. */
  dateAddedMin?: number;
  limit?: number;
  offset?: number;
}

export async function listGameModEvents(c: ModioClient, args: ListModEventsArgs = {}, signal?: AbortSignal): Promise<ModioPagedResult<ModioModEvent>> {
  return c.get<ModioPagedResult<ModioModEvent>>(`/games/${c.cfg.gameId}/mods/events`, {
    signal,
    query: {
      'date_added-min': args.dateAddedMin,
      _limit: args.limit ?? 50,
      _offset: args.offset ?? 0,
      _sort: '-date_added',
    },
  });
}

export async function listModEvents(c: ModioClient, modId: number, args: ListModEventsArgs = {}, signal?: AbortSignal): Promise<ModioPagedResult<ModioModEvent>> {
  return c.get<ModioPagedResult<ModioModEvent>>(`/games/${c.cfg.gameId}/mods/${modId}/events`, {
    signal,
    query: {
      'date_added-min': args.dateAddedMin,
      _limit: args.limit ?? 50,
      _offset: args.offset ?? 0,
      _sort: '-date_added',
    },
  });
}

export interface AddModfileArgs {
  filedata: Blob;
  filehash: string; // md5 hex
  version?: string;
  changelog?: string;
  active?: boolean;
  metadata_blob?: string;
}

export async function addModfile(c: ModioClient, modId: number, args: AddModfileArgs, signal?: AbortSignal): Promise<ModioModfile> {
  const fd = new FormData();
  fd.set('filedata', args.filedata, 'mod.zip');
  fd.set('filehash', args.filehash);
  if (args.version != null) fd.set('version', args.version);
  if (args.changelog != null) fd.set('changelog', args.changelog);
  if (args.active != null) fd.set('active', String(args.active));
  if (args.metadata_blob != null) fd.set('metadata_blob', args.metadata_blob);
  return c.postMultipart<ModioModfile>(`/games/${c.cfg.gameId}/mods/${modId}/files`, fd, { signal });
}

// --- Game tags --------------------------------------------------------------

export async function getGameTags(c: ModioClient, signal?: AbortSignal): Promise<ModioGameTags> {
  return c.get<ModioGameTags>(`/games/${c.cfg.gameId}/tags`, { auth: false, signal });
}
