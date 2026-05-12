#!/usr/bin/env node
// Mirror the source Definitions/ tree into:
//   - web/public/schema/                (.class-hierarchy.json, .property-meta.json)
//   - web/public/starter-project/       (per-folder data + manifest.json)
// Also continues to emit web/public/base-definitions/ for the legacy path
// during the migration (Task 14 removes that).

import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WEB = join(__dirname, '..');
const SCHEMA_DIR = join(REPO_WEB, 'public', 'schema');
const STARTER_DIR = join(REPO_WEB, 'public', 'starter-project');
const LEGACY_DIR = join(REPO_WEB, 'public', 'base-definitions');
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
    await ensureDir(SCHEMA_DIR);
    await ensureDir(STARTER_DIR);
    await ensureDir(LEGACY_DIR);
    const empty = { folders: [], files: [], generatedAt: new Date().toISOString(), source: SRC };
    await writeFile(join(STARTER_DIR, 'manifest.json'), JSON.stringify(empty, null, 2));
    await writeFile(
      join(LEGACY_DIR, 'manifest.json'),
      JSON.stringify({ ...empty, sidecars: { hierarchy: false, propertyMeta: false } }, null, 2),
    );
    return;
  }

  await ensureDir(SCHEMA_DIR);
  await ensureDir(STARTER_DIR);
  await ensureDir(LEGACY_DIR);

  const folders = [];
  const files = [];
  let hierarchyPresent = false;
  let propertyMetaPresent = false;

  const entries = await readdir(SRC, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isFile()) {
      if (name === '.class-hierarchy.json') {
        await copyFile(join(SRC, name), join(SCHEMA_DIR, 'class-hierarchy.json'));
        await copyFile(join(SRC, name), join(LEGACY_DIR, name));
        hierarchyPresent = true;
      } else if (name === '.property-meta.json') {
        await copyFile(join(SRC, name), join(SCHEMA_DIR, 'property-meta.json'));
        await copyFile(join(SRC, name), join(LEGACY_DIR, name));
        propertyMetaPresent = true;
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (name.startsWith('.')) continue;
    if (isLayoutFolder(name)) continue;

    const folderSrc = join(SRC, name);
    const starterDst = join(STARTER_DIR, name);
    const legacyDst = join(LEGACY_DIR, name);
    await ensureDir(starterDst);
    await ensureDir(legacyDst);
    folders.push(name);

    const ids = [];
    const folderEntries = await readdir(folderSrc, { withFileTypes: true });
    for (const fe of folderEntries) {
      if (!fe.isFile()) continue;
      if (!fe.name.toLowerCase().endsWith('.json')) continue;
      const id = fe.name.replace(/\.json$/i, '');
      await copyFile(join(folderSrc, fe.name), join(starterDst, fe.name));
      await copyFile(join(folderSrc, fe.name), join(legacyDst, fe.name));
      ids.push(id);
    }
    ids.sort();
    files.push({ folder: name, ids });
  }

  folders.sort();
  files.sort((a, b) => a.folder.localeCompare(b.folder));

  const starterManifest = {
    folders,
    files,
    generatedAt: new Date().toISOString(),
    source: SRC,
  };
  await writeFile(
    join(STARTER_DIR, 'manifest.json'),
    JSON.stringify(starterManifest, null, 2),
  );

  const legacyManifest = {
    ...starterManifest,
    sidecars: { hierarchy: hierarchyPresent, propertyMeta: propertyMetaPresent },
  };
  await writeFile(
    join(LEGACY_DIR, 'manifest.json'),
    JSON.stringify(legacyManifest, null, 2),
  );

  const totalFiles = files.reduce((n, f) => n + f.ids.length, 0);
  console.log(`[sync-defaults] wrote ${totalFiles} files to schema/, starter-project/, and base-definitions/`);
}

main().catch((e) => {
  console.error('[sync-defaults] failed:', e);
  process.exit(1);
});
