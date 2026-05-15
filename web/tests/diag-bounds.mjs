// One-shot diagnostic: read the actual public/starter-project data and
// simulate the resolver lookup for every top-level actor in a few layouts.
// Tells us whether bounds are flowing through, and what the size+scale ends
// up being per actor.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public', 'starter-project');

const allDefs = new Map(); // id -> json
for (const folder of readdirSync(ROOT, { withFileTypes: true })) {
  if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
  for (const f of readdirSync(join(ROOT, folder.name))) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(join(ROOT, folder.name, f), 'utf8'));
    allDefs.set(j.id, j);
  }
}
const meshCat = JSON.parse(readFileSync(join(ROOT, '.assets/StaticMesh.json'), 'utf8'));
const meshByPath = new Map(meshCat.entries.map((e) => [e.path, e]));

function actorType(raw) {
  const c = (raw ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (c.includes('PROXYACTOR')) return 'ProxyActor';
  if (c.includes('ENEMYSPAWN')) return 'EnemySpawnPoint';
  if (c.includes('LOOTSPAWN')) return 'LootSpawnPoint';
  if (c.includes('VISUALHELPER')) return 'VisualHelper';
  if (c.includes('LAYOUT')) return 'Layout';
  return 'ProxyActor';
}

function diag(layoutId) {
  console.log(`\n=== ${layoutId} ===`);
  const layout = allDefs.get(layoutId);
  if (!layout) { console.log('NOT FOUND'); return; }
  const objs = layout.properties?.layout_objects?.value ?? [];
  let totalActors = 0, withBounds = 0, withDirectRef = 0, missingMesh = 0;
  for (const lo of objs) {
    totalActors++;
    const v = lo.value;
    const at = actorType(v.layout_actor_type.value);
    const ref = v[at === 'ProxyActor' ? 'furniture_definition'
            : at === 'Layout' ? 'layout_definition'
            : at === 'EnemySpawnPoint' ? 'enemy_spawn_point_definition'
            : at === 'LootSpawnPoint' ? 'loot_spawn_point_definition' : '']?.value;
    if (ref) withDirectRef++;
    const scale = v.transform.value.scale3_d.value;
    const sc = [scale.x.value, scale.y.value, scale.z.value];
    if (!ref) { console.log(`  ${at} (no direct ref) scale=${sc.join(',')}`); continue; }
    const def = allDefs.get(ref);
    const sm = def?.properties?.static_mesh?.value;
    if (!sm) {
      missingMesh++;
      console.log(`  ${at} ${ref}: NO static_mesh on definition; scale=${sc.join(',')}`);
      continue;
    }
    const entry = meshByPath.get(sm);
    if (!entry?.bounds) {
      console.log(`  ${at} ${ref}: mesh=${sm} NOT IN CATALOG; scale=${sc.join(',')}`);
      continue;
    }
    const b = entry.bounds;
    const size = [b.max[0]-b.min[0], b.max[1]-b.min[1], b.max[2]-b.min[2]];
    withBounds++;
    if (withBounds <= 3) console.log(`  ${at} ${ref}: size=${size.map(n=>n.toFixed(1)).join('x')} scale=${sc.join(',')} mesh=${entry.name}`);
  }
  console.log(`  TOTALS: actors=${totalActors} withDirectRef=${withDirectRef} withBounds=${withBounds} missingMesh=${missingMesh}`);
}

diag('LYD_Bathroom_All');
diag('LYD_AbandonedCamp_Up');
diag('LYD_Empty');
