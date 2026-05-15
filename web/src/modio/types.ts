// TypeScript shapes for the subset of mod.io's API v1 the editor uses.
// Authored against:
//   https://docs.mod.io/restapiref/
//   https://docs.mod.io/restapi/docs/schemas/mod-object
//   https://docs.mod.io/restapi/docs/schemas/modfile-object

export type ModioEnv = 'live' | 'test';

export interface ModioUser {
  id: number;
  name_id: string;
  username: string;
  display_name_portal?: string | null;
  avatar?: ModioAvatar;
  date_online?: number;
  date_joined?: number;
  profile_url?: string;
}

export interface ModioAvatar {
  filename: string;
  original: string;
  thumb_50x50?: string;
  thumb_100x100?: string;
}

export interface ModioLogo {
  filename: string;
  original: string;
  thumb_320x180?: string;
  thumb_640x360?: string;
  thumb_1280x720?: string;
}

export interface ModioFilehash {
  md5: string;
}

export interface ModioDownload {
  binary_url: string;
  date_expires: number;
}

export interface ModioModfile {
  id: number;
  mod_id: number;
  date_added: number;
  date_scanned: number;
  virus_status: number;
  virus_positive: number;
  filesize: number;
  filesize_uncompressed?: number;
  filehash: ModioFilehash;
  filename: string;
  version: string | null;
  changelog: string | null;
  metadata_blob?: string | null;
  download: ModioDownload | null;
}

export interface ModioMediaImage {
  filename: string;
  original: string;
  thumb_320x180?: string;
}

export interface ModioMedia {
  youtube: string[];
  sketchfab: string[];
  images: ModioMediaImage[];
}

export interface ModioModTag {
  name: string;
  date_added?: number;
}

export interface ModioMod {
  id: number;
  game_id: number;
  status: number; // 0=NotAccepted, 1=Accepted, 3=Deleted
  visible: 0 | 1;
  submitted_by?: ModioUser;
  date_added: number;
  date_updated: number;
  date_live: number;
  logo: ModioLogo;
  name: string;
  name_id: string;
  summary: string;
  description: string | null;
  description_plaintext: string | null;
  homepage_url?: string | null;
  profile_url: string;
  modfile: ModioModfile | null;
  media: ModioMedia;
  tags: ModioModTag[];
  metadata_blob?: string | null;
}

export interface ModioGameTagOption {
  name: string;
  type: 'checkboxes' | 'dropdown';
  hidden: boolean;
  locked: boolean;
  tags: string[];
}

export interface ModioGameTags {
  data: ModioGameTagOption[];
  result_count: number;
  result_offset: number;
  result_limit: number;
  result_total: number;
}

export interface ModioPagedResult<T> {
  data: T[];
  result_count: number;
  result_offset: number;
  result_limit: number;
  result_total: number;
}

export interface ModioErrorEnvelope {
  error: {
    code: number;
    error_ref?: number;
    message: string;
    errors?: Record<string, string>;
  };
}

export interface ModioOAuthTokenResponse {
  code: number;
  access_token: string;
  date_expires: number;
}

export interface ModioMessage {
  code: number;
  message: string;
}

// --- Local-only types -------------------------------------------------------

/** Sidecar file at project root: ties the on-disk project folder to a
 *  mod.io mod and tracks the last successful push. */
export interface ModioSidecar {
  schema_version: 1;
  env: ModioEnv;
  /** Set after the mod is created on mod.io. Null when not yet bound. */
  mod_id: number | null;
  /** mod.io URL slug, mirrors mod_id; null until known. */
  name_id: string | null;
  draft: ModioSidecarDraft;
  last_pushed: ModioLastPush | null;
}

export interface ModioSidecarDraft {
  name: string;
  summary: string;
  description_md: string | null;
  tags: string[];
  /** Path relative to project root, e.g. ".modio/logo.png". */
  logo_path: string | null;
  visible: 0 | 1;
  /** Auto-bumped version proposal for the next push. */
  next_version: string;
}

export interface ModioLastPush {
  modfile_id: number;
  md5: string;
  size: number;
  version: string | null;
  date: number;
}

/** Computed sync status derived from sidecar + remote + currently-packed-md5. */
export type ModioSyncState =
  | 'unbound'      // no mod_id in sidecar
  | 'clean'        // local == last_pushed == remote
  | 'local-newer'  // local diverges from last_pushed
  | 'remote-newer' // remote diverges from last_pushed
  | 'diverged'     // both differ
  | 'unknown';     // can't compute yet (haven't packed / fetched)

// --- Mod dependencies ---

export interface ModioDependency {
  mod_id: number;
  mod_name_id: string;
  date_added: number;
  dependency_depth?: number;
  logo?: ModioLogo;
  modfile_live?: number;
}

// --- Modfile history ---

// (ModioModfile is already defined above; the listing endpoint just returns
// ModioPagedResult<ModioModfile>.)

// --- Mod events ---

export type ModioEventType =
  | 'MODFILE_CHANGED'
  | 'MOD_AVAILABLE'
  | 'MOD_UNAVAILABLE'
  | 'MOD_EDITED'
  | 'MOD_DELETED'
  | 'MOD_TEAM_CHANGED'
  | 'MOD_COMMENT_ADDED'
  | 'MOD_COMMENT_DELETED';

export interface ModioModEvent {
  id: number;
  mod_id: number;
  user_id: number;
  date_added: number;
  event_type: ModioEventType;
}
