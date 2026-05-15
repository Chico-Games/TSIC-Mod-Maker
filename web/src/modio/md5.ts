// MD5 implementation in pure TypeScript. Returns a 32-character lowercase
// hex digest. mod.io's modfile `filehash.md5` field requires MD5 specifically,
// so we cannot use SubtleCrypto (which only ships SHA-* in browsers).
//
// Algorithm follows RFC 1321 (1992). Verified against the standard test
// vectors in modioMd5.test.ts.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function md5Block(state: Uint32Array, x: Uint32Array): void {
  let a = state[0], b = state[1], c = state[2], d = state[3];
  for (let i = 0; i < 64; i++) {
    let f: number, g: number;
    if (i < 16) {
      f = (b & c) | (~b & d);
      g = i;
    } else if (i < 32) {
      f = (d & b) | (~d & c);
      g = (5 * i + 1) & 15;
    } else if (i < 48) {
      f = b ^ c ^ d;
      g = (3 * i + 5) & 15;
    } else {
      f = c ^ (b | ~d);
      g = (7 * i) & 15;
    }
    f = (f + a + K[i] + x[g]) >>> 0;
    a = d;
    d = c;
    c = b;
    b = (b + rotl(f, S[i])) >>> 0;
  }
  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
}

function toHex(state: Uint32Array): string {
  const bytes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const v = state[i];
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function md5(data: Uint8Array): string {
  const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  const totalBits = BigInt(data.length) * 8n;
  // Process full 64-byte blocks
  const fullBlocks = Math.floor(data.length / 64);
  const x = new Uint32Array(16);
  for (let i = 0; i < fullBlocks; i++) {
    const off = i * 64;
    for (let j = 0; j < 16; j++) {
      x[j] = (data[off + j * 4]) |
        (data[off + j * 4 + 1] << 8) |
        (data[off + j * 4 + 2] << 16) |
        (data[off + j * 4 + 3] << 24);
      x[j] = x[j] >>> 0;
    }
    md5Block(state, x);
  }
  // Tail block(s): copy remainder, append 0x80, pad to 56 bytes, then 64-bit length.
  const remStart = fullBlocks * 64;
  const remLen = data.length - remStart;
  const tail = new Uint8Array(remLen < 56 ? 64 : 128);
  for (let i = 0; i < remLen; i++) tail[i] = data[remStart + i];
  tail[remLen] = 0x80;
  const lenBytes = tail.length - 8;
  // little-endian 64-bit length in bits
  let n = totalBits;
  for (let i = 0; i < 8; i++) {
    tail[lenBytes + i] = Number(n & 0xffn);
    n >>= 8n;
  }
  // Process tail block(s).
  for (let off = 0; off < tail.length; off += 64) {
    for (let j = 0; j < 16; j++) {
      x[j] = (tail[off + j * 4]) |
        (tail[off + j * 4 + 1] << 8) |
        (tail[off + j * 4 + 2] << 16) |
        (tail[off + j * 4 + 3] << 24);
      x[j] = x[j] >>> 0;
    }
    md5Block(state, x);
  }
  return toHex(state);
}

export async function md5OfBlob(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return md5(buf);
}
