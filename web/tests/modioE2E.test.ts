// End-to-end test exercising the real mod.io API.
//
// Skipped unless MODIO_E2E_TOKEN is provided. Tokens are obtained by signing
// into the SPA and reading `tsic.modio.token.v1` from localStorage/sessionStorage.
//
// What this exercises, end-to-end against api.mod.io:
//   1. Build a synthetic "new save" — a fake definitions tree as if the user
//      just created a project. Diff against the bundled starter.
//   2. Pack the delta as a ZIP using the same packer the SPA uses.
//   3. Create a new mod (POST /games/{id}/mods) with a generated logo.
//   4. Upload the modfile (POST /games/{id}/mods/{id}/files).
//   5. Verify by fetching the mod and inspecting modfile.filehash.md5.
//   6. Download the modfile binary, recompute md5, unzip, verify contents.
//   7. Edit mod metadata (POST /games/{id}/mods/{id}).
//   8. Push a second modfile (simulating "edit + re-publish").
//   9. Delete the mod (cleanup; runs in `after` so partial runs still clean).
//
// The test uses the test environment by default (set MODIO_E2E_ENV=live to
// hit production). Even on production, each run uploads under a unique
// name_id so it can't collide with anything else.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient, type ModioClient } from '../src/modio/client';
import { configFromEnv } from '../src/modio/config';
import {
  addDependencies,
  addMod,
  addModfile,
  deleteDependencies,
  deleteMod,
  editMod,
  editModfile,
  getMe,
  getMod,
  getMyMods,
  listDependencies,
  listGameModEvents,
  listModEvents,
  listModfiles,
} from '../src/modio/endpoints';
import { buildDeltaZip, serializeRecord, type StarterCatalog } from '../src/modio/packer';
import { ModioError } from '../src/modio/errors';
import { md5 as md5hex } from '../src/modio/md5';
import { readZipAsync } from '../src/modio/zip';
import { generateLogoPng } from './_modioFixtures';
import type { DefinitionRecord } from '../src/store/definitionsStore';

const TOKEN = process.env.MODIO_E2E_TOKEN ?? '';
const GAME_ID = process.env.VITE_MODIO_GAME_ID ?? process.env.MODIO_E2E_GAME_ID ?? '13031';
const API_KEY = process.env.VITE_MODIO_API_KEY ?? process.env.MODIO_E2E_API_KEY ?? 'c35fe12fe8c046abcb29e5382953fec4';
const ENV = (process.env.MODIO_E2E_ENV ?? process.env.VITE_MODIO_ENV ?? 'live') as 'live' | 'test';

const SKIP = !TOKEN;
if (SKIP) {
  console.log('[modioE2E] MODIO_E2E_TOKEN not set — skipping live mod.io end-to-end tests.');
}

const cfg = configFromEnv({
  VITE_MODIO_GAME_ID: GAME_ID,
  VITE_MODIO_API_KEY: API_KEY,
  VITE_MODIO_ENV: ENV,
});

let client: ModioClient | null = null;
let createdModId: number | null = null;
let createdName = '';

function rec(folder: string, id: string, json: any): DefinitionRecord {
  const text = JSON.stringify(json, null, 2) + '\n';
  return { folder, id, json, originalText: text, diskId: id, diskFolder: folder };
}

function buildStarter(): StarterCatalog {
  const cat: StarterCatalog = new Map();
  cat.set('consumable_definitions/ID_Coffee_CN', serializeRecord(rec('consumable_definitions', 'ID_Coffee_CN', {
    id: 'ID_Coffee_CN',
    class: 'UConsumableDefinition',
    properties: { display_name: 'Coffee', value: 5 },
  })));
  cat.set('craft_recipe_definitions/CR_Coffee', serializeRecord(rec('craft_recipe_definitions', 'CR_Coffee', {
    id: 'CR_Coffee',
    class: 'UCraftRecipeDefinition',
    properties: { time: 10 },
  })));
  return cat;
}

