// Browse / search / paginate / paste-link E2E against real mod.io.
//
// Creates N visible test mods (with logos + tiny modfiles so they're real
// browseable mods), exercises pagination, search, sort, and paste-link
// resolution, then cleans up all created mods.
//
// Gated on MODIO_E2E_TOKEN — same as modioE2E.test.ts. Loaded via
// `web/scripts/run-modio-e2e.mjs` so the token never enters shell history.
//
// IMPORTANT: All mods are created visible=1 (so the public listing test is
// meaningful). Names are prefixed with a unique 10-char nonce to (a) make
// them obviously test-data and (b) make our search-by-prefix assertion
// reliable. Cleanup is best-effort but runs both as a test step and in
// after() as a safety net.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type ModioClient } from '../src/modio/client';
import { configFromEnv } from '../src/modio/config';
import {
  addMod,
  addModfile,
  deleteMod,
  getMod,
  getModByNameId,
  listMods,
} from '../src/modio/endpoints';
import { buildDeltaZip, serializeRecord, type StarterCatalog } from '../src/modio/packer';
import { parseModioRef } from '../src/modio/parseRef';
import { generateLogoPng } from './_modioFixtures';
import type { DefinitionRecord } from '../src/store/definitionsStore';
import type { ModioMod } from '../src/modio/types';

const TOKEN = process.env.MODIO_E2E_TOKEN ?? '';
const GAME_ID = process.env.VITE_MODIO_GAME_ID ?? process.env.MODIO_E2E_GAME_ID ?? '13031';
const API_KEY = process.env.VITE_MODIO_API_KEY ?? process.env.MODIO_E2E_API_KEY ?? 'c35fe12fe8c046abcb29e5382953fec4';
const ENV = (process.env.MODIO_E2E_ENV ?? process.env.VITE_MODIO_ENV ?? 'live') as 'live' | 'test';

const SKIP = !TOKEN;
if (SKIP) console.log('[modioBrowseE2E] MODIO_E2E_TOKEN not set — skipping.');

const cfg = configFromEnv({ VITE_MODIO_GAME_ID: GAME_ID, VITE_MODIO_API_KEY: API_KEY, VITE_MODIO_ENV: ENV });
let client: ModioClient | null = null;

const NONCE = Math.random().toString(36).slice(2, 12); // 10-char prefix
const N_MODS = 5;
const created: ModioMod[] = [];

function rec(folder: string, id: string, json: any): DefinitionRecord {
  const text = JSON.stringify(json, null, 2) + '\n';
  return { folder, id, json, originalText: text, diskId: id, diskFolder: folder };
}

async function tinyZip(seed: string) {
  const starter: StarterCatalog = new Map();
  const records = [rec('consumable_definitions', `ID_${seed}_CN`, { id: `ID_${seed}_CN`, properties: { tag: seed } })];
  return buildDeltaZip(records, starter, { editorVersion: 'browse-e2e', baseSource: 'fixture' });
}

before(async () => {
  if (SKIP) return;
  assert.ok(cfg, 'configFromEnv must build a config');
  client = createClient(cfg!, () => TOKEN);

  console.log(`[modioBrowseE2E] creating ${N_MODS} test mods with prefix "${NONCE}"`);
  // Different colour per mod so the logos are distinguishable.
  const colours: [number, number, number][] = [
    [220, 50, 50], [50, 180, 80], [60, 100, 220], [220, 180, 40], [180, 60, 200], [50, 200, 200],
  ];
  for (let i = 0; i < N_MODS; i++) {
    const idx = i + 1;
    const name = `ZZZ-E2E-${NONCE}-${String(idx).padStart(2, '0')}`;
    const logo = generateLogoPng(512, 288, colours[i % colours.length]);
    const blob = new Blob([logo as BlobPart], { type: 'image/png' });
    const mod = await addMod(client!, {
      logo: blob,
      name,
      summary: `Automated browse-test mod ${idx}/${N_MODS}. Safe to delete; auto-cleaned by E2E.`,
      description: `Mod ${idx} created by the editor's browse-E2E test. Will be deleted at end of run.`,
      visible: 1, // PUBLIC so listMods includes it
      tags: [],
    });
    // Upload a tiny modfile so the mod has an active file and is "openable".
    const pack = await tinyZip(`Seed${idx}_${NONCE}`);
    await addModfile(client!, mod.id, {
      filedata: pack.blob,
      filehash: pack.md5,
      version: `0.0.${idx}`,
      changelog: 'browse-e2e seed',
      active: true,
    });
    created.push(mod);
    console.log(`  + created mod ${mod.id} ${mod.name_id}`);
  }
});

after(async () => {
  if (SKIP || !client) return;
  for (const m of created) {
    try {
      await deleteMod(client, m.id);
      console.log(`  - deleted mod ${m.id}`);
    } catch (e) {
      console.warn(`  - cleanup failed for mod ${m.id}:`, (e as Error).message);
    }
  }
});

// --- Sanity: did we actually create them? ---

test('browse E2E: all test mods are returned by /me/mods (owner view)', { skip: SKIP }, async () => {
  // /me/mods sees them regardless of indexing latency on the public listing.
  // First-page result_total should be at least N_MODS (the account may have
  // other mods too).
  const r = await listMods(client!, { q: `ZZZ-E2E-${NONCE}`, limit: 100, sort: 'name' });
  // Public listing may have slight indexing delay — wait briefly if short.
  let total = r.result_count;
  let mods = r.data;
  for (let i = 0; i < 5 && total < N_MODS; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const again = await listMods(client!, { q: `ZZZ-E2E-${NONCE}`, limit: 100, sort: 'name' });
    total = again.result_count;
    mods = again.data;
  }
  assert.ok(total >= N_MODS, `expected ≥${N_MODS} mods, got ${total}`);
  for (const m of created) {
    assert.ok(mods.find((x) => x.id === m.id), `mod ${m.id} should be in listing`);
  }
});

