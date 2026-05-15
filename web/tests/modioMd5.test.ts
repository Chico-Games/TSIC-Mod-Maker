import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5 } from '../src/modio/md5';

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function nodeMd5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

test('md5: RFC 1321 vectors', () => {
  // Standard test vectors from the RFC.
  assert.equal(md5(bytes('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5(bytes('a')), '0cc175b9c0f1b6a831c399e269772661');
  assert.equal(md5(bytes('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5(bytes('message digest')), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(md5(bytes('abcdefghijklmnopqrstuvwxyz')), 'c3fcd3d76192e4007dfb496cca67e13b');
  assert.equal(
    md5(bytes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')),
    'd174ab98d277d9f5a5611c2c9f419d9f',
  );
  assert.equal(
    md5(bytes('12345678901234567890123456789012345678901234567890123456789012345678901234567890')),
    '57edf4a22be3c955ac49da2e2107b67a',
  );
});

test('md5: matches node:crypto across block boundaries (54-129 bytes)', () => {
  // The interesting padding cases are at 55/56 (single vs two-block padding)
  // and 119/120 (two-block boundary). Cross-check against node:crypto for a
  // generous range so anything off-by-one is caught.
  for (let n = 54; n <= 129; n++) {
    const s = 'a'.repeat(n);
    assert.equal(md5(bytes(s)), nodeMd5(s), `mismatch at length ${n}`);
  }
});

test('md5: large input', () => {
  // 10 KB of 'x' — verify it terminates and produces a stable hash.
  const big = 'x'.repeat(10000);
  const h = md5(bytes(big));
  assert.equal(h.length, 32);
  assert.match(h, /^[0-9a-f]{32}$/);
});