function buildEditedRecords(modifier: string): DefinitionRecord[] {
  // ID_Coffee_CN exists in starter but value changed → modified
  // ID_TestPotion_CN is new → added
  return [
    rec('consumable_definitions', 'ID_Coffee_CN', {
      id: 'ID_Coffee_CN',
      class: 'UConsumableDefinition',
      properties: { display_name: 'Coffee', value: 99, note: modifier },
    }),
    rec('consumable_definitions', 'ID_TestPotion_CN', {
      id: 'ID_TestPotion_CN',
      class: 'UConsumableDefinition',
      properties: { display_name: 'Test Potion', value: 25, note: modifier },
    }),
    rec('craft_recipe_definitions', 'CR_Coffee', {
      id: 'CR_Coffee',
      class: 'UCraftRecipeDefinition',
      properties: { time: 10 }, // unchanged — must be skipped
    }),
  ];
}

before(() => {
  if (SKIP) return;
  assert.ok(cfg, 'configFromEnv must build a config');
  client = createClient(cfg!, () => TOKEN);
});

after(async () => {
  if (SKIP) return;
  if (!createdModId || !client) return;
  try {
    await deleteMod(client, createdModId);
    console.log('[modioE2E] cleanup OK: deleted mod', createdModId);
  } catch (e) {
    if (e instanceof ModioError && (e.http === 404 || e.errorRef === 15022 || e.errorRef === 15023)) {
      // already gone — fine.
      return;
    }
    console.warn('[modioE2E] cleanup error', (e as Error).message);
  }
});

test('E2E: GET /me confirms the supplied token is valid', { skip: SKIP }, async () => {
  const user = await getMe(client!);
  assert.ok(user.id);
  assert.ok(user.username);
  console.log('[modioE2E] signed in as', user.username, `(id=${user.id})`);
});

test('E2E: pack a synthetic project delta produces a valid ZIP', { skip: SKIP }, async () => {
  const starter = buildStarter();
  const records = buildEditedRecords('initial');
  const out = await buildDeltaZip(records, starter, { editorVersion: 'e2e', baseSource: 'fixture' });
  assert.equal(out.added.length, 1, 'one added file (ID_TestPotion_CN)');
  assert.equal(out.modified.length, 1, 'one modified file (ID_Coffee_CN)');
  assert.equal(out.unchangedCount, 1, 'one unchanged (CR_Coffee skipped)');
  // Verify md5 matches Node's reference impl over the same bytes
  const buf = new Uint8Array(await out.blob.arrayBuffer());
  const ref = createHash('md5').update(buf).digest('hex');
  assert.equal(out.md5, ref, 'packer md5 must match node:crypto');
  // Verify ZIP is parseable + contains mod.json + the two expected files
  const entries = await readZipAsync(buf.buffer);
  assert.ok(entries);
  const paths = entries!.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    'consumable_definitions/ID_Coffee_CN.json',
    'consumable_definitions/ID_TestPotion_CN.json',
    'mod.json',
  ]);
});

test('E2E: create new mod with a generated logo', { skip: SKIP }, async () => {
  createdName = `E2E Test Mod ${Date.now()}`;
  const logo = generateLogoPng(512, 288, [80, 140, 220]); // mod.io requires >= 512x288
  const blob = new Blob([logo as BlobPart], { type: 'image/png' });
  const mod = await addMod(client!, {
    logo: blob,
    name: createdName,
    summary: 'Automated end-to-end test mod. Will be deleted at end of run.',
    description: 'This mod is created by the editor\'s E2E test suite. Safe to ignore.',
    visible: 0, // hidden so it doesn't pollute the public listing
    tags: [],
  });
  assert.ok(mod.id, 'mod must have an id');
  createdModId = mod.id;
  assert.equal(mod.name, createdName);
  console.log('[modioE2E] created mod', mod.id, mod.profile_url);
});

let firstModfilePackMd5 = '';

test('E2E: upload initial modfile, server-side filehash matches local md5', { skip: SKIP }, async () => {
  assert.ok(createdModId, 'previous test must have created the mod');
  const starter = buildStarter();
  const records = buildEditedRecords('initial');
  const pack = await buildDeltaZip(records, starter, { editorVersion: 'e2e', baseSource: 'fixture' });
  firstModfilePackMd5 = pack.md5;

  const mf = await addModfile(client!, createdModId!, {
    filedata: pack.blob,
    filehash: pack.md5,
    version: '0.1.0',
    changelog: 'Initial E2E upload',
    active: true,
  });
  assert.ok(mf.id);
  assert.equal(mf.filehash.md5, pack.md5, 'server-reported md5 must match local md5');
  console.log('[modioE2E] uploaded modfile', mf.id, 'md5=', mf.filehash.md5);
});

