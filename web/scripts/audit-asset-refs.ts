// Audit the bundled starter-project for `missing-asset-ref` schema drift, using
// the app's OWN lean→envelope converter and validateAssetRefs — no replication,
// so the result is exactly what the editor's load gate reports.
//
// For every missing ref it also checks whether the asset actually exists in the
// Unreal Content tree, which splits the findings into two very different cases:
//   EXISTS  → real asset the exporter's registry walk failed to catalog
//             (safe to register in schema/asset-catalog.overrides.json)
//   ABSENT  → genuinely dangling reference in the mod data (an upstream data bug;
//             registering it would paper over a broken ref)
//
// Run: npx tsx scripts/audit-asset-refs.ts [--emit-overrides]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { leanPropsToEnvelope, isLeanProperties, type LeanSchema } from '../src/persistence/leanEnvelope.ts';
import { validateAssetRefs } from '../src/persistence/schemaDriftValidator.ts';

const PACK = process.env.BUNDLE || join(import.meta.dirname, '..', 'public', 'starter-project');
const CONTENT = process.env.TSIC_CONTENT
  || 'C:/Users/Administrator/Documents/Unreal Projects/TSIC/Content';

const rj = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const schema = rj(join(PACK, '_schema.json')) as LeanSchema;

// Load every record the way the DataSource does: lean on disk → envelope in memory.
const defs = new Map<any, any>();
for (const folder of readdirSync(PACK)) {
  const fp = join(PACK, folder);
  if (folder.startsWith('.') || !statSync(fp).isDirectory()) continue;
  for (const f of readdirSync(fp)) {
    if (!f.endsWith('.json')) continue;
    const j = rj(join(fp, f));
    if (typeof j?.id !== 'string' || typeof j?.class !== 'string') continue;
    if (j.properties && isLeanProperties(j.properties)) {
      j.properties = leanPropsToEnvelope(j.properties, j.class, schema);
    }
    defs.set(`${folder}/${f.replace(/\.json$/i, '')}`, { json: j });
  }
}

const catalogs = new Map<string, any[]>();
const adir = join(PACK, '.assets');
if (existsSync(adir)) {
  for (const f of readdirSync(adir)) {
    if (!f.endsWith('.json')) continue;
    const c = rj(join(adir, f));
    catalogs.set(f.replace(/\.json$/i, ''), Array.isArray(c.entries) ? c.entries : []);
  }
}
const expectedGuids = existsSync(join(PACK, '.asset-refs.json'))
  ? (rj(join(PACK, '.asset-refs.json')).guids || {}) : {};

const issues = validateAssetRefs(defs as any, catalogs, expectedGuids);
console.log(`records: ${defs.size}   catalogs: ${catalogs.size}   issues: ${issues.length}`);

/** `/Game/A/B/SM_X.SM_X` → Content/A/B/SM_X.uasset */
function onDisk(objectPath: string): string | null {
  const pkg = String(objectPath).split('.')[0];
  if (!pkg.startsWith('/Game/')) return null;
  const rel = pkg.slice('/Game/'.length);
  for (const ext of ['.uasset', '.umap']) {
    const p = join(CONTENT, rel + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

const byKind = new Map<string, number>();
for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1);
for (const [k, n] of byKind) console.log(`   ${k}: ${n}`);

const missing = issues.filter((i) => i.kind === 'missing-asset-ref') as any[];
const distinct = new Map<string, { cls: string; path: string; refs: string[] }>();
for (const m of missing) {
  const k = `${m.assetClass}|${m.path}`;
  if (!distinct.has(k)) distinct.set(k, { cls: m.assetClass, path: m.path, refs: [] });
  distinct.get(k)!.refs.push(m.recordKey);
}

const exists: typeof distinct = new Map();
const absent: typeof distinct = new Map();
for (const [k, v] of distinct) (onDisk(v.path) ? exists : absent).set(k, v);

console.log(`\ndistinct missing assets: ${distinct.size}`);
console.log(`  EXISTS in Content (exporter catalog gap): ${exists.size}`);
console.log(`  ABSENT from Content (dangling ref in data): ${absent.size}`);
if (absent.size) {
  console.log('\n--- ABSENT (needs an upstream data fix, NOT an override) ---');
  for (const v of absent.values()) console.log(`  ${v.cls}  ${v.path}\n      ← ${v.refs.join(', ')}`);
}

if (process.argv.includes('--emit-overrides')) {
  const catalogsOut: Record<string, any[]> = {};
  for (const v of exists.values()) {
    const name = String(v.path).split('.').pop()!;
    const pkg = String(v.path).split('.')[0];
    (catalogsOut[v.cls] ||= []).push({
      path: v.path,
      name,
      folder: pkg.slice(0, pkg.lastIndexOf('/')),
      package_guid: '',
    });
  }
  for (const k of Object.keys(catalogsOut)) {
    catalogsOut[k].sort((a, b) => a.path.localeCompare(b.path));
  }
  const total = Object.values(catalogsOut).reduce((n, a) => n + a.length, 0);
  console.log(`\n--- emitted ${total} verified-on-disk override entries ---`);
  console.log(JSON.stringify(catalogsOut, null, 2));
}
