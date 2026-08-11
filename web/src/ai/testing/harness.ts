// The deterministic scenario runner.
//
// One scenario = one freshly seeded World, a fixed-step loop with no wall clock anywhere in
// it, a timed input script, and a recorded trace the checks read afterwards. Two runs of the
// same scenario at the same seed produce byte-identical traces and the same world hash —
// that is what `--repeat` verifies and what makes a failure worth chasing.

import { World, PLAYER_SPRINT_SPEED } from '../sim';
import type { Actor, EnemyActor, EntityActor, PlayerActor, Cast } from '../sim';
import { add, clamp, dist, norm, scale, sub, hashString, yawOf } from '../util';
import type { Vec2 } from '../util';
import type { AiPack, TimelineEvent } from '../types';
import type {
	AgentSample, AgentTrace, ArenaName, AttackRecord, CheckResult, DamageRecord, Expect,
	PlayerSample, PlayerTrace, ScenarioContext, ScenarioResult, ScenarioSpec, ScriptStep, Trace,
} from './types';

/** The sim always runs at 60Hz, exactly like the game's fixed AI tick budget. */
export const FIXED_STEP = 1 / 60;
/** Trace sampling rate. Events, attacks and damage are always captured every step. */
const SAMPLE_HZ = 20;
const DEFAULT_BOUNDS = { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 };

// ---------------------------------------------------------------------------
// Arenas
// ---------------------------------------------------------------------------

function boxWalls(world: World): void {
	const { minX, minY, maxX, maxY } = world.bounds;
	world.addWall({ x: minX, y: minY }, { x: maxX, y: minY });
	world.addWall({ x: maxX, y: minY }, { x: maxX, y: maxY });
	world.addWall({ x: maxX, y: maxY }, { x: minX, y: maxY });
	world.addWall({ x: minX, y: maxY }, { x: minX, y: minY });
}

