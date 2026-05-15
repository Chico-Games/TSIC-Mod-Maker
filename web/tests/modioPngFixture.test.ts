import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLogoPng } from './_modioFixtures';

function crc32(buf: Uint8Array): number {
  // duplicate of zip.ts's table to avoid a re-import detour
  let table = (crc32 as any)._t as number[] | undefined;
  if (!table) {
    table = new Array<number>(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    (crc32 as any)._t = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

test('generateLogoPng: produces a structurally valid PNG with correct CRCs', () => {
  const png = generateLogoPng(512, 288, [255, 128, 64]);
  // 1. Signature
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < SIG.length; i++) {
    assert.equal(png[i], SIG[i], `signature byte ${i}`);
  }
  // 2. Walk chunks and verify CRC + ensure final chunk is IEND
  let p = 8;
  const dv = new DataView(png.buffer);
  const dec = new TextDecoder();
  let sawIHDR = false;
  let sawIDAT = false;
  let sawIEND = false;
  while (p < png.length) {
    const len = dv.getUint32(p, false);
    const type = dec.decode(png.subarray(p + 4, p + 8));
    const dataStart = p + 8;
    const data = png.subarray(dataStart, dataStart + len);
    const fileCrc = dv.getUint32(dataStart + len, false);
    const calcCrc = crc32(png.subarray(p + 4, p + 8 + len));
    assert.equal(fileCrc, calcCrc, `CRC for chunk ${type}`);
    if (type === 'IHDR') {
      sawIHDR = true;
      const w = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
      const h = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, false);
      assert.equal(w, 512, 'width');
      assert.equal(h, 288, 'height');
      assert.equal(data[8], 8, 'bit depth');
      assert.equal(data[9], 2, 'color type RGB');
    }
    if (type === 'IDAT') sawIDAT = true;
    if (type === 'IEND') sawIEND = true;
    p = dataStart + len + 4;
  }
  assert.ok(sawIHDR, 'IHDR chunk present');
  assert.ok(sawIDAT, 'IDAT chunk present');
  assert.ok(sawIEND, 'IEND chunk present');
});

test('generateLogoPng: minimum mod.io size', () => {
  // mod.io requires ≥512×288. Our fixture must hit that exactly.
  const png = generateLogoPng(512, 288, [0, 0, 0]);
  const dv = new DataView(png.buffer);
  assert.equal(dv.getUint32(16, false), 512); // IHDR width
  assert.equal(dv.getUint32(20, false), 288); // IHDR height
});
