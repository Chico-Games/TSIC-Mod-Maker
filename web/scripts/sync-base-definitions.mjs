#!/usr/bin/env node
// Mirror the source Definitions/ tree into web/public/base-definitions/.
// Run via `npm run sync-defaults`. Skips ^layout folders (matches the
// editor's read path). Emits a manifest.json so the browser can fetch
// each file without needing a server-side directory listing.

import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WEB = join(__dirname, '..');
const PUBLIC_DIR = join(REPO_WEB, 'public', 'base-definitions');
const SRC = process.env.TSIC_DEFINITIONS_SRC
  ?? 'C:\\Users\\Administrator\\Documents\\Unreal Projects\\TSIC\\Tools\\Export\\test-output\\Definitions';

function isLayoutFolder(name) {
  return /^layout/.test(name);
}

async function ensureDir(p) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

async function copyFile(src, dst) {
  const data = await readFile(src);
  await writeFile(dst, data);
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-defaults] source not found: ${SRC}`);
    console.error('Set TSIC_DEFINITIONS_SRC to override. Skipping (no bundled defaults will be available).');
    // Still emit an empty manifest so the build doesn't fail.
    await ensureDir(PUBLIC_DIR);
    await writeFile(
      join(PUBLIC_DIR, 'manifest.json'),
      JSON.stringify({ folders: [], files: [], sidecars: { hierarchy: false, propertyMeta: false } }, null, 2),
    );
    return;
  }
  await ensureDir(PUBLIC_DIR);

  const folders = [];
  const files = [];
  let hierarchyPresent = false;
  let propertyMetaPresent = false;

  const entries = await readdir(SRC, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isFile()) {
      if (name === '.class-hierarchy.json') {
        await copyFile(join(SRC, name), join(PUBLIC_DIR, name));
        hierarchyPresent = true;
      } else if (name === '.property-meta.json') {
        await copyFile(join(SRC, name), join(PUBLIC_DIR, name));
        propertyMetaPresent = true;
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (name.startsWith('.')) continue;
    if (isLayoutFolder(name)) continue;

    const folderSrc = join(SRC, name);
    const folderDst = join(PUBLIC_DIR, name);
    await ensureDir(folderDst);
    folders.push(name);

    const ids = [];
    const folderEntries = await readdir(folderSrc, { withFileTypes: true });
    for (const fe of folderEntries) {
      if (!fe.isFile()) continue;
      if (!fe.name.toLowerCase().endsWith('.json')) continue;
      const id = fe.name.replace(/\.json$/i, '');
      await copyFile(join(folderSrc, fe.name), join(folderDst, fe.name));
      ids.push(id);
    }
    ids.sort();
    files.push({ folder: name, ids });
  }

  folders.sort();
  files.sort((a, b) => a.folder.localeCompare(b.folder));

  const manifest = {
    folders,
    files,
    sidecars: { hierarchy: hierarchyPresent, propertyMeta: propertyMetaPresent },
    generatedAt: new Date().toISOString(),
    source: SRC,
  };
  await writeFile(join(PUBLIC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const totalFiles = files.reduce((n, f) => n + f.ids.length, 0);
  console.log(`[sync-defaults] wrote ${totalFiles} files across ${folders.length} folders to ${PUBLIC_DIR}`);
}

main().catch((e) => {
  console.error('[sync-defaults] failed:', e);
  process.exit(1);
});