// --- Pagination ---

test('browse E2E: pagination — limit=2 returns 2 per page, exhausts after all', { skip: SKIP }, async () => {
  const q = `ZZZ-E2E-${NONCE}`;
  const seenIds = new Set<number>();
  let offset = 0;
  const PAGE = 2;
  let total = 0;
  let pages = 0;
  for (;;) {
    const r = await listMods(client!, { q, limit: PAGE, offset, sort: 'name' });
    total = r.result_total;
    for (const m of r.data) seenIds.add(m.id);
    pages++;
    if (r.data.length < PAGE) break;
    offset += PAGE;
    if (pages > 20) throw new Error('pagination runaway');
  }
  assert.equal(total, N_MODS, `result_total must be ${N_MODS}`);
  assert.equal(seenIds.size, N_MODS, `must have walked all ${N_MODS} unique mods`);
  // With N_MODS=5 and PAGE=2: pages = ceil(5/2) + 1 (the final under-full one) = 3.
  // But the loop also runs one extra iteration when the LAST page is exactly full,
  // so we don't pin the page count too tightly.
  assert.ok(pages >= Math.ceil(N_MODS / PAGE), `pages should be ≥ ${Math.ceil(N_MODS / PAGE)}, got ${pages}`);
});

// --- Search ---

test('browse E2E: search by full nonce — only our mods match', { skip: SKIP }, async () => {
  const r = await listMods(client!, { q: NONCE, limit: 50 });
  assert.equal(r.result_total, N_MODS);
  for (const m of r.data) {
    assert.ok(m.name.includes(NONCE), `each match should contain the nonce; got "${m.name}"`);
  }
});

test('browse E2E: search by partial token tokenizes (OR)', { skip: SKIP }, async () => {
  // _q is OR-tokenized per mod.io docs — "ZZZ-E2E" + a real other word should
  // still include our mods (since they match "ZZZ-E2E").
  const r = await listMods(client!, { q: `ZZZ-E2E ${NONCE}`, limit: 50 });
  // All of ours should still appear.
  for (const m of created) {
    assert.ok(r.data.find((x) => x.id === m.id), `mod ${m.id} should match`);
  }
});

test('browse E2E: case-insensitive search', { skip: SKIP }, async () => {
  const lower = NONCE.toLowerCase();
  const upper = NONCE.toUpperCase();
  const a = await listMods(client!, { q: lower, limit: 50 });
  const b = await listMods(client!, { q: upper, limit: 50 });
  assert.equal(a.result_total, b.result_total);
});

// --- Sort ---

test('browse E2E: sort by name (asc vs desc) returns reversed order', { skip: SKIP }, async () => {
  const asc = await listMods(client!, { q: NONCE, limit: 50, sort: 'name' });
  const desc = await listMods(client!, { q: NONCE, limit: 50, sort: '-name' });
  assert.equal(asc.data.length, desc.data.length);
  // First of asc and last of desc should be the same record.
  assert.equal(asc.data[0].id, desc.data[desc.data.length - 1].id);
});

// --- name_id / paste-link resolution ---

test('browse E2E: getModByNameId resolves the canonical slug', { skip: SKIP }, async () => {
  const target = created[0];
  const found = await getModByNameId(client!, target.name_id);
  assert.ok(found);
  assert.equal(found!.id, target.id);
});

test('browse E2E: getModByNameId returns null for unknown slug', { skip: SKIP }, async () => {
  const found = await getModByNameId(client!, `definitely-not-a-real-slug-${NONCE}-xyz`);
  assert.equal(found, null);
});

test('browse E2E: parseRef + getModByNameId resolves a full profile URL', { skip: SKIP }, async () => {
  const target = created[1];
  const url = target.profile_url;
  const ref = parseModioRef(url);
  assert.ok(ref);
  assert.equal(ref!.kind, 'url');
  const slug = (ref as { modSlug: string }).modSlug;
  const found = await getModByNameId(client!, slug);
  assert.ok(found);
  assert.equal(found!.id, target.id);
});

test('browse E2E: parseRef + getMod resolves a numeric id', { skip: SKIP }, async () => {
  const target = created[2];
  const ref = parseModioRef(String(target.id));
  assert.ok(ref);
  assert.equal(ref!.kind, 'id');
  const found = await getMod(client!, (ref as { modId: number }).modId);
  assert.equal(found.id, target.id);
});

test('browse E2E: parseRef + getModByNameId resolves a bare slug', { skip: SKIP }, async () => {
  const target = created[3];
  const ref = parseModioRef(target.name_id);
  assert.ok(ref);
  assert.equal(ref!.kind, 'slug');
  const found = await getModByNameId(client!, (ref as { modSlug: string }).modSlug);
  assert.ok(found);
  assert.equal(found!.id, target.id);
});

// --- Download via paste-link path ---

test('browse E2E: pasted ID → fetch + download modfile', { skip: SKIP }, async () => {
  const target = created[4];
  // Re-fetch to populate modfile.download URL (mod.io may take a beat).
  let mod = await getMod(client!, target.id);
  for (let i = 0; i < 5 && !mod.modfile?.download?.binary_url; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    mod = await getMod(client!, target.id);
  }
  assert.ok(mod.modfile?.download?.binary_url, 'modfile must expose a download URL');
  const dl = await fetch(mod.modfile!.download!.binary_url);
  assert.equal(dl.status, 200);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  // Sanity: should be a ZIP (PKZIP signature)
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});
