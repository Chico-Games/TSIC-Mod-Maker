# mod.io integration — design

Adds mod.io support to the TSIC Definition Editor: sign in, create/edit your mod, push project changes as a new modfile, and browse + open any public mod for the game directly inside the editor.

## Goals

- Author a mod entirely in the browser. No server. No CLI. No game-side tooling.
- Detect "local has changes since last push" and offer one-click upload of a new modfile.
- Let anyone open any public mod for the game as an in-memory project (read-only until Save As).
- Stay aligned with mod.io's REST API v1, including its CORS, header, and error conventions.

## Non-goals (V1)

- Multi-user collab on a single mod (mod.io's team model handles this server-side; we don't surface it).
- Editing somebody else's mod and pushing it back (you can fork via Save As, but the editor does not auto-grant team membership).
- Notification / events stream subscriptions.
- Multipart upload for files >100 MB (delta JSON tree will always be well under that; we still leave a hook).

## Endpoints we depend on

All under base URL `https://g-<game_id>.modapi.io/v1` (prod) or `https://g-<game_id>.test.mod.io/v1` (test).

- `POST /oauth/emailrequest` — start email auth.
- `POST /oauth/emailexchange` — exchange 5-digit code for bearer token.
- `POST /oauth/logout` — revoke current token.
- `GET  /me` — token probe + user object.
- `GET  /me/mods` — list mods the signed-in user has access to.
- `GET  /games/{game_id}/mods` — list public mods (for Browse).
- `GET  /games/{game_id}/mods/{mod_id}` — one mod.
- `POST /games/{game_id}/mods` — create mod.
- `POST /games/{game_id}/mods/{mod_id}` — edit mod metadata.
- `POST /games/{game_id}/mods/{mod_id}/files` — add modfile (single-shot, ≤100 MB).
- `GET  /games/{game_id}/tags` — game's allowed tag set.
- (Multipart endpoints stubbed but not wired into UI in V1.)

Required headers on every request: `Accept: application/json`, plus `X-Modio-Platform: windows` and `X-Modio-Portal: itchio` (placeholder; configurable). Auth: either `Authorization: Bearer <token>` (writes) or `?api_key=<key>` query param (read-only public).

## Module layout

```
web/src/modio/
  config.ts            // reads import.meta.env.* + per-session env override
  zip.ts               // factored makeZip + crc32 (shared with definitionsStore.exportZip)
  md5.ts               // pure-JS md5 hex (mod.io filehash uses md5)
  types.ts             // Mod, Modfile, User, Tag, Logo, Error envelope, sidecar shape
  errors.ts            // error_ref → message map, ModioError class
  client.ts            // fetch wrapper: bearer, headers, 429 retry-after, parse errors
  endpoints.ts         // typed functions, one per route we use
  packer.ts            // buildDeltaZip(records, starterCatalog) → { blob, md5, size, files[] }
  sidecar.ts           // load/save .modio.json via DataSource
  modIoStore.ts        // zustand: token, user, sidecar, syncState, listing, publish, fetch

web/src/components/modio/
  SignInButton.tsx
  SignInModal.tsx      // email → code → done
  PublishButton.tsx
  PublishWizard.tsx    // multi-step: bind-or-create, metadata, version+changelog, confirm
  BrowseModsButton.tsx
  BrowseModsDialog.tsx
  SyncChip.tsx         // tiny status badge for the header file-info row
```

**Boundary rules**

- `endpoints.ts` is the only module that touches `fetch`.
- `packer.ts` is pure (records in → blob out, no I/O).
- UI components only talk to `modIoStore`.
- `modIoStore` is the only thing that calls `endpoints.ts` or `sidecar.ts`.
- `definitionsStore` does not import `modio/*`. The handshake is `.modio.json` only.

## Data shapes

### `.modio.json` (project sidecar)

