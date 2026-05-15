# mod.io integration — implementation plan

Implements the design in `2026-05-14-modio-integration-design.md`. Build order is bottom-up: types → config → http → packer → store → UI → wiring → tests.

## 1. Shared ZIP/CRC helpers

Factor `makeZip` and `crc32` out of `web/src/store/definitionsStore.ts` into `web/src/modio/zip.ts` and update the call site to import from there. No behaviour change.

Acceptance: typecheck passes; `npm run smoke:savedload` still passes (uses `exportZip`).

## 2. md5 helper

`web/src/modio/md5.ts` — pure-JS MD5 returning a 32-char lowercase hex string. Known-answer test against RFC 1321 vectors.

## 3. types.ts

Define interfaces from mod.io docs:

```ts
export interface ModioUser { id: number; name_id: string; username: string; …}
export interface ModioLogo { filename: string; original: string; thumb_320x180: string; …}
export interface ModioFilehash { md5: string; }
export interface ModioModfile { id: number; mod_id: number; filehash: ModioFilehash; filesize: number; version: string | null; changelog: string | null; date_added: number; download: { binary_url: string; date_expires: number; } | null; …}
export interface ModioMod { id: number; game_id: number; status: number; visible: number; name: string; name_id: string; summary: string; description: string | null; description_plaintext: string | null; profile_url: string; logo: ModioLogo; date_updated: number; modfile: ModioModfile | null; tags: { name: string }[]; …}
export interface ModioTag { name: string; }
export interface ModioPagedResult<T> { data: T[]; result_count: number; result_offset: number; result_limit: number; result_total: number; }
export interface ModioErrorEnvelope { error: { code: number; error_ref?: number; message: string; errors?: Record<string, string>; }; }
export type ModioEnv = 'live' | 'test';

export interface ModioSidecar {
  schema_version: 1;
  env: ModioEnv;
  mod_id: number | null;
  name_id: string | null;
  draft: {
    name: string;
    summary: string;
    description_md: string | null;
    tags: string[];
    logo_path: string | null;
    visible: 0 | 1;
  };
  last_pushed: {
    modfile_id: number;
    md5: string;
    size: number;
    version: string | null;
    date: number;
  } | null;
}
```

## 4. config.ts

Reads:

```
VITE_MODIO_GAME_ID
VITE_MODIO_API_KEY
VITE_MODIO_ENV     // 'live' | 'test' (default 'live')
```

Returns `{ gameId: number, apiKey: string, env: ModioEnv, baseUrl: string }`. `baseUrl` is `https://g-{gameId}.modapi.io/v1` when env=live, `https://g-{gameId}.test.mod.io/v1` when env=test. Throws a descriptive error in dev if either env var is missing; defers in prod so a misconfigured build doesn't crash the app — UI just disables mod.io features.

Create `.env.example` documenting the vars. Add `.env.local` for the user with the values they supplied (game_id=13031, api_key=c35fe12fe8c046abcb29e5382953fec4) — and add `.env.local` to `.gitignore` if not already there.

## 5. errors.ts

```ts
export class ModioError extends Error {
  constructor(
    public readonly http: number,
    public readonly errorRef: number | undefined,
    public readonly publicMessage: string,
    public readonly fieldErrors?: Record<string, string>,
  ) { super(publicMessage); }
  get friendly(): string { … look up errorRef in MESSAGES, fall back to publicMessage … }
}

export const MESSAGES: Record<number, string> = {
  11000: 'Your mod.io session has expired. Please sign in again.',
  11074: 'You need to accept mod.io terms before continuing.',
  13009: 'Some fields are invalid.',
  15006: 'You do not have permission to upload to this mod.',
  15022: 'Mod not found on mod.io.',
  15023: 'This mod has been deleted on mod.io.',
  // … etc, populated from research
};
```

## 6. client.ts

```ts
export interface ModioClient {
  get<T>(path: string, opts?: { auth?: boolean; query?: Record<string, string | number | undefined>; }): Promise<T>;
  post<T>(path: string, body: BodyInit | Record<string, string>, opts?: { auth?: boolean; form?: boolean; }): Promise<T>;
  postMultipart<T>(path: string, form: FormData, opts?: { auth?: boolean }): Promise<T>;
}

export function createClient(cfg: ModioConfig, getToken: () => string | null): ModioClient { … }
```

