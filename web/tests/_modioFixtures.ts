// Test fixtures for mod.io E2E. Pure functions, no I/O.
//
// `generateLogoPng` writes a valid PNG without compression — the deflate
// stream uses only stored (BTYPE=00) blocks, so we don't need to pull in a
// deflate implementation just to make a logo for testing. mod.io requires
// the logo to be ≥512×288.

import { crc32 } from '../src/modio/zip';

function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  // zlib header: CM=8 (deflate), CINFO=7 (32KB window); FLG with FCHECK.
  // 0x78 0x01 = no compression / fastest header (FCHECK ok for 0x78 base).
  out.push(0x78, 0x01);
  let i = 0;
  if (data.length === 0) {
    // empty: emit a single final stored block of length 0.
    out.push(0x01, 0x00, 0x00, 0xff, 0xff);
  }
  while (i < data.length) {
    const remain = data.length - i;
    const len = Math.min(remain, 65535);
    const isLast = i + len === data.length;
    out.push(isLast ? 0x01 : 0x00);
    out.push(len & 0xff, (len >> 8) & 0xff);
    out.push((~len) & 0xff, ((~len) >> 8) & 0xff);
    for (let j = 0; j < len; j++) out.push(data[i + j]);
    i += len;
  }
  const a = adler32(data);
  out.push((a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff);
  return new Uint8Array(out);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const typeBytes = enc.encode(type);
  const len = data.length;
  const out = new Uint8Array(8 + len + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len, false); // big-endian length
  out.set(typeBytes, 4);
  out.set(data, 8);
  // CRC is over type+data (NOT length)
  const crcBuf = new Uint8Array(4 + len);
  crcBuf.set(typeBytes, 0);
  crcBuf.set(data, 4);
  dv.setUint32(8 + len, crc32(crcBuf), false); // big-endian
  return out;
}

/** Produce a solid-colour RGB PNG of `width` × `height`. */
export function generateLogoPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: 13 bytes
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 = RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: standard
  ihdr[12] = 0; // interlace: none

  // Image data: per scanline = 1 filter byte + width*3 RGB bytes
  const rowLen = 1 + width * 3;
  const raw = new Uint8Array(rowLen * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = rgb[0];
      raw[off + 2 + x * 3] = rgb[1];
      raw[off + 3 + x * 3] = rgb[2];
    }
  }
  const idat = zlibStore(raw);

  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', idat);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(sig, off); off += sig.length;
  out.set(ihdrChunk, off); off += ihdrChunk.length;
  out.set(idatChunk, off); off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}