```json
{
  "schema_version": 1,
  "env": "live",
  "mod_id": 12345,
  "name_id": "my-mod",
  "draft": {
    "name": "My Mod",
    "summary": "Adds a coffee station and a few recipes.",
    "description_md": "Longer markdown body…",
    "tags": ["Gameplay"],
    "logo_path": ".modio/logo.png",
    "visible": 0
  },
  "last_pushed": {
    "modfile_id": 98765,
    "md5": "d41d8cd98f00b204e9800998ecf8427e",
    "size": 12345,
    "version": "0.1.3",
    "date": 1715683200
  }
}
```

- `mod_id` is null until the mod is created on mod.io.
- `last_pushed.md5` is computed locally from the packed ZIP — it's the canonical "what we last sent" marker.
- Logo lives in-project under `.modio/logo.png` so it travels with the folder and can be re-uploaded.

### `mod.json` (generated, inside the uploaded ZIP)

```json
{
  "schema_version": 1,
  "generated_by": "tsic-definition-editor",
  "generated_at": "2026-05-14T12:00:00Z",
  "editor_version": "0.2.0",
  "base": { "source": "starter-project", "version": null },
  "files": [
    { "folder": "consumable_definitions", "id": "ID_Coffee_C", "md5": "<hex>" }
  ]
}
```

### `modIoStore` state

```ts
{
  // auth
  token: string | null;
  tokenExpiresAt: number | null;
  user: User | null;
  // sidecar binding (in-memory mirror of .modio.json)
  sidecar: ModioSidecar | null;
  remoteMod: Mod | null;
  remoteTags: Tag[] | null;
  // computed
  syncState: 'unbound' | 'clean' | 'local-newer' | 'remote-newer' | 'unknown';
  // UI / cache
  listing: { mods: Mod[]; cursor: number; query: string } | null;
  publishWizard: { open: boolean; step: 'bind' | 'meta' | 'modfile' | 'confirm' };
  browseDialogOpen: boolean;
  busy: 'idle' | 'signing-in' | 'packing' | 'uploading' | 'fetching' | 'opening';
  lastError: { http: number; ref?: number; message: string } | null;
}
```

## Flows

### Sign in

1. User clicks `🌐 Sign in` in header → `SignInModal` opens.
2. User enters email → `POST /oauth/emailrequest` with `api_key`, `email`.
3. UI shows "Check your inbox for a 5-digit code". User pastes it.
4. `POST /oauth/emailexchange` with `api_key`, `security_code` → store `access_token` + `date_expires`.
5. Bearer goes into `localStorage` (if "keep me signed in") or `sessionStorage` (default).
6. On app boot, `modIoStore.bootstrap()` reads stored token, calls `GET /me`. On 401 → clear token + show signed-out state.

### Sign out

`POST /oauth/logout` with bearer, then clear local storage entries. No-op if no token.

### Bind project to a mod

In `PublishWizard` step **bind**:

- If `.modio.json` exists and `mod_id` is set → "This project is bound to mod <name>." (link out, option to detach).
- Else → two buttons: **Create new mod** (jumps to metadata step) or **Link existing mod** (combobox of `GET /me/mods` filtered by current game_id).
- Selecting writes `.modio.json` to disk with `mod_id` + a cached metadata draft pulled from the remote mod.

### Edit mod metadata

`PublishWizard` step **meta** edits `sidecar.draft.*`. On Next:

- If mod doesn't exist yet → `POST /games/{game_id}/mods` (multipart with logo + name + summary + …) → store returned `mod_id` into sidecar.
- If mod exists → `POST /games/{game_id}/mods/{mod_id}` with whatever changed.

### Publish a modfile (push)

`PublishWizard` step **modfile**:

1. Run packer: walk `definitions` map, compare each record's serialized form against the starter-project catalog. Records that don't exist in starter OR whose serialized text differs → include. Each file's bytes go into the ZIP at `<folder>/<id>.json`. Also include the generated `mod.json` at ZIP root.
2. Compute MD5 + size on the resulting Blob.
3. Show diff summary: N files, X bytes, Y new + Z modified.
4. Form fields: `version` (auto-bump from `last_pushed.version`), `changelog`, `active` (default true).
5. On Confirm → `POST /games/{game_id}/mods/{mod_id}/files` multipart with `filedata`, `version`, `changelog`, `active`, `filehash` (md5).
6. Persist response into `sidecar.last_pushed`. Re-derive `syncState`.

