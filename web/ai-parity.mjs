// Sandbox half of the AI parity harness.
//
// Runs Scripts/ai-parity/scenarios.json (the SHARED definition, which lives in the TSIC repo)
// through the deterministic sim and writes the same observables the Unreal side writes, so
// Scripts/ai-parity/compare.mjs can diff them and say which engine is wrong.
//
//   npx tsx ai-parity.mjs                 # every scenario
//   npx tsx ai-parity.mjs --filter chase
//   npx tsx ai-parity.mjs --out <path>

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScenarioWorld, FIXED_STEP } from './src/ai/testing/harness.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TSIC = resolve(HERE, '../../../Unreal Projects/TSIC');
const SCENARIO_FILE = join(TSIC, 'Scripts/ai-parity/scenarios.json');
const PACK_DIR = join(TSIC, 'Mods/com.chicogames.default');

const AI_FOLDERS = {
	enemies: 'enemy_definitions',
	perception: 'perception_definitions',
	behaviors: 'behavior_definitions',
	skills: 'skill_definitions',
	furniture: 'damageable_furniture_definitions',
};

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

async function loadPack() {
	const pack = {};
	for (const [slot, folder] of Object.entries(AI_FOLDERS)) {
		pack[slot] = {};
		let names = [];
		try {
			names = await readdir(join(PACK_DIR, folder));
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith('.json')) continue;
			const json = JSON.parse(await readFile(join(PACK_DIR, folder, name), 'utf8'));
			pack[slot][json.id ?? name.replace(/\.json$/, '')] = json;
		}
	}
	return pack;
}

/** Parity scenario -> the sandbox's ScenarioSpec shape. */
function toSpec(scenario) {
	const enemies = scenario.enemies ?? (scenario.enemy ? [scenario.enemy] : []);
	return {
		id: scenario.id,
		title: scenario.id,
		tags: ['parity'],
		seconds: scenario.seconds,
		// `open`: the only walls are the ones the scenario authors, matching the Unreal side's
		// bare navigable arena. A box would give the sim occluders the game does not have.
		arena: 'open',
		bounds: { minX: -4500, minY: -4500, maxX: 4500, maxY: 4500 },
		daySection: scenario.daySection ?? null,
		walls: scenario.walls ?? [],
		players: [{ as: 'player', ...(scenario.player ?? {}) }],
		enemies: enemies.map((e, index) => ({ as: e.as ?? `enemy${index + 1}`, ...e })),
		furniture: scenario.furniture ?? [],
		check: () => {},
	};
}

function runScenario(scenario, pack) {
	const spec = toSpec(scenario);
	const { world, enemies, players } = buildScenarioWorld(spec, pack, 20260802);
	const player = players.get('player');
	const enemyList = [...enemies.values()];
	const primary = enemyList[0];

	const script = [...(scenario.script ?? [])].sort((a, b) => a.at - b.at);
	let scriptIndex = 0;

	const observed = {
		acquired: false,
		timeToAcquire: null,
		rootsSeen: [],
		minDistToPlayer: Infinity,
		attacksFired: 0,
		firstAttackTime: null,
		damageToPlayer: 0,
		damageToFurniture: 0,
		gaveUpAt: null,
		peakTokenHolders: 0,
		finalTargetHeld: false,
		everFrozen: false,
		distanceTravelled: 0,
	};

	const startHealth = new Map(world.entities.map((e) => [e, e.health]));
	const playerStartHealth = player ? player.health : 0;
	let lastPos = primary ? { ...primary.pos } : { x: 0, y: 0 };
	let hadTarget = false;
	let castingBefore = new Map(enemyList.map((e) => [e, null]));

	const steps = Math.round(scenario.seconds / FIXED_STEP);
	for (let step = 0; step < steps; step += 1) {
		while (scriptIndex < script.length && script[scriptIndex].at <= world.time) {
			applyStep(world, script[scriptIndex], { player, enemies });
			scriptIndex += 1;
		}

		world.step(FIXED_STEP);
		const now = world.time;

		for (const enemy of enemyList) {
			const root = enemy.machine.activeRootName;
			if (root && !observed.rootsSeen.includes(root)) observed.rootsSeen.push(root);
			if (enemy.frozen) observed.everFrozen = true;
			// A new cast object is one attack activation.
			const casting = enemy.casting;
			if (casting && castingBefore.get(enemy) !== casting) {
				observed.attacksFired += 1;
				if (observed.firstAttackTime === null) observed.firstAttackTime = now;
			}
			castingBefore.set(enemy, casting);
		}

		const holders = enemyList.filter((e) => world.coordinator.hasToken(e)).length;
		observed.peakTokenHolders = Math.max(observed.peakTokenHolders, holders);

		if (primary && player) {
			const d = Math.hypot(primary.pos.x - player.pos.x, primary.pos.y - player.pos.y);
			observed.minDistToPlayer = Math.min(observed.minDistToPlayer, d);
			observed.distanceTravelled += Math.hypot(primary.pos.x - lastPos.x, primary.pos.y - lastPos.y);
			lastPos = { ...primary.pos };

			const target = primary.perception.target;
			if (target && !observed.acquired) {
				observed.acquired = true;
				observed.timeToAcquire = now;
			}
			// A target held and then dropped with the give-up window armed is the stalemate.
			if (hadTarget && !target && observed.gaveUpAt === null) observed.gaveUpAt = now;
			hadTarget = Boolean(target);
		}
	}

	if (player) observed.damageToPlayer = Math.max(0, playerStartHealth - player.health);
	for (const [entity, health] of startHealth) {
		observed.damageToFurniture += Math.max(0, health - entity.health);
	}
	observed.finalTargetHeld = Boolean(primary?.perception.target);
	if (!Number.isFinite(observed.minDistToPlayer)) observed.minDistToPlayer = null;
	observed.distanceTravelled = Math.round(observed.distanceTravelled);

	return observed;
}

