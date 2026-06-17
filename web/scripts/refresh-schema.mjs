#!/usr/bin/env node
/**
 * refresh-schema — sync the web editor's bundled schema + starter-project from
 * a TSIC definition pack, so they never drift behind the game.
 *
 * Why this exists: the editor validates opened projects against the BUNDLED
 * schema in web/public/schema/. Nothing automatically refreshed it from the
 * game, so adding/removing C++ definition classes or properties silently
 * caused "schema drift detected" popups. Run this after a game export.
 *
 * What it does (all standalone — no Unreal Editor needed):
 *   1. property-meta.json — regenerated from C++ headers via the project's
 *      standalone scanner (Tools/Export/scan_property_meta.py). Best-effort:
 *      if Python isn't found, the existing file is kept.
 *   2. class-hierarchy.json — copied from the pack's .class-hierarchy.json,
 *      then SELF-HEALED: any class present in the pack data but missing from
 *      the sidecar is added, with its parent chain derived from the C++
 *      headers. This is exactly the failure mode that bit us (new Input
 *      definition classes), so the refresh fixes it automatically.
 *   3. gameplay-tags.json — copied from the pack's .gameplay-tags.json.
 *   4. starter-project/ — mirrored from the pack (per-asset folders + sidecars,
 *      with .manifest.json -> manifest.json and default.json preserved).
 *   5. A drift self-check over the freshly-packed starter-project. If anything
 *      still drifts, it's reported loudly (usually: re-run the game export,
 *      your pack is stale).
 *
 * Config (env or flags):
 *   TSIC_PROJECT_DIR   default: C:/Users/Administrator/Documents/Unreal Projects/TSIC
 *   TSIC_PACK_DIR      default: <project>/Content/DefinitionPacks/DefaultProject
 *   --source <dir>     overrides the pack dir (e.g. a fresh test-output/Definitions)
 *   --no-scan          skip the Python property-meta regen, keep existing file
 *
 * Usage:  npm run refresh-schema  [-- --source <dir>] [--no-scan]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = dirname(HERE);                    // web/
const WEB_SCHEMA = join(WEB_DIR, 'public', 'schema');
const WEB_STARTER = join(WEB_DIR, 'public', 'starter-project');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const TSIC_PROJECT_DIR = process.env.TSIC_PROJECT_DIR
  || 'C:/Users/Administrator/Documents/Unreal Projects/TSIC';
const PACK_DIR = opt('--source')
  || process.env.TSIC_PACK_DIR
  || join(TSIC_PROJECT_DIR, 'Content', 'DefinitionPacks', 'DefaultProject');
const HEADER_DIR = join(TSIC_PROJECT_DIR, 'Source', 'TSIC', 'Public');
const SCANNER = join(TSIC_PROJECT_DIR, 'Tools', 'Export', 'scan_property_meta.py');
const DO_SCAN = !flag('--no-scan');

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ⚠', ...a);
const die = (msg) => { console.error('\n✖ ' + msg); process.exit(1); };

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJSON = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.'))
    .map((e) => e.name);
}
function listDefFolders(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

// ── pre-flight ─────────────────────────────────────────────────────────────
log(`refresh-schema`);
log(`  pack:    ${PACK_DIR}`);
log(`  headers: ${HEADER_DIR}`);
log(`  -> web/public/schema, web/public/starter-project\n`);

if (!existsSync(PACK_DIR)) die(`pack dir not found: ${PACK_DIR}\n  Set TSIC_PACK_DIR or pass --source <dir>.`);
if (!existsSync(join(PACK_DIR, '.class-hierarchy.json'))) die(`pack is missing .class-hierarchy.json — not a valid export pack.`);
mkdirSync(WEB_SCHEMA, { recursive: true });

// ── 1. property-meta.json (regen from headers, best-effort) ─────────────────
log('1) property-meta.json');
let propertyMetaSrc = null;
if (DO_SCAN && existsSync(SCANNER)) {
  let ran = false;
  for (const py of ['python', 'python3']) {
    const r = spawnSync(py, [SCANNER], { cwd: dirname(SCANNER), encoding: 'utf8' });
    if (r.status === 0) { ran = true; log(`   scanned headers via ${py}: ${(r.stdout || '').trim().split('\n').pop()}`); break; }
  }
  if (ran) {
    const out = join(dirname(SCANNER), 'test-output', 'Definitions', '.property-meta.json');
    if (existsSync(out)) propertyMetaSrc = out;
    else warn('scanner ran but output not found; keeping existing property-meta.json');
  } else {
    warn('Python not found / scanner failed; keeping existing property-meta.json');
  }
} else if (!DO_SCAN) {
  log('   --no-scan: keeping existing property-meta.json');
} else {
  warn(`scanner not found at ${SCANNER}; keeping existing property-meta.json`);
}
// A pack that already ships .property-meta.json wins if the scan didn't run.
if (!propertyMetaSrc && existsSync(join(PACK_DIR, '.property-meta.json'))) {
  propertyMetaSrc = join(PACK_DIR, '.property-meta.json');
}
if (propertyMetaSrc) {
  copyFileSync(propertyMetaSrc, join(WEB_SCHEMA, 'property-meta.json'));
  log(`   wrote property-meta.json (from ${propertyMetaSrc.includes('test-output') ? 'header scan' : 'pack'})`);
}
// Merge editor-side overrides: Blueprint-defined properties that have no C++
// UPROPERTY anywhere in Source/, so the header scanner can't see them. Without
// this they show as schema drift even though the data is valid. Existing
// scanner keys always win; overrides only fill genuine gaps.
const OVERRIDES = join(WEB_SCHEMA, 'property-meta.overrides.json');
if (existsSync(OVERRIDES)) {
  const base = readJSON(join(WEB_SCHEMA, 'property-meta.json'));
  base.properties = base.properties || {};
  let merged = 0;
  for (const [k, v] of Object.entries(readJSON(OVERRIDES).properties || {})) {
    if (!base.properties[k]) { base.properties[k] = v; merged++; }
  }
  if (merged) {
    writeJSON(join(WEB_SCHEMA, 'property-meta.json'), base);
    log(`   merged ${merged} Blueprint-only override(s) from property-meta.overrides.json`);
  }
}
const propertyMeta = readJSON(join(WEB_SCHEMA, 'property-meta.json'));
const pmKeys = new Set(Object.keys(propertyMeta.properties || {}));

// ── header parent map (for self-healing the hierarchy) ──────────────────────
function buildHeaderParentMap() {
  const map = new Map(); // UChild -> UParent
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.h')) {
        const txt = readFileSync(p, 'utf8');
        const re = /class\s+(?:\w+_API\s+)?(U\w+)\s*:\s*public\s+(U\w+)/g;
        let m;
        while ((m = re.exec(txt))) if (!map.has(m[1])) map.set(m[1], m[2]);
      }
    }
  };
  if (existsSync(HEADER_DIR)) walk(HEADER_DIR);
  return map;
}
function resolveChain(cls, parentMap) {
  const chain = [];
  let cur = parentMap.get(cls);
  const seen = new Set([cls]);
  while (cur && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    if (cur === 'UObject') break;
    cur = parentMap.get(cur);
  }
  if (!chain.includes('UDataAsset')) chain.push('UDataAsset');
  if (!chain.includes('UObject')) chain.push('UObject');
  return chain;
}

// ── 2. class-hierarchy.json (copy + self-heal) ──────────────────────────────
log('2) class-hierarchy.json');
const hierarchy = readJSON(join(PACK_DIR, '.class-hierarchy.json'));
hierarchy.classes = hierarchy.classes || {};
// Classes actually used by the pack data, with their folder + count.
const dataClasses = new Map(); // Ufull -> {folder, count}
for (const folder of listDefFolders(PACK_DIR)) {
  for (const name of listJsonFiles(join(PACK_DIR, folder))) {
    let j; try { j = readJSON(join(PACK_DIR, folder, name)); } catch { continue; }
    const c = j.class;
    if (typeof c !== 'string') continue;
    const full = c.startsWith('U') ? c : `U${c}`;
    const e = dataClasses.get(full) || { folder, count: 0 };
    e.count++; dataClasses.set(full, e);
  }
}
const parentMap = buildHeaderParentMap();
let healed = 0;
for (const [full, { folder, count }] of dataClasses) {
  if (hierarchy.classes[full]) continue;
  const parents = resolveChain(full, parentMap);
  hierarchy.classes[full] = { folder, instance_count: count, parents, family_root: full };
  healed++;
  log(`   + self-healed missing class ${full} (parents: ${parents.join(' → ')})`);
}
hierarchy.classes = Object.fromEntries(Object.entries(hierarchy.classes).sort(([a], [b]) => a.localeCompare(b)));
writeJSON(join(WEB_SCHEMA, 'class-hierarchy.json'), hierarchy);
log(`   wrote class-hierarchy.json (${Object.keys(hierarchy.classes).length} classes${healed ? `, ${healed} self-healed` : ''})`);

// ── 3. gameplay-tags.json ───────────────────────────────────────────────────
log('3) gameplay-tags.json');
if (existsSync(join(PACK_DIR, '.gameplay-tags.json'))) {
  copyFileSync(join(PACK_DIR, '.gameplay-tags.json'), join(WEB_SCHEMA, 'gameplay-tags.json'));
  log('   wrote gameplay-tags.json');
} else {
  warn('pack has no .gameplay-tags.json; keeping existing');
}

// ── 4. re-pack starter-project ──────────────────────────────────────────────
log('4) starter-project/');
// Preserve default.json (DefaultProjectMeta) across the wipe.
let defaultJson = null;
if (existsSync(join(WEB_STARTER, 'default.json'))) {
  try { defaultJson = readFileSync(join(WEB_STARTER, 'default.json'), 'utf8'); } catch { /* noop */ }
}
if (existsSync(WEB_STARTER)) rmSync(WEB_STARTER, { recursive: true, force: true });
mkdirSync(WEB_STARTER, { recursive: true });
let folderCount = 0, fileCount = 0;
for (const folder of listDefFolders(PACK_DIR)) {
  const names = listJsonFiles(join(PACK_DIR, folder));
  if (names.length === 0) continue;
  mkdirSync(join(WEB_STARTER, folder), { recursive: true });
  for (const name of names) { copyFileSync(join(PACK_DIR, folder, name), join(WEB_STARTER, folder, name)); fileCount++; }
  folderCount++;
}
// manifest.json — GENERATED in the shape the HTTP loader expects
// ({folders, files:[{folder, ids}]}). The pack's raw .manifest.json has a
// different shape ({assets, asset_catalogs, ...}); copying it verbatim breaks
// loadDefaultProjectFromHttp (`for (const f of manifest.files)` throws).
{
  const folders = [];
  const files = [];
  for (const folder of listDefFolders(WEB_STARTER)) {
    const ids = listJsonFiles(join(WEB_STARTER, folder)).map((n) => n.replace(/\.json$/i, '')).sort();
    if (ids.length === 0) continue;
    folders.push(folder);
    files.push({ folder, ids });
  }
  folders.sort();
  files.sort((a, b) => a.folder.localeCompare(b.folder));
  writeJSON(join(WEB_STARTER, 'manifest.json'), { folders, files });
}
for (const dot of ['.gameplay-tags.json', '.asset-refs.json']) {
  if (existsSync(join(PACK_DIR, dot))) copyFileSync(join(PACK_DIR, dot), join(WEB_STARTER, dot));
}
// _schema.json — REQUIRED by the editor's lean⇆envelope converter. Without it
// the HTTP/FSA DataSource has no schema, leanTextToEnvelope no-ops, and every
// property loads as a raw value (rendered as "unknown(?)"). It is NOT a
// dotfile, so the dot-loop above never caught it.
if (existsSync(join(PACK_DIR, '_schema.json'))) {
  copyFileSync(join(PACK_DIR, '_schema.json'), join(WEB_STARTER, '_schema.json'));
} else {
  warn('pack has no _schema.json — editor will load lean values raw (unknown(?))');
}
if (existsSync(join(PACK_DIR, '.assets'))) cpSync(join(PACK_DIR, '.assets'), join(WEB_STARTER, '.assets'), { recursive: true });
// Restore default.json (or seed one so DefaultProjectMeta has a value).
if (defaultJson != null) writeFileSync(join(WEB_STARTER, 'default.json'), defaultJson);
else writeJSON(join(WEB_STARTER, 'default.json'), { schema_version: 1, version: 0, label: 'Default Project', published_at: new Date(0).toISOString() });
log(`   packed ${fileCount} files across ${folderCount} folders (+ manifest, _schema, tags, asset-refs, .assets, default.json)`);