### Browse + open any mod

1. `🌐 Browse mods` opens `BrowseModsDialog`.
2. Calls `GET /games/{game_id}/mods?_q=…&_limit=24&_offset=…` (api_key query, no auth required).
3. Card grid of mod summaries (logo, name, summary, tags, profile_url).
4. Click → "Open this mod as a project". Confirms with the user, then:
   - `GET mod.modfile.download.binary_url` (mod.io returns a presigned URL) → fetch ZIP.
   - Unpack the ZIP (we reuse `web/src/persistence/draftStore`'s draft mechanism + in-memory tree the way the starter-project HttpDataSource does — but synthesised from the ZIP entries).
   - Hand off to `definitionsStore.loadFromManifest()` (existing) with an `HttpDataSource`-like adapter built around an in-memory map.
   - Result: editor is now showing that mod, read-only until the user picks Save As.

### Sync state

A pure function of `(sidecar, packedMd5, remoteMod.modfile.filehash.md5, remoteMod.date_updated)`:

| Condition | State |
| --- | --- |
| `sidecar.mod_id == null` | `unbound` |
| `packedMd5 == sidecar.last_pushed.md5 == remoteMd5` | `clean` |
| `packedMd5 != sidecar.last_pushed.md5` | `local-newer` |
| `remoteMd5 != sidecar.last_pushed.md5 && packedMd5 == sidecar.last_pushed.md5` | `remote-newer` |
| otherwise (both differ) | `unknown` |

Header shows a small `SyncChip` with these states. Re-derived after every edit (debounced) and after every fetch.

## Errors

`client.ts` wraps every response. On non-2xx it parses `{ error: { code, error_ref, message, errors? } }`, throws `ModioError(code, error_ref, message, fieldErrors)`. UI surfaces:

- `401` + `error_ref >= 11000` → "Session expired. Please sign in again." + clear token.
- `403` + `15006` → "You don't have permission to push to this mod."
- `422` validation → render `fieldErrors` next to the offending form fields.
- `429` → retry once after `Retry-After` seconds; second 429 shows a rate-limited toast.
- Unknown → "mod.io error: <message>".

## Testing

- `md5.test.ts` — known-answer tests (RFC 1321 vectors).
- `zip.test.ts` — pack one file, validate local-header signature + central directory length.
- `packer.test.ts` — given fake starter + fake records, only modified records appear in the output; `mod.json` is present; md5 stable.
- `sidecar.test.ts` — round-trip; tolerate missing fields; migrate `schema_version` forward.
- `client.test.ts` — mocks `fetch` to verify bearer + headers + `Retry-After` backoff + error parsing.
- `modIoStore.test.ts` — sync state derivation across cases; sign-in state machine; logout clears storage.

Live API calls are not part of CI — manual smoke from the dev server.

## Open items / future work

- Multipart upload UI (for if a mod ever exceeds 100 MB; unlikely for JSON-only mods).
- Mod logo cropping / preview (V1 just accepts whatever the user supplies, server resizes).
- Events polling (`GET /games/{id}/mods/events`) for "remote changed" notifications.
- Sign-in with mod.io OIDC popup as an alternative to email-code.

## Sources

- mod.io REST API reference: <https://docs.mod.io/restapiref/>
- Getting started + auth flows: <https://docs.mod.io/restapi/docs/restapi-getting-started/>
- Add Mod: <https://docs.mod.io/restapi/docs/add-mod>
- Add Modfile: <https://docs.mod.io/restapi/docs/add-modfile>
- Mod Object schema: <https://docs.mod.io/restapi/docs/schemas/mod-object>
- Modfile Object schema: <https://docs.mod.io/restapi/docs/schemas/modfile-object>
- CORS verified live 2026-05-14 (api.mod.io returns `access-control-allow-origin: *`).
