#!/usr/bin/env node
// Mirror the source Definitions/ tree into:
//   - web/public/schema/          (.class-hierarchy.json, .property-meta.json)
//   - web/public/starter-project/ (per-folder data + manifest.json)

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WEB = join(__dirname, '..');
const SCHEMA_DIR = join(REPO_WEB, 'public', 'schema');
const STARTER_DIR = join(REPO_WEB, 'public', 'starter-project');
const SRC = process.env.TSIC_DEFINITIONS_SRC
  ?? 'C:\\Users\\Administrator\\Documents\\Unreal Projects\\TSIC\\Tools\\Export\\test-output\\Definitions';

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
    const empty = { folders: [], files: [], generatedAt: new Date().toISOString(), source: SRC };
    await writeFile(join(STARTER_DIR, 'manifest.json'), JSON.stringify(empty, null, 2));
    return;
  }

  await ensureDir(SCHEMA_DIR);
  await ensureDir(STARTER_DIR);

  const folders = [];
  const files = [];

  const entries = await readdir(SRC, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isFile()) {
      if (name === '.class-hierarchy.json') {
        await copyFile(join(SRC, name), join(SCHEMA_DIR, 'class-hierarchy.json'));
      } else if (name === '.property-meta.json') {
        await copyFile(join(SRC, name), join(SCHEMA_DIR, 'property-meta.json'));
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (name.startsWith('.')) continue;

    const folderSrc = join(SRC, name);
    const starterDst = join(STARTER_DIR, name);
    await ensureDir(starterDst);
    folders.push(name);

    const ids = [];
    const folderEntries = await readdir(folderSrc, { withFileTypes: true });
    for (const fe of folderEntries) {
      if (!fe.isFile()) continue;
      if (!fe.name.toLowerCase().endsWith('.json')) continue;
      const id = fe.name.replace(/\.json$/i, '');
      await copyFile(join(folderSrc, fe.name), join(starterDst, fe.name));
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

  // Copy populated .gameplay-tags.json (mirror raw — editor reads this directly).
  const tagsSrc = join(SRC, '.gameplay-tags.json');
  if (existsSync(tagsSrc)) {
    await copyFile(tagsSrc, join(STARTER_DIR, '.gameplay-tags.json'));
  }

  // Copy .asset-refs.json (new drift sidecar).
  const refsSrc = join(SRC, '.asset-refs.json');
  if (existsSync(refsSrc)) {
    await copyFile(refsSrc, join(STARTER_DIR, '.asset-refs.json'));
  }

  // Recursive copy of .assets/ (per-class catalogs).
  const assetsSrc = join(SRC, '.assets');
  if (existsSync(assetsSrc)) {
    const assetsDst = join(STARTER_DIR, '.assets');
    await ensureDir(assetsDst);
    for (const file of await readdir(assetsSrc)) {
      if (!file.endsWith('.json')) continue;
      await copyFile(join(assetsSrc, file), join(assetsDst, file));
    }
  }

  // Recursive copy of .thumbnails/ (mesh / material PNGs from Phase 8;
  // no-op when the dir doesn't exist yet).
  const thumbsSrc = join(SRC, '.thumbnails');
  if (existsSync(thumbsSrc)) {
    const thumbsDst = join(STARTER_DIR, '.thumbnails');
    await ensureDir(thumbsDst);
    for (const cls of await readdir(thumbsSrc)) {
      const classSrc = join(thumbsSrc, cls);
      const classDst = join(thumbsDst, cls);
      await ensureDir(classDst);
      for (const file of await readdir(classSrc)) {
        await copyFile(join(classSrc, file), join(classDst, file));
      }
    }
  }

  const totalFiles = files.reduce((n, f) => n + f.ids.length, 0);
  console.log(`[sync-defaults] wrote ${totalFiles} files to schema/ and starter-project/`);
}

main().catch((e) => {
  console.error('[sync-defaults] failed:', e);
  process.exit(1);
});
