// Measure the REAL impact of each stale pack sidecar, so "do we need a full
// in-editor re-export?" is answered with numbers instead of a guess.
// Run: npx tsx scripts/audit-sidecars.ts
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { leanPropsToEnvelope, isLeanProperties, type LeanSchema } from '../src/persistence/leanEnvelope.ts';

const PACK = join(import.meta.dirname, '..', 'public', 'starter-project');
const SCHEMA_DIR = join(import.meta.dirname, '..', 'public', 'schema');
const rj = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const schema = rj(join(PACK, '_schema.json')) as LeanSchema;
const schemaClasses = new Set(Object.keys((schema as any).classes || {}));

// ── 1. _schema.json coverage: which classes' values actually load typed? ──────
const recs: { key: string; cls: string; props: Record<string, any> }[] = [];
for (const folder of readdirSync(PACK)) {
  const fp = join(PACK, folder);
  if (folder.startsWith('.') || !statSync(fp).isDirectory()) continue;
  for (const f of readdirSync(fp)) {
    if (!f.endsWith('.json')) continue;
    const j = rj(join(fp, f));
    if (typeof j?.id !== 'string' || typeof j?.class !== 'string') continue;
    recs.push({ key: `${folder}/${j.id}`, cls: j.class, props: j.properties || {} });
  }
}

const dataClasses = new Map<string, number>();
for (const r of recs) dataClasses.set(r.cls, (dataClasses.get(r.cls) || 0) + 1);
const uncovered = [...dataClasses].filter(([c]) => !schemaClasses.has(c));

console.log('=== 1. _schema.json class coverage ===');
console.log(`schema declares ${schemaClasses.size} classes; pack data uses ${dataClasses.size}`);
console.log(`classes used by data but ABSENT from _schema.json: ${uncovered.length}`);
for (const [c, n] of uncovered.sort((a, b) => b[1] - a[1])) console.log(`   ${c} (${n} records)`);

// The real question is not "is the class declared" but "does any VALUE come out
// untyped". leanToEnvelope with a null kind falls back to a generic inference,
// so count properties that end up with no usable envelope type.
const UNTYPED = new Set(['unknown', undefined, null, '']);
let untypedProps = 0;
const untypedByClass = new Map<string, Set<string>>();
for (const r of recs) {
  if (!isLeanProperties(r.props)) continue;
  const env = leanPropsToEnvelope(r.props, r.cls, schema);
  for (const [k, v] of Object.entries(env)) {
    const t = v && typeof v === 'object' ? (v as any).type : undefined;
    if (UNTYPED.has(t as any)) {
      untypedProps++;
      if (!untypedByClass.has(r.cls)) untypedByClass.set(r.cls, new Set());
      untypedByClass.get(r.cls)!.add(k);
    }
  }
}
console.log(`\nproperties that convert to an UNTYPED envelope: ${untypedProps}`);
for (const [c, ks] of untypedByClass) console.log(`   ${c}: ${[...ks].slice(0, 8).join(', ')}${ks.size > 8 ? ` …+${ks.size - 8}` : ''}`);

// ── 2. gameplay-tags.json: tags used in data but not declared ────────────────
console.log('\n=== 2. gameplay-tags.json coverage ===');
const tagsFile = join(PACK, '.gameplay-tags.json');
if (existsSync(tagsFile)) {
  const tj = rj(tagsFile);
  const declared = new Set<string>(
    (Array.isArray(tj.tags) ? tj.tags : Object.keys(tj.tags || {}))
      .map((t: any) => String(typeof t === 'string' ? t : t.tag)),
  );
  // Any string that looks like a gameplay tag, anywhere in the data.
  const TAGLIKE = /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9_]*)+$/;
  const used = new Set<string>();
  const walk = (v: any) => {
    if (typeof v === 'string') { if (TAGLIKE.test(v)) used.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const r of recs) walk(r.props);
  const missing = [...used].filter((t) => !declared.has(t));
  console.log(`declared: ${declared.size}   tag-like strings in data: ${used.size}   used-but-undeclared: ${missing.length}`);
  for (const t of missing.slice(0, 15)) console.log(`   ${t}`);
  if (missing.length > 15) console.log(`   …+${missing.length - 15} more`);
} else console.log('   no .gameplay-tags.json in bundle');

// ── 3. class-hierarchy: chains that stop straight at UDataAsset ──────────────
// INFORMATIONAL, not a defect list. refresh-schema's self-heal uses
// [UDataAsset, UObject] both as the correct answer for a class that really does
// derive directly from UDataAsset AND as its give-up fallback when no header
// exists, so the two are indistinguishable here. Every one of these was checked
// against Source/ and is genuinely `: public UDataAsset` — verify against the
// headers before treating any as broken.
console.log('\n=== 3. class-hierarchy.json parent chains ===');
const ch = rj(join(SCHEMA_DIR, 'class-hierarchy.json')).classes;
const direct = Object.entries(ch).filter(
  ([, v]: any) => Array.isArray(v.parents) && v.parents.length === 2
    && v.parents[0] === 'UDataAsset' && v.parents[1] === 'UObject',
);
console.log(`classes whose chain is [UDataAsset, UObject]: ${direct.length}`);
console.log('   (correct for a direct UDataAsset subclass; also the self-heal fallback —');
console.log('    grep Source/ for "class .*<Name> : public" to tell the two apart)');
for (const [c] of direct) console.log(`   ${c}`);

// ── 4. asset-refs.json: are any expected guids actually populated? ───────────
console.log('\n=== 4. asset-refs.json guids ===');
const arFile = join(PACK, '.asset-refs.json');
if (existsSync(arFile)) {
  const ar = rj(arFile);
  const guids = ar.guids || {};
  const nonEmpty = Object.values(guids).filter((g) => g && String(g).length).length;
  console.log(`entries: ${Object.keys(guids).length}   with a non-empty guid: ${nonEmpty}`);
  console.log(nonEmpty === 0
    ? '   -> validator skips every guid comparison; this sidecar has no effect today.'
    : '   -> some guid checks are live; staleness could produce false mismatches.');
} else console.log('   no .asset-refs.json in bundle');

// ── 5. manifest: does the bundle use the pack's, or its own? ─────────────────
console.log('\n=== 5. manifest.json ===');
const mf = rj(join(PACK, 'manifest.json'));
console.log(`bundle manifest: ${mf.folders?.length} folders, ${mf.files?.length} file groups`);
console.log(`   shape is {folders, files} (generated by refresh-schema), pack's .manifest.json is not copied.`);