function applyStep(world, step, ctx) {
	const who = step.who === 'player' ? ctx.player : ctx.enemies.get(step.who) ?? ctx.player;
	if (step.teleport) {
		who.pos = { x: step.teleport[0], y: step.teleport[1] };
		return;
	}
	if (step.face !== undefined) {
		who.yaw = step.face;
		return;
	}
	if (step.move) {
		const to = { x: step.move[0], y: step.move[1] };
		const d = Math.hypot(to.x - ctx.player.pos.x, to.y - ctx.player.pos.y) || 1;
		ctx.player.moveInput = { x: (to.x - ctx.player.pos.x) / d, y: (to.y - ctx.player.pos.y) / d };
		return;
	}
	if (step.stop) {
		ctx.player.moveInput = { x: 0, y: 0 };
		return;
	}
	if (step.noise) {
		world.reportNoise(
			{ x: step.noise.at[0], y: step.noise.at[1] },
			step.noise.loudness ?? 1,
			step.noise.range ?? 1500,
			world.time,
		);
		return;
	}
	if (step.damage) {
		const victim = step.damage.to === 'enemy' ? [...ctx.enemies.values()][0] : ctx.player;
		world.applyDamage(ctx.player, victim, step.damage.amount);
		return;
	}
	if (step.forceTarget) {
		// UScpPerceptionComponent::ForceTarget — the documented determinism seam: plant an
		// instantly-Spotted sight record, THEN acquire. Acquiring without the record would be
		// dropped by the very next UpdateTarget pass.
		const targets = step.who && step.who !== 'all'
			? [ctx.enemies.get(step.who)].filter(Boolean)
			: [...ctx.enemies.values()];
		for (const enemy of targets) {
			const record = enemy.perception.findOrAddSightRecord(ctx.player, world.time);
			if (!record) continue;
			record.sensedNow = true;
			record.spotted = true;
			record.strength = 1;
			record.lastKnownLocation = { ...ctx.player.pos };
			record.lastSeenTime = world.time;
			record.lastSensedTime = world.time;
			enemy.perception.acquireTarget(ctx.player, world.time, false, 'parity forceTarget');
			enemy.perception.pushContext(world.time);
		}
	}
}

const scenarioFile = JSON.parse(await readFile(SCENARIO_FILE, 'utf8'));
const pack = await loadPack();
const filter = arg('filter');
const selected = scenarioFile.scenarios.filter((s) => !filter || s.id.includes(filter));

const results = [];
for (const scenario of selected) {
	const started = Date.now();
	try {
		results.push({ id: scenario.id, ...runScenario(scenario, pack), error: null });
	} catch (error) {
		results.push({ id: scenario.id, error: String(error?.stack || error) });
	}
	const row = results[results.length - 1];
	console.log(
		row.error
			? `ERROR ${row.id}: ${row.error.split('\n')[0]}`
			: `ok    ${row.id.padEnd(44)} acquired=${row.acquired} minDist=${row.minDistToPlayer?.toFixed(0)} attacks=${row.attacksFired} dmg=${row.damageToPlayer.toFixed(0)} (${Date.now() - started}ms)`,
	);
}

const outPath = arg('out') || join(TSIC, 'Saved/AiParity/sim.json');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify({ source: 'sim', results }, null, 2)}\n`);
console.log(`\nwrote ${results.length} sandbox results to ${outPath}`);
process.exit(results.some((r) => r.error) ? 1 : 0);