// ── 5. drift self-check over the packed starter-project ─────────────────────
log('5) drift self-check');
const bare = (n) => (n.startsWith('U') ? n.slice(1) : n);
const chainOf = (full) => [full, ...((hierarchy.classes[full]?.parents) || [])];
const unknownClass = {}; const unknownProp = {};
const structural = []; // missing required fields (id/asset_path/class) the editor blocks on
for (const folder of listDefFolders(WEB_STARTER)) {
  for (const name of listJsonFiles(join(WEB_STARTER, folder))) {
    let j; try { j = readJSON(join(WEB_STARTER, folder, name)); } catch { continue; }
    for (const field of ['id', 'asset_path', 'class']) {
      if (typeof j[field] !== 'string' || !j[field]) structural.push(`${folder}/${name} — missing ${field}`);
    }
    const c = j.class;
    if (typeof c !== 'string') continue;
    const full = c.startsWith('U') ? c : `U${c}`;
    if (!hierarchy.classes[full]) { unknownClass[full] = (unknownClass[full] || 0) + 1; continue; }
    const props = j.properties;
    if (!props || typeof props !== 'object') continue;
    const bc = chainOf(full).map(bare);
    for (const p of Object.keys(props)) {
      if (!bc.some((cc) => pmKeys.has(`${cc}.${p}`))) {
        const k = `${bare(full)}.${p}`;
        unknownProp[k] = (unknownProp[k] || 0) + 1;
      }
    }
  }
}
const nUC = Object.keys(unknownClass).length, nUP = Object.keys(unknownProp).length;
if (structural.length) {
  log(`   STRUCTURAL: ${structural.length} file(s) missing required fields (editor blocks these):`);
  for (const s of structural.slice(0, 20)) log(`     ${s}`);
  if (structural.length > 20) log(`     …and ${structural.length - 20} more`);
}
if (nUC === 0 && nUP === 0 && structural.length === 0) {
  log('   CLEAN — no schema drift, no structural issues.\n');
  log('Done. Hard-reload the editor (Ctrl+Shift+R) to pick up the new schema.');
} else {
  if (nUC || nUP) {
    log(`   DRIFT: ${nUC} unknown-class, ${nUP} unknown-property:`);
    for (const [k, v] of Object.entries(unknownClass)) log(`     unknown-class ${k} (${v})`);
    for (const [k, v] of Object.entries(unknownProp)) log(`     unknown-property ${k} (${v})`);
  }
  console.error('\n⚠ Issues remain. If drift: re-run the in-editor game export. If structural: the pack has files missing id/asset_path/class.');
  process.exit(2);
}
