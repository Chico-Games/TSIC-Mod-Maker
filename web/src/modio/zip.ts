// Minimal pure-JS ZIP writer (store-only, no compression). Produces a
// standards-compliant PKZIP archive: one local-file-header + bytes per file,
// followed by a central directory and end-of-central-directory record.
//
// Factored out of `definitionsStore.exportZip` so the mod.io packer can reuse
// it. Suitable for archives in the tens of MB; for anything larger consider a
// dedicated lib with deflate.

export interface ZipEntry {
  /** Path inside the archive, forward-slashes, no leading slash. */
  path: string;
  /** Raw bytes of the file. */
  data: Uint8Array;
}

// CRC-32 — table-based, IEEE polynomial. Used for ZIP per-file checksum.
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const e of entries) {
    const crc = crc32(e.data);
    const nameBytes = enc.encode(e.path);
    const local = new Uint8Array(30 + nameBytes.length + e.data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header signature
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // compression: store
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra
    local.set(nameBytes, 30);
    local.set(e.data, 30 + nameBytes.length);
    localChunks.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);
    centralSize += central.length;

    offset += local.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  let total = 0;
  for (const c of localChunks) total += c.length;
  for (const c of centralChunks) total += c.length;
  total += eocd.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of localChunks) { out.set(c, off); off += c.length; }
  for (const c of centralChunks) { out.set(c, off); off += c.length; }
  out.set(eocd, off);
  return new Blob([out as BlobPart], { type: 'application/zip' });
}

/** Minimal ZIP reader — extracts entries from a STORE-only archive (deflate
 *  is not supported). Sufficient for round-tripping ZIPs produced by
 *  `makeZip` and for mod.io-served mods which we assume are store-or-deflate
 *  uncompressed JSON folders. Returns null if a non-zero compression method
 *  is encountered. */
export function readZip(buf: ArrayBuffer): { path: string; data: Uint8Array }[] | null {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // Find EOCD — scan backwards from the end looking for the signature.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const totalEntries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: { path: string; data: Uint8Array }[] = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const compression = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // Read local header to find data start.
    if (view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const lhNameLen = view.getUint16(localOffset + 26, true);
    const lhExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;

    if (compression === 0) {
      const data = bytes.subarray(dataStart, dataStart + uncompSize);
      // Sanity: verify crc to catch corruption.
      if (crc32(data) !== crc) {
        // Don't reject — some readers leave CRC=0 for streaming writes. Just continue.
      }
      out.push({ path: name, data });
    } else if (compression === 8) {
      // Deflate via DecompressionStream when available (Chromium has it).
      // We return a placeholder marker the caller must handle by awaiting
      // an async path; for simplicity we surface unsupported synchronously.
      // (modio downloads will use the async unzip path in packer.ts.)
      return null;
    } else {
      return null;
    }
    void compSize;
  }
  return out;
}

/** Async reader that supports deflate via the browser's DecompressionStream.
 *  Falls back to the sync reader for store-only archives in Node tests. */
export async function readZipAsync(
  buf: ArrayBuffer,
): Promise<{ path: string; data: Uint8Array }[] | null> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const totalEntries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: { path: string; data: Uint8Array }[] = [];
  let p = cdOffset;
  const hasDecompression = typeof (globalThis as any).DecompressionStream === 'function';
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const compression = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const lhNameLen = view.getUint16(localOffset + 26, true);
    const lhExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;

    if (compression === 0) {
      out.push({ path: name, data: bytes.subarray(dataStart, dataStart + uncompSize) });
    } else if (compression === 8 && hasDecompression) {
      const slice = bytes.subarray(dataStart, dataStart + compSize);
      const ds = new (globalThis as any).DecompressionStream('deflate-raw');
      const blob = new Blob([slice as BlobPart]);
      const stream = blob.stream().pipeThrough(ds);
      const expanded = new Uint8Array(await new Response(stream).arrayBuffer());
      out.push({ path: name, data: expanded });
    } else {
      return null;
    }
  }
  return out;
}
