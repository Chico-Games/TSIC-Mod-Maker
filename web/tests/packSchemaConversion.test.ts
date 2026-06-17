import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpDataSource } from '../src/persistence/dataSource';
import { PACK_DIR, PACK_AVAILABLE } from './packDir';

// Regression guard for the "every attribute renders unknown(?)" bug.
//
// The game ships **lean** JSON (raw values). The editor converts lean→envelope
// at the DataSource boundary using the pack's `_schema.json`. If that sidecar
// is missing, the converter silently no-ops (its "legacy envelope pack"
// fallback) and every property reaches the UI as a raw value, where TypedField
// draws it as `unknown(?)`.
//
// These tests run against the canonical exported pack (see packDir.ts). They
// guard two things: the export keeps emitting `_schema.json`, and the converter
// turns a real lean record into typed envelopes end to end.

const skip = !PACK_AVAILABLE && `pack not found at ${PACK_DIR}`;

/** A fetch that serves the on-disk pack, exactly as the HTTP loader would over
 *  the dev server. The HttpDataSource base url is irrelevant — we map anything
 *  after the base segment onto the pack directory. */
const localFetcher = (async (url: any) => {
  const u = String(url);
  const marker = '/pack/';
  const i = u.indexOf(marker);
  if (i < 0) return new Response('', { status: 404 });
  const rel = u.slice(i + marker.length);
  try {
    return new Response(readFileSync(join(PACK_DIR, rel), 'utf8'));
  } catch {
    return new Response('', { status: 404 });
  }
}) as unknown as typeof fetch;

test('pack ships _schema.json for lean→envelope conversion', { skip }, () => {
  const schema = JSON.parse(readFileSync(join(PACK_DIR, '_schema.json'), 'utf8'));
  assert.ok(schema.classes && typeof schema.classes === 'object', 'schema has classes');
  assert.ok(Object.keys(schema.classes).length > 0, 'schema lists at least one class');
});

test('HttpDataSource converts a lean record into typed envelopes', { skip }, async () => {
  const ds = new HttpDataSource('/pack', localFetcher);
  const text = await ds.readFile('constructable_item_definitions', 'ID_Aircon_CI');
  const j = JSON.parse(text);
  const p = j.properties;

  // Every value must arrive as a typed envelope (`{type, value, …}`), never a
  // raw scalar — a raw scalar is what makes the UI render `unknown(?)`.
  const isEnvelope = (v: any) =>
    v != null && typeof v === 'object' && !Array.isArray(v) && typeof v.type === 'string';

  for (const [k, v] of Object.entries(p)) {
    assert.ok(isEnvelope(v), `property "${k}" should be a typed envelope, got ${JSON.stringify(v)}`);
  }

  // description is an FText UPROPERTY → 'text' envelope (string-like).
  assert.ok(['text', 'string', 'name'].includes(p.description.type));
  assert.equal(p.description.value, 'Store furniture.');
  assert.equal(p.stackable.type, 'bool');
  assert.equal(p.stackable.value, true);
  assert.equal(p.weight.type, 'float');
  // furniture_to_construct is a UObject/definition reference, not a raw string.
  assert.ok(['definition_ref', 'soft_asset_ref'].includes(p.furniture_to_construct.type));
  assert.equal(p.furniture_to_construct.value, 'FD_Aircon_DF');
});