function buildArena(world: World, arena: ArenaName): void {
	if (arena !== 'open') boxWalls(world);
	if (arena === 'corridor') {
		// A blind corner with one gap: the classic "why did it lose me" repro.
		world.addWall({ x: -600, y: -2200 }, { x: -600, y: -400 });
		world.addWall({ x: -600, y: 400 }, { x: -600, y: 2200 });
		world.addWall({ x: 900, y: -900 }, { x: 900, y: 900 });
	}
	if (arena === 'shop') {
		// Aisles with gaps, so a chase has to commit to a side.
		world.addWall({ x: -1200, y: -1600 }, { x: -1200, y: -200 });
		world.addWall({ x: -1200, y: 200 }, { x: -1200, y: 1600 });
		world.addWall({ x: 400, y: -1600 }, { x: 400, y: 400 });
		world.addWall({ x: 1800, y: -400 }, { x: 1800, y: 1600 });
	}
	if (arena === 'pillar') {
		// A free-standing block to break line of sight without blocking the floor.
		world.addWall({ x: -300, y: -300 }, { x: 300, y: -300 });
		world.addWall({ x: 300, y: -300 }, { x: 300, y: 300 });
		world.addWall({ x: 300, y: 300 }, { x: -300, y: 300 });
		world.addWall({ x: -300, y: 300 }, { x: -300, y: -300 });
	}
	if (arena === 'room') {
		// A sealed room with one doorway at y≈0, enemy side vs player side.
		world.addWall({ x: 600, y: -1400 }, { x: 600, y: -200 });
		world.addWall({ x: 600, y: 200 }, { x: 600, y: 1400 });
		world.addWall({ x: 600, y: -1400 }, { x: 2400, y: -1400 });
		world.addWall({ x: 600, y: 1400 }, { x: 2400, y: 1400 });
		world.addWall({ x: 2400, y: -1400 }, { x: 2400, y: 1400 });
	}
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

const num = (v: number | null | undefined) =>
	v === null || v === undefined || Number.isNaN(v) ? 'never' : Number(v).toFixed(2).replace(/\.00$/, '');

export function makeExpect(): Expect {
	const results: CheckResult[] = [];
	const push = (name: string, ok: boolean, detail: string) => {
		results.push({ name, ok, detail });
		return ok;
	};
	return {
		results,
		ok: (name, condition, detail = '') => push(name, Boolean(condition), detail),
		eq: (name, actual, expected) =>
			push(name, Object.is(actual, expected), `got ${String(actual)}, want ${String(expected)}`),
		lte: (name, actual, bound) =>
			push(name, actual !== null && actual <= bound, `${num(actual)} <= ${num(bound)}`),
		gte: (name, actual, bound) =>
			push(name, actual !== null && actual >= bound, `${num(actual)} >= ${num(bound)}`),
		lt: (name, actual, bound) =>
			push(name, actual !== null && actual < bound, `${num(actual)} < ${num(bound)}`),
		gt: (name, actual, bound) =>
			push(name, actual !== null && actual > bound, `${num(actual)} > ${num(bound)}`),
		between: (name, actual, lo, hi) =>
			push(name, actual !== null && actual >= lo && actual <= hi, `${num(actual)} in [${num(lo)}, ${num(hi)}]`),
		happenedWithin: (name, actual, bound) =>
			push(name, actual !== null && actual <= bound, `at ${num(actual)}s, budget ${num(bound)}s`),
		neverHappened: (name, actual) => push(name, actual === null, `happened at ${num(actual)}s`),
		contains: (name, haystack, needle) =>
			push(name, haystack.includes(needle), `[${haystack.join(', ') || 'none'}] contains ${needle}`),
		excludes: (name, haystack, needle) =>
			push(name, !haystack.includes(needle), `[${haystack.join(', ') || 'none'}] excludes ${needle}`),
	};
}

// ---------------------------------------------------------------------------
// World hash
// ---------------------------------------------------------------------------

/** Round hard enough that float noise below the level anything observes can't flip a hash. */
const q = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A digest of everything the sim carries forward: positions, health, machine state, sensed
 * records. Two runs that agree on this agree on the whole simulation, so scenarios don't
 * need golden files to catch a determinism break.
 */
export function worldHash(world: World): string {
	const parts: string[] = [`t=${q(world.time)}`, `seed=${world.seed}`];
	for (const player of world.players) {
		parts.push(`P|${player.label}|${q(player.pos.x)}|${q(player.pos.y)}|${q(player.health)}|${q(player.yaw)}`);
	}
	for (const enemy of world.enemies) {
		const frame = enemy.machine.rootFrame;
		const path = frame.activePath.map((i) => frame.compiled.states[i]?.name ?? '?').join('>');
		const sensed = enemy.perception.sightRecords
			.map((r) => `${r.actor?.label ?? '?'}:${q(r.strength)}:${r.spotted ? 1 : 0}`)
			.join(',');
		parts.push(
			`E|${enemy.label}|${q(enemy.pos.x)}|${q(enemy.pos.y)}|${q(enemy.yaw)}|${q(enemy.health)}` +
				`|${enemy.machine.activeRootName ?? '-'}|${path}|${enemy.perception.target?.label ?? '-'}` +
				`|${enemy.casting?.tag ?? '-'}|${sensed}`,
		);
	}
	for (const entity of world.entities) {
		parts.push(`F|${entity.label}|${q(entity.pos.x)}|${q(entity.pos.y)}|${q(entity.health)}|${entity.dead ? 1 : 0}`);
	}
	return hashString(parts.join('\n')).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Trace assembly
// ---------------------------------------------------------------------------

function firstIndex<T>(rows: T[], predicate: (row: T) => boolean): number {
	for (let i = 0; i < rows.length; i += 1) if (predicate(rows[i])) return i;
	return -1;
}

function buildAgentTrace(
	handle: string,
	defId: string,
	samples: AgentSample[],
	attacks: AttackRecord[],
	damage: DamageRecord[],
	distances: Map<string, number[]>,
	sampleStep: number,
): AgentTrace {
	const roots: string[] = [];
	const states: string[] = [];
	const targetsHeld: string[] = [];
	let rootSwitches = 0;
	let targetSwitches = 0;
	let travelled = 0;

	for (let i = 0; i < samples.length; i += 1) {
		const s = samples[i];
		if (s.root && !roots.includes(s.root)) roots.push(s.root);
		for (const name of s.path) if (!states.includes(name)) states.push(name);
		if (s.target && !targetsHeld.includes(s.target)) targetsHeld.push(s.target);
		if (i > 0) {
			if (s.root !== samples[i - 1].root) rootSwitches += 1;
			if (s.target !== samples[i - 1].target) targetSwitches += 1;
			travelled += Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y);
		}
	}

	const empty: AgentSample = {
		t: 0, root: null, path: [], target: null, targetState: 'none', casting: null,
		x: 0, y: 0, yaw: 0, health: 0, hasToken: false, attackTag: null, detection: {},
		frozen: false, speed: 0,
	};
	const at = (t: number): AgentSample => {
		if (!samples.length) return empty;
		const index = Math.min(samples.length - 1, Math.max(0, Math.round(t / sampleStep)));
		return samples[index];
	};

	return {
		handle,
		defId,
		samples,
		roots,
		states,
		attacks,
		final: samples.length ? samples[samples.length - 1] : empty,
		at,
		everRoot: (name) => roots.includes(name),
		firstRootTime: (name) => {
			const i = firstIndex(samples, (s) => s.root === name);
			return i < 0 ? null : samples[i].t;
		},
		secondsInRoot: (name) => samples.filter((s) => s.root === name).length * sampleStep,
		rootSwitches,
		everState: (name) => states.includes(name),
		firstStateTime: (name) => {
			const i = firstIndex(samples, (s) => s.path.includes(name));
			return i < 0 ? null : samples[i].t;
		},
		targetAt: (t) => at(t).target,
		firstTargetTime: (target) => {
			const i = firstIndex(samples, (s) => (target ? s.target === target : s.target !== null));
			return i < 0 ? null : samples[i].t;
		},
		targetSwitches,
		targetsHeld,
		heldTargetFor: (target, seconds) => {
			let run = 0;
			const need = Math.ceil(seconds / sampleStep);
			for (const s of samples) {
				run = s.target === target ? run + 1 : 0;
				if (run >= need) return true;
			}
			return false;
		},
		firstAttackTime: (tag) => {
			const hit = attacks.find((a) => !tag || a.tag === tag || a.tag.endsWith(tag));
			return hit ? hit.t : null;
		},
		attackTags: [...new Set(attacks.map((a) => a.tag))],
		damageDealtTo: (target) =>
			damage.filter((d) => d.from === handle && d.to === target).reduce((sum, d) => sum + d.final, 0),
		minDistTo: (target) => {
			const rows = distances.get(target);
			return rows && rows.length ? Math.min(...rows) : Infinity;
		},
		maxDistTo: (target) => {
			const rows = distances.get(target);
			return rows && rows.length ? Math.max(...rows) : Infinity;
		},
		distToAt: (target, t) => {
			const rows = distances.get(target);
			if (!rows || !rows.length) return Infinity;
			return rows[Math.min(rows.length - 1, Math.max(0, Math.round(t / sampleStep)))];
		},
		distanceTravelled: travelled,
		peakDetection: (who) => samples.reduce((peak, s) => Math.max(peak, s.detection[who] ?? 0), 0),
		secondsWithToken: samples.filter((s) => s.hasToken).length * sampleStep,
	};
}

function buildPlayerTrace(handle: string, samples: PlayerSample[], damage: DamageRecord[], sampleStep: number): PlayerTrace {
	const empty: PlayerSample = { t: 0, x: 0, y: 0, health: 0, grabbed: false };
	return {
		handle,
		samples,
		final: samples.length ? samples[samples.length - 1] : empty,
		at: (t) => {
			if (!samples.length) return empty;
			return samples[Math.min(samples.length - 1, Math.max(0, Math.round(t / sampleStep)))];
		},
		damageTaken: damage.filter((d) => d.to === handle).reduce((sum, d) => sum + d.final, 0),
		everGrabbed: samples.some((s) => s.grabbed),
	};
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface Directive {
	kind: 'to' | 'dir' | 'away' | 'orbit' | 'keepAway';
	to?: Vec2;
	dir?: Vec2;
	from?: string;
	/** Handle the directive is anchored to, for `orbit` and `keepAway`. */
	anchor?: string;
	radius?: number;
	clockwise?: boolean;
}

export interface RunOptions {
	seed?: number;
	/** Keep the full sample arrays. Off for big sweeps where only verdicts matter. */
	keepTrace?: boolean;
}

/**
 * Build a scenario's world without running it. The Scenarios view uses this to hand a
 * failing scenario straight to the live sandbox, so what you watch is what the check ran.
 */
/**
 * Build a scenario's world without running it. The Scenarios view uses this to hand a
 * failing scenario straight to the live sandbox, so what you watch is what the check ran.
 */
export function buildScenarioWorld(spec: ScenarioSpec, pack: AiPack, seed: number): {
	world: World;
	enemies: Map<string, EnemyActor>;
	players: Map<string, PlayerActor>;
	furniture: Map<string, EntityActor>;
} {
	const world = new World(pack, { seed });
	world.bounds = { ...(spec.bounds ?? DEFAULT_BOUNDS) };
	buildArena(world, spec.arena ?? 'box');
	for (const wall of spec.walls ?? []) {
		world.addWall({ x: wall[0], y: wall[1] }, { x: wall[2], y: wall[3] });
	}
	world.sceneName = spec.id;
	if (spec.daySection !== undefined) world.daySection = spec.daySection;

	const players = new Map<string, PlayerActor>();
	const enemies = new Map<string, EnemyActor>();
	const furniture = new Map<string, EntityActor>();

	const uniq = (map: Map<string, unknown>, want: string) => {
		if (!map.has(want)) return want;
		let n = 2;
		while (map.has(`${want}#${n}`)) n += 1;
		return `${want}#${n}`;
	};

	for (const spawn of spec.players ?? []) {
		const handle = uniq(players, spawn.as ?? 'player');
		const player = world.addPlayer({
			x: spawn.x, y: spawn.y, yaw: spawn.yaw ?? 0, label: handle, health: spawn.health ?? 100,
		});
		player.crouched = Boolean(spawn.crouched);
		player.stealthed = Boolean(spawn.stealthed);
		player.emitsFootstepNoise = !spawn.silent;
		if (spawn.sprint) player.speed = PLAYER_SPRINT_SPEED;
		if (spawn.speed !== undefined) player.speed = spawn.speed;
		players.set(handle, player);
	}

	for (const spawn of spec.enemies ?? []) {
		const def = pack.enemies[spawn.def];
		if (!def) throw new Error(`no enemy definition "${spawn.def}" in the pack`);
		const handle = uniq(enemies, spawn.as ?? spawn.def);
		const enemy = world.addEnemy(def, {
			x: spawn.x, y: spawn.y, yaw: spawn.yaw ?? 0, label: handle,
			...(spawn.health !== undefined ? { health: spawn.health } : {}),
		});
		enemy.frozen = Boolean(spawn.frozen);
		enemy.paused = Boolean(spawn.paused);
		enemies.set(handle, enemy);
	}

	for (const spawn of spec.furniture ?? []) {
		const def = spawn.def ? pack.furniture[spawn.def] : null;
		if (spawn.def && !def) throw new Error(`no furniture definition "${spawn.def}" in the pack`);
		const handle = uniq(furniture, spawn.as ?? spawn.def ?? 'furniture');
		const entity = world.addEntity({
			def, x: spawn.x, y: spawn.y, label: handle,
			...(spawn.health !== undefined ? { health: spawn.health } : {}),
			...(spawn.armour !== undefined ? { armour: spawn.armour } : {}),
			...(spawn.halfExtent !== undefined ? { halfExtent: spawn.halfExtent } : {}),
			...(spawn.breakable !== undefined ? { breakable: spawn.breakable } : {}),
			...(spawn.blocksSight !== undefined ? { blocksSight: spawn.blocksSight } : {}),
		});
		furniture.set(handle, entity);
	}

	// Day-section overlays retune every perception profile, so apply it after the spawns.
	if (spec.daySection) world.setDaySection(spec.daySection);

	return { world, enemies, players, furniture };
}

/**
 * A scenario's world plus the machinery that drives its script.
 *
 * Both the headless runner and the AI tab's Scenarios view step through this, so a scenario
 * you watch in the sandbox is running the same inputs at the same times as the scenario that
 * produced the verdict — no second implementation to drift.
 */
export class ScenarioRun {
	spec: ScenarioSpec;
	pack: AiPack;
	seed: number;
	world: World;
	enemies: Map<string, EnemyActor>;
	players: Map<string, PlayerActor>;
	furniture: Map<string, EntityActor>;
	/** Every damage application the sim made, captured at the source. */
	damage: DamageRecord[] = [];

	private handleOf = new Map<Actor, string>();
	private script: ScriptStep[];
	private nextStep = 0;
	private directives = new Map<PlayerActor, Directive | null>();
	/** Players holding an actor in view every step, independent of where they are walking. */
	private tracking = new Map<PlayerActor, string>();
	private ctx: ScenarioContext;

	constructor(spec: ScenarioSpec, pack: AiPack, seed: number) {
		this.spec = spec;
		this.pack = pack;
		this.seed = seed;

		const built = buildScenarioWorld(spec, pack, seed);
		this.world = built.world;
		this.enemies = built.enemies;
		this.players = built.players;
		this.furniture = built.furniture;

		for (const [handle, actor] of this.players) this.handleOf.set(actor, handle);
		for (const [handle, actor] of this.enemies) this.handleOf.set(actor, handle);
		for (const [handle, actor] of this.furniture) this.handleOf.set(actor, handle);

		// Damage is recorded by wrapping the world's own entry point rather than by polling,
		// so nothing is missed between samples and the numbers are the ones the sim applied.
		const world = this.world;
		const inner = world.applyDamage.bind(world);
		world.applyDamage = (source, victim, amount) => {
			inner(source, victim, amount);
			this.damage.push({
				t: world.time,
				from: this.labelOf(source),
				to: this.labelOf(victim) ?? 'unknown',
				raw: amount,
				final: victim.lastDamage ? victim.lastDamage.final : amount,
				victimKind: victim.kind ?? 'actor',
			});
		};

		// Equal times keep authored order — a stable sort is part of the contract.
		this.script = [...(spec.script ?? [])].sort((a, b) => a.at - b.at);
		this.ctx = {
			world,
			pack,
			enemy: (h) => this.enemies.get(h),
			player: (h) => this.players.get(h),
			furniture: (h) => this.furniture.get(h),
			def: (folder, id) => (pack[folder] as Record<string, any>)?.[id],
		};
	}

	labelOf(actor: Actor | null | undefined): string | null {
		return actor ? this.handleOf.get(actor) ?? actor.label : null;
	}

	/** Any handle, whichever collection it lives in. */
	actor(handle: string): Actor | undefined {
		return this.players.get(handle) ?? this.enemies.get(handle) ?? this.furniture.get(handle);
	}

	get finished(): boolean {
		return this.world.time >= this.spec.seconds;
	}

	/** One fixed step: fire any script steps that are due, steer, then tick the world. */
	step(delta = FIXED_STEP): void {
		while (this.nextStep < this.script.length && this.script[this.nextStep].at <= this.world.time) {
			this.applyStep(this.script[this.nextStep]);
			this.nextStep += 1;
		}
		this.steerPlayers();
		this.world.step(delta);
	}

	private applyStep(step: ScriptStep): void {
		const s = step as any;
		const world = this.world;

		if (s.move !== undefined) {
			const player = this.players.get(s.move);
			if (!player) return;
			if (s.to) this.directives.set(player, { kind: 'to', to: s.to });
			else if (s.dir) this.directives.set(player, { kind: 'dir', dir: s.dir });
			else if (s.awayFrom) this.directives.set(player, { kind: 'away', from: s.awayFrom });
			else if (s.orbit) {
				this.directives.set(player, {
					kind: 'orbit',
					anchor: s.orbit,
					radius: s.radius,
					clockwise: s.clockwise !== false,
				});
			} else if (s.keepAway) {
				this.directives.set(player, { kind: 'keepAway', anchor: s.keepAway, radius: s.distance });
			}
			return;
		}
		if (s.stop !== undefined) {
			const player = this.players.get(s.stop);
			if (!player) return;
			this.directives.set(player, null);
			player.moveInput = { x: 0, y: 0 };
			return;
		}
		if (s.who !== undefined) {
			const actor = this.actor(s.who);
			if (!actor) return;
			if (s.crouch !== undefined) (actor as PlayerActor).crouched = s.crouch;
			if (s.stealth !== undefined) (actor as PlayerActor).stealthed = s.stealth;
			if (s.silent !== undefined) (actor as PlayerActor).emitsFootstepNoise = !s.silent;
			if (s.frozen !== undefined) (actor as EnemyActor).frozen = s.frozen;
			if (s.paused !== undefined) (actor as EnemyActor).paused = s.paused;
			if (s.teleport) actor.pos = { ...s.teleport };
			if (s.face !== undefined) actor.yaw = s.face;
			if (s.track !== undefined) {
				if (s.track === null) this.tracking.delete(actor as PlayerActor);
				else this.tracking.set(actor as PlayerActor, s.track);
			}
			return;
		}
		if (s.attack !== undefined) {
			const player = this.players.get(s.attack);
			if (player) world.playerAttack(player, s.damage ?? 25, s.range ?? 250);
			return;
		}
		if (s.damage !== undefined) {
			const victim = this.actor(s.damage.to);
			const source = s.damage.from ? this.actor(s.damage.from) ?? null : null;
			if (victim) world.applyDamage(source ?? null, victim, s.damage.amount);
			return;
		}
		if (s.noise !== undefined) {
			world.reportNoise(s.noise.at, s.noise.loudness ?? 1, s.noise.range ?? 2000, world.time);
			return;
		}
		if (s.alert !== undefined) {
			const target = this.actor(s.alert.target);
			if (!target) return;
			const source = s.alert.enemy ? this.enemies.get(s.alert.enemy) : null;
			world.alertAllies({ pos: source ? source.pos : { x: 0, y: 0 } }, target, s.alert.radius ?? 1e9, world.time);
			return;
		}
		if (s.kill !== undefined) {
			const actor = this.actor(s.kill);
			if (actor) {
				actor.health = 0;
				actor.dead = true;
				world.navDirty = true;
			}
			return;
		}
		if (s.remove !== undefined) {
			const actor = this.actor(s.remove);
			if (actor) world.remove(actor);
			return;
		}
		if (s.daySection !== undefined) {
			world.setDaySection(s.daySection);
			return;
		}
		if (s.run !== undefined) s.run(this.ctx);
	}

	private steerPlayers(): void {
		for (const [player, directive] of this.directives) {
			if (!directive || player.dead || player.removed) continue;
			if (directive.kind === 'dir') {
				player.moveInput = { ...(directive.dir as Vec2) };
				continue;
			}
			if (directive.kind === 'away') {
				const from = this.actor(directive.from as string);
				player.moveInput = from ? norm(sub(player.pos, from.pos)) : { x: 0, y: 0 };
				continue;
			}
			if (directive.kind === 'orbit') {
				player.moveInput = this.orbitInput(player, directive);
				continue;
			}
			if (directive.kind === 'keepAway') {
				player.moveInput = this.keepAwayInput(player, directive);
				continue;
			}
			const to = directive.to as Vec2;
			// Arrived: hold the spot rather than jittering across it.
			player.moveInput = dist(player.pos, to) <= 40 ? { x: 0, y: 0 } : norm(sub(to, player.pos));
		}

		// Facing is applied after the feet, so a strafing player is looking at the thing it is
		// circling rather than at wherever it happens to be walking.
		for (const [player, handle] of this.tracking) {
			if (player.dead || player.removed) continue;
			const target = this.actor(handle);
			if (!target) continue;
			const toward = sub(target.pos, player.pos);
			if (toward.x || toward.y) player.yaw = yawOf(toward);
		}
	}

	/**
	 * Circle-strafe: a tangent step around the anchor plus a radial correction that pulls the
	 * player back onto the ring. The correction saturates over half the radius, so a player
	 * shoved off the ring by a body-block walks back to it instead of snapping.
	 */
	private orbitInput(player: PlayerActor, directive: Directive): Vec2 {
		const anchor = this.actor(directive.anchor as string);
		if (!anchor) return { x: 0, y: 0 };
		const outward = sub(player.pos, anchor.pos);
		const separation = Math.hypot(outward.x, outward.y);
		// Standing exactly on the anchor leaves no tangent to pick — step off it first.
		if (separation < 1) return { x: 1, y: 0 };
		const radius = directive.radius ?? separation;
		const out = scale(outward, 1 / separation);
		const tangent = directive.clockwise ? { x: out.y, y: -out.x } : { x: -out.y, y: out.x };
		const correction = clamp(-(separation - radius) / Math.max(1, radius * 0.5), -1, 1);
		return norm(add(tangent, scale(out, correction)));
	}

	/** Hold a range: back off inside `distance`, close outside 1.25x it, stand still between. */
	private keepAwayInput(player: PlayerActor, directive: Directive): Vec2 {
		const anchor = this.actor(directive.anchor as string);
		if (!anchor) return { x: 0, y: 0 };
		const outward = sub(player.pos, anchor.pos);
		const separation = Math.hypot(outward.x, outward.y);
		if (separation < 1) return { x: 1, y: 0 };
		const want = directive.radius ?? 0;
		if (separation < want) return norm(outward);
		if (separation > want * 1.25) return norm(scale(outward, -1));
		return { x: 0, y: 0 };
	}
}

export function runScenario(spec: ScenarioSpec, pack: AiPack, opts: RunOptions = {}): ScenarioResult {
	const seed = spec.seed ?? opts.seed ?? 20260731;
	const started = Date.now();
	const base: ScenarioResult = {
		id: spec.id, title: spec.title, tags: spec.tags, seed,
		passed: false, skipped: spec.skip ?? null, knownBug: spec.knownBug ?? null,
		checks: [], hash: '', simSeconds: spec.seconds, steps: 0, wallMs: 0, error: null, trace: null,
	};

	if (spec.skip) return { ...base, passed: true, wallMs: 0 };

	let run: ScenarioRun;
	try {
		run = new ScenarioRun(spec, pack, seed);
	} catch (err) {
		return { ...base, error: `build failed: ${(err as Error).message}`, wallMs: Date.now() - started };
	}

	const { world, enemies, players } = run;
	const labelOf = (actor: Actor | null | undefined) => run.labelOf(actor);
	const damage = run.damage;

	// --- record ---
	const sampleStep = 1 / SAMPLE_HZ;
	const stepsPerSample = Math.max(1, Math.round(sampleStep / FIXED_STEP));
	const agentSamples = new Map<string, AgentSample[]>();
	const playerSamples = new Map<string, PlayerSample[]>();
	const distances = new Map<string, Map<string, number[]>>();
	const attacks: AttackRecord[] = [];
	const lastCast = new Map<EnemyActor, Cast | null>();
	for (const handle of enemies.keys()) {
		agentSamples.set(handle, []);
		distances.set(handle, new Map());
	}
	for (const handle of players.keys()) playerSamples.set(handle, []);

	const sample = (): void => {
		for (const [handle, enemy] of enemies) {
			const frame = enemy.machine.rootFrame;
			const detection: Record<string, number> = {};
			for (const record of enemy.perception.sightRecords) {
				const who = labelOf(record.actor);
				if (who) detection[who] = record.strength;
			}
			agentSamples.get(handle)!.push({
				t: world.time,
				root: enemy.machine.activeRootName,
				path: frame.activePath.map((i) => frame.compiled.states[i]?.name ?? '?'),
				target: labelOf(enemy.perception.target),
				targetState: enemy.perception.getTargetState(),
				casting: enemy.casting?.tag ?? null,
				x: enemy.pos.x, y: enemy.pos.y, yaw: enemy.yaw,
				health: enemy.health,
				hasToken: world.coordinator.hasToken(enemy),
				attackTag: enemy.machine.context['Attack.Tag'] ?? null,
				detection,
				frozen: enemy.frozen,
				speed: enemy.speed,
			});
			const rows = distances.get(handle)!;
			for (const [otherHandle, other] of [...players, ...enemies, ...run.furniture] as Array<[string, Actor]>) {
				if (other === (enemy as Actor)) continue;
				if (!rows.has(otherHandle)) rows.set(otherHandle, []);
				rows.get(otherHandle)!.push(dist(enemy.pos, other.pos));
			}
		}
		for (const [handle, player] of players) {
			playerSamples.get(handle)!.push({
				t: world.time,
				x: player.pos.x, y: player.pos.y,
				health: player.health,
				grabbed: world.time < (player.grabbedUntil ?? -1),
			});
		}
	};

	// --- the loop ---
	const totalSteps = Math.round(spec.seconds / FIXED_STEP);
	let error: string | null = null;
	let stepsRun = 0;
	try {
		sample();
		for (let i = 0; i < totalSteps; i += 1) {
			run.step(FIXED_STEP);
			stepsRun += 1;

			// Casts are caught every step: a fast montage can start and finish inside one sample.
			for (const [handle, enemy] of enemies) {
				const previous = lastCast.get(enemy) ?? null;
				const current = enemy.casting;
				if (current && current !== previous) {
					attacks.push({
						t: world.time,
						agent: handle,
						tag: current.tag,
						target: labelOf(current.target),
						distance: current.target ? dist(enemy.pos, current.target.pos) : Infinity,
						dead: Boolean(world.abilities[current.tag]?.deadNote),
					});
				}
				lastCast.set(enemy, current);
			}

			if ((i + 1) % stepsPerSample === 0) sample();
		}
	} catch (err) {
		error = `threw at t=${world.time.toFixed(2)}s: ${(err as Error).message}`;
	}

	const hash = worldHash(world);
	const events: TimelineEvent[] = world.timeline;

	const agentTraces = new Map<string, AgentTrace>();
	for (const [handle, enemy] of enemies) {
		agentTraces.set(
			handle,
			buildAgentTrace(
				handle, enemy.enemyDef.id, agentSamples.get(handle)!,
				attacks.filter((a) => a.agent === handle), damage, distances.get(handle)!, sampleStep,
			),
		);
	}
	const playerTraces = new Map<string, PlayerTrace>();
	for (const handle of players.keys()) {
		playerTraces.set(handle, buildPlayerTrace(handle, playerSamples.get(handle)!, damage, sampleStep));
	}

	const agentHandles = [...enemies.keys()];
	const playerHandles = [...players.keys()];
	const trace: Trace = {
		spec, seed, simSeconds: world.time, steps: stepsRun,
		events, attacks, damage, agentHandles, playerHandles, hash,
		agent: (handle) => {
			const found = handle ? agentTraces.get(handle) : agentTraces.get(agentHandles[0]);
			if (!found) throw new Error(`no agent "${handle ?? '(first)'}" — have [${agentHandles.join(', ')}]`);
			return found;
		},
		player: (handle) => {
			const found = handle ? playerTraces.get(handle) : playerTraces.get(playerHandles[0]);
			if (!found) throw new Error(`no player "${handle ?? '(first)'}" — have [${playerHandles.join(', ')}]`);
			return found;
		},
	};

	const expect = makeExpect();
	if (!error) {
		try {
			spec.check(trace, expect);
		} catch (err) {
			error = `check threw: ${(err as Error).message}`;
		}
	}

	const passed = !error && expect.results.length > 0 && expect.results.every((r) => r.ok);
	return {
		...base,
		passed,
		checks: expect.results,
		hash,
		simSeconds: world.time,
		steps: stepsRun,
		wallMs: Date.now() - started,
		error,
		trace: opts.keepTrace === false ? null : trace,
	};
}