Implementation notes:

- Always sends `Accept: application/json`, `X-Modio-Platform: windows`, `X-Modio-Portal: itchio`.
- `auth: true` (default) sends `Authorization: Bearer <token>` if a token is present, otherwise falls back to `?api_key=<key>` query — gives read endpoints a graceful path when signed out.
- `auth: false` always uses `?api_key`.
- Non-2xx → parse error envelope, throw `ModioError`. 429 → look at `retry-after`, sleep, retry once; second 429 throws.
- `Record<string, string>` body is serialised as `application/x-www-form-urlencoded` (this is what every non-multipart mod.io write expects).

## 7. endpoints.ts

Typed functions, one per route:

```ts
emailRequest(client, email): Promise<{ code: number; message: string }>;
emailExchange(client, code): Promise<{ access_token: string; date_expires: number; code: number }>;
logout(client): Promise<void>;
getMe(client): Promise<ModioUser>;
getMyMods(client, query): Promise<ModioPagedResult<ModioMod>>;
listMods(client, query): Promise<ModioPagedResult<ModioMod>>;
getMod(client, modId): Promise<ModioMod>;
addMod(client, form: AddModForm): Promise<ModioMod>;
editMod(client, modId, patch: EditModPatch): Promise<ModioMod>;
addModfile(client, modId, form: AddModfileForm): Promise<ModioModfile>;
getGameTags(client): Promise<{ tag_options: { name: string; tags: { name: string }[] }[] }>;
```

All accept a `signal?: AbortSignal` for cancellation.

## 8. packer.ts

```ts
export interface StarterCatalog {
  // bare-id-keyed map of canonical serialised JSON text from the bundled
  // starter-project. Lets the packer diff without re-reading HTTP each time.
  byKey: Map<string /* folder/id */, string /* canonical text */>;
}

export interface PackedMod {
  blob: Blob;
  md5: string;
  size: number;
  files: Array<{ folder: string; id: string; md5: string }>;
  manifestJson: string;
}

export async function buildDeltaZip(
  records: Iterable<DefinitionRecord>,
  starter: StarterCatalog,
  meta: { editorVersion: string; baseSource: string },
): Promise<PackedMod>;
```

Algorithm:

