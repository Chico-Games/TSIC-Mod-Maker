import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, makeZip, readZip, readZipAsync } from '../src/modio/zip';

test('crc32: known answers', () => {
  const enc = new TextEncoder();
  // Reference values from common CRC-32 (IEEE) implementations.
  assert.equal(crc32(enc.encode('')), 0);
  assert.equal(crc32(enc.encode('abc')) >>> 0, 0x352441c2);
  assert.equal(
    crc32(enc.encode('The quick brown fox jumps over the lazy dog')) >>> 0,
    0x414fa339,
  );
});

test('makeZip: produces a parseable archive', async () => {
  const enc = new TextEncoder();
  const zip = makeZip([
    { path: 'mod.json', data: enc.encode('{"a":1}') },
    { path: 'items/A.json', data: enc.encode('{"id":"A"}') },
  ]);
  const buf = await zip.arrayBuffer();
  const out = readZip(buf);
  assert.ok(out, 'readZip should not return null');
  assert.equal(out!.length, 2);
  const m = new Map(out!.map((e) => [e.path, new TextDecoder().decode(e.data)]));
  assert.equal(m.get('mod.json'), '{"a":1}');
  assert.equal(m.get('items/A.json'), '{"id":"A"}');
});

test('makeZip: empty archive', async () => {
  const zip = makeZip([]);
  assert.ok(zip.size >= 22, 'EOCD record at minimum');
  const buf = await zip.arrayBuffer();
  const out = readZip(buf);
  assert.ok(out !== null);
  assert.equal(out!.length, 0);
});

test('readZipAsync: same as sync for store-only', async () => {
  const enc = new TextEncoder();
  const zip = makeZip([{ path: 'x.json', data: enc.encode('hello') }]);
  const buf = await zip.arrayBuffer();
  const out = await readZipAsync(buf);
  assert.ok(out !== null);
  assert.equal(out!.length, 1);
  assert.equal(new TextDecoder().decode(out![0].data), 'hello');
});
