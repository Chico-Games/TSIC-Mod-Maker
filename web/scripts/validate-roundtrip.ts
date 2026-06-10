// Proof harness: lean → envelope → lean must be identical for every real
// DefaultProject file. Run: npx tsx scripts/validate-roundtrip.ts [packDir]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  leanPropsToEnvelope,
  envelopePropsToLean,
  type LeanSchema,
} from '../src/persistence/leanEnvelope.ts';

const PACK = process.argv[2]
  || 'C:/Users/Administrator/Documents/Unreal Projects/TSIC/Content/DefinitionPacks/DefaultProject';

const schema = JSON.parse(readFileSync(join(PACK, '_schema.json'), 'utf8')) as LeanSchema;

/** Order-insensitive deep equal (object keys), order-sensitive for arrays. */
function deepEq(a: any, b: any, path = ''): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array vs non-array`;
    if (a.length !== b.length) return `${path}: len ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const e = deepEq(a[i], b[i], `${path}[${i}]`); if (e) return e; }
    return null;
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return `${path}: keys ${ka.length} vs ${kb.length} (${ka} | ${kb})`;
    for (const k of ka) { if (!(k in b)) return `${path}: missing key ${k}`; const e = deepEq(a[k], b[k], `${path}.${k}`); if (e) return e; }
    return null;
  }
  // number tolerance for float repr
  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
    return Math.abs(a - b) < 1e-9 ? null : `${path}: ${a} vs ${b}`;
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

let total = 0, ok = 0;
const failures: string[] = [];
for (const folder of readdirSync(PACK, { withFileTypes: true })) {
  if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
  const dir = join(PACK, folder.name);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (!j || typeof j.class !== 'string' || !j.properties) continue;
    total++;
    const env = leanPropsToEnvelope(j.properties, j.class, schema);
    const back = envelopePropsToLean(env, schema);
    const diff = deepEq(j.properties, back);
    if (diff) failures.push(`${folder.name}/${f}  ${diff}`);
    else ok++;
  }
}

console.log(`round-trip: ${ok}/${total} identical`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURES (first 25):`);
  for (const x of failures.slice(0, 25)) console.log('  ✗ ' + x);
  process.exit(1);
} else {
  console.log('ALL CLEAN — lean→envelope→lean is lossless.');
}