test('E2E: GET mod shows the uploaded modfile is current', { skip: SKIP }, async () => {
  const mod = await getMod(client!, createdModId!);
  assert.ok(mod.modfile, 'mod must have an active modfile');
  assert.equal(mod.modfile!.filehash.md5, firstModfilePackMd5);
});

test('E2E: download the modfile and verify md5 + contents', { skip: SKIP }, async () => {
  const mod = await getMod(client!, createdModId!);
  // mod.io may take a moment to make the download URL available after upload
  // for very fresh modfiles. Retry briefly.
  let dlUrl: string | null = mod.modfile?.download?.binary_url ?? null;
  for (let i = 0; i < 5 && !dlUrl; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const m2 = await getMod(client!, createdModId!);
    dlUrl = m2.modfile?.download?.binary_url ?? null;
  }
  assert.ok(dlUrl, 'modfile must expose a download URL');

  const r = await fetch(dlUrl!);
  assert.equal(r.status, 200);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const dlMd5 = md5hex(bytes);
  assert.equal(dlMd5, firstModfilePackMd5, 'downloaded blob md5 must match what we uploaded');

  const entries = await readZipAsync(bytes.buffer);
  assert.ok(entries, 'downloaded ZIP must parse');
  const paths = entries!.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    'consumable_definitions/ID_Coffee_CN.json',
    'consumable_definitions/ID_TestPotion_CN.json',
    'mod.json',
  ]);

  // Inspect mod.json content
  const dec = new TextDecoder();
  const manifestEntry = entries!.find((e) => e.path === 'mod.json')!;
  const manifest = JSON.parse(dec.decode(manifestEntry.data));
  assert.equal(manifest.generated_by, 'tsic-definition-editor');
  assert.equal(manifest.files.length, 2);
});

test('E2E: edit mod metadata', { skip: SKIP }, async () => {
  const updated = await editMod(client!, createdModId!, {
    name: createdName + ' (edited)',
    summary: 'Edited summary — confirms editMod works.',
  });
  assert.equal(updated.name, createdName + ' (edited)');
  console.log('[modioE2E] edited mod name to', updated.name);
});

test('E2E: push a second modfile after edit', { skip: SKIP }, async () => {
  const starter = buildStarter();
  const records = buildEditedRecords('second-revision');
  const pack = await buildDeltaZip(records, starter, { editorVersion: 'e2e', baseSource: 'fixture' });
  // Md5 should differ because the embedded "note" changed.
  assert.notEqual(pack.md5, firstModfilePackMd5, 'second pack must differ from first');

  const mf = await addModfile(client!, createdModId!, {
    filedata: pack.blob,
    filehash: pack.md5,
    version: '0.1.1',
    changelog: 'E2E second push — bumped value on ID_Coffee_CN.',
    active: true,
  });
  assert.equal(mf.filehash.md5, pack.md5);
  console.log('[modioE2E] uploaded second modfile', mf.id);

  // Verify the mod's "current" modfile is now the new one.
  const mod = await getMod(client!, createdModId!);
  assert.equal(mod.modfile!.id, mf.id, 'mod.modfile should point at the new active file');
  assert.equal(mod.modfile!.filehash.md5, pack.md5);
});

test('E2E: GET /me/mods includes the just-created (hidden) mod', { skip: SKIP }, async () => {
  // /me/mods returns mods the signed-in user has access to including their
  // own hidden mods. We filter to this game so we don't drag in unrelated mods.
  const r = await getMyMods(client!, { gameId: client!.cfg.gameId, limit: 100 });
  const found = r.data.some((m) => m.id === createdModId);
  assert.ok(found, `mod ${createdModId} should appear in /me/mods`);
});

test('E2E: listModfiles returns both pushed modfiles', { skip: SKIP }, async () => {
  const r = await listModfiles(client!, createdModId!, { limit: 10 });
  assert.ok(r.result_total >= 2, `expected ≥2 modfiles, got ${r.result_total}`);
});