1. For each record, compute its canonical serialised text (use the same `serializeDefinition` the editor's save path uses — needs an exported helper from `definitionsStore` or a parallel impl that matches).
2. If `starter.byKey.get(`${folder}/${id}`)` matches → skip.
3. Else add `<folder>/<id>.json` to the ZIP with that text + per-file md5.
4. Generate `mod.json` from the file list + meta.
5. Serialise ZIP via `zip.ts`.
6. Compute md5 of the whole blob.

The starter catalog is loaded once at boot from `web/public/starter-project/` (we already fetch this for the bundled defaults) and lifted into `modIoStore` lazily.

## 9. sidecar.ts

```ts
export const SIDECAR_PATH = '.modio.json';
export async function readSidecar(ds: DataSource): Promise<ModioSidecar | null>;
export async function writeSidecar(ds: DataSource, s: ModioSidecar): Promise<void>;
export function emptySidecar(env: ModioEnv): ModioSidecar;
export function migrate(raw: unknown): ModioSidecar | null;
```

`writeSidecar` requires the DataSource to support `writeFile` — the FSA source does, the HTTP/starter source doesn't (we silently no-op in that case and surface a "Save As first to bind to a mod" message).

Sidecar file lives at root of the project folder. Since the DataSource model uses `folder/id` paths, sidecar.ts will read/write through `ds.rootHandle` directly when `kind === 'fsa'`. Add a tiny helper on FsaDataSource: `readRootJson(name)` / `writeRootJson(name, value)`.

## 10. modIoStore.ts

zustand store. Public actions:

- `bootstrap()` — read stored token, probe `/me`, also try to read `.modio.json` from current DataSource.
- `signInRequest(email)` — kicks off email flow, returns the message.
- `signInExchange(code)` — completes flow, stores token.
- `signOut()` — calls `logout`, clears storage.
- `loadSidecar()` / `saveSidecar()` — bound to current DataSource.
- `bindToMod(modId)` — fetches the mod, populates sidecar.draft, persists.
- `createOrUpdateMod(patch, logoFile)` — POSTs `/mods` or `/mods/{id}`.
- `pushModfile({ version, changelog })` — packs, MD5s, uploads, updates last_pushed.
- `refreshSyncState()` — re-derive `syncState`.
- `openBrowse({ query, offset })` — fetch listing.
- `openModAsProject(modId)` — fetch + unpack + hand off to `definitionsStore`.

Token storage:

```
sessionStorage / localStorage key: 'tsic.modio.token.v1' = JSON.stringify({ token, expiresAt, env })
```

Token reads on app boot. Sign-out clears both stores.

## 11. UI components

### `SignInButton.tsx`

When signed out: button "🌐 Sign in" → opens `SignInModal`.
When signed in: pill `🌐 <username> ▾` → dropdown with "Sign out" + env toggle.

### `SignInModal.tsx`

Two-step modal:

1. Email input → `signInRequest` → moves to step 2 on success.
2. Code input + "Keep me signed in" checkbox → `signInExchange` → closes on success.

Errors render inline. Loading spinner on the action button. Cancel closes the modal and aborts the in-flight fetch.

### `PublishButton.tsx`

Always visible in header. Disabled if no DataSource. Tooltip explains state: "Sign in to publish" when no token; "Up to date" / "X changes since last push" otherwise.

### `PublishWizard.tsx`

Modal with stepper. Steps:

1. **Bind** — Choose existing mod (combobox of `/me/mods` filtered to current game_id) or "Create new". Skipped if `sidecar.mod_id` already set.
2. **Metadata** — name, summary, description, tags (checkbox grid from `/games/{id}/tags`), logo file picker (saves to `.modio/logo.png` in the project), visible toggle. "Save metadata" calls `addMod` or `editMod`.
3. **Modfile** — diff summary table (X files added, Y modified), `version` input (pre-filled with bump suggestion), `changelog` textarea, `active` checkbox. "Publish" calls `pushModfile`.
4. **Confirm** — Shows result, link to `profile_url`.

### `BrowseModsButton.tsx` + `BrowseModsDialog.tsx`

Always visible. Dialog: search box, paged grid of mod cards. Each card has "Open" (download + open as project) and "View on mod.io" (`profile_url`). No auth required.

### `SyncChip.tsx`

Tiny pill in the Header's file-info span: `● synced`, `↑ local changes`, `↓ remote changes`, `· not on mod.io`. Colour coded.

## 12. Wire into `Header.tsx`

Append the three buttons + `SyncChip` to the existing button row. No layout overhaul.

`main.tsx` boots the modIoStore: read stored token; when `definitionsStore.dataSource` changes, `modIoStore.loadSidecar()`.

## 13. Tests

Add under `web/tests/`:

- `modioMd5.test.ts` — RFC vectors.
- `modioZip.test.ts` — local-header + EOCD sanity.
- `modioPacker.test.ts` — delta correctness on a synthetic project.
- `modioSidecar.test.ts` — round-trip + migration.
- `modioClient.test.ts` — fetch wrapper headers + auth + retry-after + error envelope.
- `modioStore.test.ts` — sync-state matrix; sign-in machine.

Run via existing `npm run test`.

## 14. Build verification

- `npm run typecheck`
- `npm run test`
- `npm run build` — confirm Vite produces the bundle with mod.io env vars.

## 15. Out of scope (deferred)

- Logo cropper.
- Multipart upload UI for >100 MB modfiles.
- Webhook / events polling.
- Mod dependencies graph.
- KVP metadata editor.
- OIDC popup sign-in.

## Rollback

Everything is additive. To remove: delete `web/src/modio/`, delete `web/src/components/modio/`, revert the header changes, remove the env vars. The sidecar file in user projects becomes inert (no code references it) and can be deleted by the user.
