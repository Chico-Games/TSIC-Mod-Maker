// Headless smoke for the AI sandbox engine. Run through tsx so the .ts engine imports:
//   npx tsx ai-smoke.mjs [seconds]
//
// Loads the bundled starter-project straight off disk (already plain JSON, which is what
// the engine reads), then runs every v2 enemy for a fixed number of steps and reports what
// each one did. Catches hangs and compile breakage without a browser.
//
//   node ai-smoke.mjs            # all enemies, 20 sim-seconds each
//   node ai-smoke.mjs 60         # 60 sim-seconds each

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';


const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, 'public', 'starter-project');
const SECONDS = Number(process.argv[2] || 20);
const STEP = 1 / 60;
/** A single step taking longer than this means something is pathologically slow. */
const SLOW_STEP_MS = 250;

const { World } = await import('./src/ai/sim.ts');
const { aiEnemies } = await import('./src/ai/loadPack.ts');

async function readFolder(name) {
  const out = {};
  let files;
  try {
    files = await readdir(join(PROJECT, name));
  } catch {
    return out;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(await readFile(join(PROJECT, name, file), 'utf8'));
    out[json.id ?? file.replace(/\.json$/, '')] = json;
  }
  return out;
}

const pack = {
  enemies: await readFolder('enemy_definitions'),
  perception: await readFolder('perception_definitions'),
  behaviors: await readFolder('behavior_definitions'),
  skills: await readFolder('skill_definitions'),
  furniture: await readFolder('damageable_furniture_definitions'),
};

const defs = aiEnemies(pack);
console.log(
  `pack: ${defs.length} v2 enemies, ${Object.keys(pack.behaviors).length} behaviours, ` +
    `${Object.keys(pack.perception).length} profiles, ${Object.keys(pack.furniture).length} furniture\n`,
);

let failed = 0;
for (const def of defs) {
  const world = new World(pack);
  world.bounds = { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 };
  world.addWall({ x: -3000, y: -2200 }, { x: 3000, y: -2200 });
  world.addWall({ x: 3000, y: -2200 }, { x: 3000, y: 2200 });
  world.addWall({ x: 3000, y: 2200 }, { x: -3000, y: 2200 });
  world.addWall({ x: -3000, y: 2200 }, { x: -3000, y: -2200 });

  const player = world.addPlayer({ x: 700, y: 0, yaw: 180 });
  let enemy;
  try {
    enemy = world.addEnemy(def, { x: 0, y: 0, yaw: 0 });
  } catch (err) {
    console.log(`${def.id.padEnd(20)} SPAWN FAILED — ${err.message}`);
    failed += 1;
    continue;
  }

  // Seed the target through the real ally-alert path so every enemy actually engages —
  // left to wander, most of them never line the player up and the run proves nothing.
  world.alertAllies({ pos: { x: 0, y: 0 } }, player, 1e9, world.time);

  const roots = new Set();
  const fired = new Set();
  let closest = Infinity;
  let worstStepMs = 0;
  let worstAt = 0;
  const started = Date.now();

  try {
    for (let i = 0; i < SECONDS * 60; i += 1) {
      const t0 = Date.now();
      world.step(STEP);
      const dt = Date.now() - t0;
      if (dt > worstStepMs) {
        worstStepMs = dt;
        worstAt = world.time;
      }
      if (enemy.machine.activeRootName) roots.add(enemy.machine.activeRootName);
      if (enemy.casting) fired.add(enemy.casting.tag.split('.').slice(-2).join('.'));
      closest = Math.min(closest, Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y));
    }
  } catch (err) {
    console.log(`${def.id.padEnd(20)} THREW at t=${world.time.toFixed(1)} — ${err.message}`);
    failed += 1;
    continue;
  }

  const wall = Date.now() - started;
  const slow = worstStepMs >= SLOW_STEP_MS;
  if (slow) failed += 1;
  console.log(
    `${def.id.padEnd(20)} ${slow ? 'SLOW ' : 'ok   '} ` +
      `${String(wall).padStart(5)}ms total, worst step ${String(worstStepMs).padStart(4)}ms @ t=${worstAt.toFixed(1)}  ` +
      `roots=[${[...roots].join(',')}] fired=[${[...fired].join(',') || 'NOTHING'}] ` +
      `closest=${closest.toFixed(0)}uu php=${player.health}`,
  );
}

console.log(failed === 0 ? '\nall enemies ran clean' : `\n${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