test('E2E: upload draft modfile (active:false) then promote', { skip: SKIP }, async () => {
  // Upload a third modfile but leave active:false to validate the draft path.
  const starter = buildStarter();
  const records = buildEditedRecords('draft-rev');
  const pack = await buildDeltaZip(records, starter, { editorVersion: 'e2e', baseSource: 'fixture' });
  const draft = await addModfile(client!, createdModId!, {
    filedata: pack.blob,
    filehash: pack.md5,
    version: '0.1.2-draft',
    changelog: 'Draft upload — not active yet',
    active: false,
  });
  assert.ok(draft.id);

  // Active modfile should NOT be the draft (still the second push).
  let mod = await getMod(client!, createdModId!);
  assert.notEqual(mod.modfile!.id, draft.id);

  // Promote the draft.
  const promoted = await editModfile(client!, createdModId!, draft.id, { active: true });
  assert.equal(promoted.id, draft.id);

  // Re-fetch the mod; the active modfile must now be the draft.
  mod = await getMod(client!, createdModId!);
  assert.equal(mod.modfile!.id, draft.id, 'promoted draft must now be active');
});

test('E2E: dependencies — server rejects self-loops with 13009', { skip: SKIP }, async () => {
  await assert.rejects(
    addDependencies(client!, createdModId!, [createdModId!]),
    (e: unknown) => {
      const err = e as { http?: number; errorRef?: number; fieldErrors?: Record<string, string> };
      assert.equal(err.http, 422);
      assert.equal(err.errorRef, 13009);
      assert.ok((err.fieldErrors?.dependencies ?? '').toLowerCase().includes('self-reference'));
      return true;
    },
  );
});

test('E2E: dependencies — add another mod, list, then remove', { skip: SKIP }, async () => {
  // Create a tiny throwaway "dependee" mod, depend on it, verify, clean up.
  const depLogo = new Blob([new Uint8Array(await (async () => {
    const { generateLogoPng } = await import('./_modioFixtures');
    return generateLogoPng(512, 288, [100, 100, 100]);
  })()) as BlobPart], { type: 'image/png' });
  const dep = await addMod(client!, {
    logo: depLogo,
    name: `E2E-Dep ${Date.now()}`,
    summary: 'Dependency target for E2E test. Will be deleted at end of run.',
    visible: 0,
  });
  try {
    await addDependencies(client!, createdModId!, [dep.id]);
    const list = await listDependencies(client!, createdModId!);
    assert.ok(list.data.find((d) => d.mod_id === dep.id), 'dependency should appear in list');
    await deleteDependencies(client!, createdModId!, [dep.id]);
    const afterList = await listDependencies(client!, createdModId!);
    assert.equal(afterList.data.find((d) => d.mod_id === dep.id), undefined, 'dependency removed');
  } finally {
    try { await deleteMod(client!, dep.id); } catch { /* ignore */ }
  }
});

test('E2E: mod events history includes our edits/uploads', { skip: SKIP }, async () => {
  const r = await listModEvents(client!, createdModId!, { limit: 50 });
  // We have done: 2 active modfile uploads + 1 metadata edit + 1 draft promote
  // → ≥ 3 events.
  assert.ok(r.data.length >= 3, `expected ≥3 events, got ${r.data.length}`);
  const types = new Set(r.data.map((e) => e.event_type));
  assert.ok(types.has('MODFILE_CHANGED') || types.has('MOD_EDITED'), `expected MODFILE_CHANGED or MOD_EDITED in event types, got ${[...types].join(',')}`);
});

test('E2E: game-wide events endpoint responds', { skip: SKIP }, async () => {
  // Look only at recent events to keep payload small.
  const since = Math.floor(Date.now() / 1000) - 3600;
  const r = await listGameModEvents(client!, { dateAddedMin: since, limit: 10 });
  assert.ok(Array.isArray(r.data));
});

test('E2E: delete the mod (explicit teardown, not the after hook)', { skip: SKIP }, async () => {
  if (!createdModId) return;
  await deleteMod(client!, createdModId);
  // mod.io marks status=3 on DELETE; the resource may still GET but is
  // marked deleted, or it may 404. Both are acceptable.
  try {
    const mod = await getMod(client!, createdModId);
    assert.equal(mod.status, 3, 'mod must be marked deleted (status=3)');
    console.log('[modioE2E] mod', createdModId, 'is now status=3 (deleted)');
  } catch (e) {
    if (e instanceof ModioError && (e.http === 404 || e.errorRef === 15022 || e.errorRef === 15023)) {
      console.log('[modioE2E] mod', createdModId, 'is gone (expected)');
    } else {
      throw e;
    }
  }
  // Belt + braces: clear so the after() hook is a no-op.
  createdModId = null;
});
