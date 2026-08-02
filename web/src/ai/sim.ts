// The world: actors, navigation, senses routing, the combat coordinator, and the fixed-step
// tick that drives everything. Distances are Unreal units; time is seconds.

import {
	clamp, dist, dirOf, norm, sub, add, scale, rotateToward, yawOf, segmentsIntersect,
	distToSegment, makeRng, mixSeed, angleBetween,
} from './util';
import { Perception } from './perception';
import { BehaviorMachine } from './machine';
import { compileBehavior, resolvePerception, movementProfiles } from './pack';
import { canActivate } from './attack';
import type { Vec2 } from './util';
import type { AbilityData, AiPack, DefJson, TimelineEvent } from './types';
import { ABILITY_PACK } from './abilities';

/** Everything the abilities table carries, plus the tuning constants that ride with it. */
export interface AbilityPack {
	abilities: Record<string, AbilityData>;
	grantedByEnemy?: Record<string, { notGranted?: string[] }>;
	coordinator?: { maxSimultaneousAttackers?: number };
	approach?: { gapUnits?: number; defaultCapsuleRadius?: number };
	/** Measured collision radius per enemy definition id — capsules are not uniform. */
	capsuleRadiusByEnemy?: Record<string, number | string>;
}

export interface ActorOpts {
	x?: number;
	y?: number;
	yaw?: number;
	radius?: number;
	health?: number;
	label?: string;
	[k: string]: any;
}

export interface Wall {
	a: Vec2;
	b: Vec2;
	id: number;
}

export interface NavPath {
	points: Vec2[];
	blockedBy: EntityActor | null;
	failed: boolean;
}

export interface Cast {
	tag: string;
	target: Actor | null;
	ability: AbilityData;
	endsAt: number;
	commit: boolean;
	hitAt: number;
	hitDone: boolean;
	/** Set when the montage has run out. The action polls this rather than driving it. */
	finished?: boolean;
}

export type NavPolicy = 'breach' | 'blocking';

/** Navigation grid resolution. Coarse enough to path a 6000uu arena cheaply. */
const NAV_CELL = 100;
/** UScpCombatCoordinatorSubsystem::MaxSimultaneousAttackers. */
const DEFAULT_MAX_ATTACKERS = 2;
/** ReferenceSpeed on UScpStealthComponent — the speed that reads as motion 1.0. */
const MOTION_REFERENCE_SPEED = 600;
/** CrouchNoiseMultiplier on UScpStealthComponent. */
const CROUCH_NOISE_MULTIPLIER = 0.35;

/** Default world seed. Every world is seeded; scenarios override it to sweep. */
export const DEFAULT_WORLD_SEED = 20260731;

interface OpenCell {
	c: number;
	r: number;
	g: number;
	f: number;
}

/**
 * Binary min-heap over the A* open set.
 *
 * This used to be an array re-sorted on every pop, which is fine until something asks for a
 * path that does not exist: a failed search expands the WHOLE grid, and re-sorting a
 * thousand-entry open list a thousand times turned one unreachable target into ~9ms per
 * tick. A sealed-in player is a scenario the suite runs deliberately, so it has to be cheap.
 */
class CellHeap {
	private items: OpenCell[] = [];

	get size(): number {
		return this.items.length;
	}

	push(item: OpenCell): void {
		const items = this.items;
		items.push(item);
		let i = items.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (items[parent].f <= items[i].f) break;
			[items[parent], items[i]] = [items[i], items[parent]];
			i = parent;
		}
	}

	pop(): OpenCell | undefined {
		const items = this.items;
		if (!items.length) return undefined;
		const top = items[0];
		const last = items.pop() as OpenCell;
		if (!items.length) return top;
		items[0] = last;
		let i = 0;
		for (;;) {
			const left = i * 2 + 1;
			const right = left + 1;
			let smallest = i;
			if (left < items.length && items[left].f < items[smallest].f) smallest = left;
			if (right < items.length && items[right].f < items[smallest].f) smallest = right;
			if (smallest === i) break;
			[items[smallest], items[i]] = [items[i], items[smallest]];
			i = smallest;
		}
		return top;
	}
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

export class Actor {
	world: World;
	id: number;
	/**
	 * This actor's private random stream, derived from the world seed and the actor's id.
	 * Anything an agent rolls for itself (wander spots, `chance` conditions) MUST come from
	 * here rather than `world.rng`, so one agent's rolls can never be shifted by what another
	 * agent did — that coupling is what makes a shared stream untestable.
	 */
	rng: () => number;
	pos: Vec2;
	yaw: number;
	radius: number;
	label: string;
	velocity: Vec2;
	dead: boolean;
	removed: boolean;
	health: number;
	maxHealth: number;
	/** Set on every hit so the inspector can show raw-vs-after-armour. */
	lastDamage?: { raw: number; final: number; at: number; from?: string };

	// Discriminators. Declared on the base so call sites can test them without casting.
	isPawn?: boolean;
	isPlayer?: boolean;
	isEnemy?: boolean;
	isEntity?: boolean;
	kind?: string;

	// Player-only, read defensively elsewhere.
	grabbedUntil?: number;
	stealthed?: boolean;
	motionFactor01?: number;

	// Entity-only.
	breakable?: boolean;
	armour?: number;

	// Enemy-only.
	perception?: Perception;
	machine?: BehaviorMachine;

	constructor(world: World, opts: ActorOpts) {
		this.world = world;
		this.id = world.nextId++;
		this.rng = makeRng(mixSeed(world.seed, this.id));
		this.pos = { x: opts.x || 0, y: opts.y || 0 };
		this.yaw = opts.yaw ?? 0;
		this.radius = opts.radius ?? 42;
		this.label = opts.label || `actor${this.id}`;
		this.velocity = { x: 0, y: 0 };
		this.dead = false;
		this.removed = false;
		this.health = opts.health ?? 100;
		this.maxHealth = opts.health ?? 100;
	}

	get healthPct() {
		return this.maxHealth > 0 ? clamp(this.health / this.maxHealth, 0, 1) : 1;
	}
}

export class PlayerActor extends Actor {
	declare isPawn: boolean;
	declare isPlayer: boolean;
	declare stealthed: boolean;
	declare motionFactor01: number;
	declare grabbedUntil: number;
	crouched: boolean;
	moveInput: Vec2;
	speed: number;
	emitsFootstepNoise: boolean;
	noiseAccumulator: number;

	constructor(world: World, opts: ActorOpts) {
		super(world, { radius: 42, health: 100, ...opts });
		this.isPawn = true;
		this.isPlayer = true;
		this.kind = 'player';
		this.stealthed = false;
		this.crouched = false;
		this.motionFactor01 = 0;
		this.moveInput = { x: 0, y: 0 };
		this.speed = 600;
		this.emitsFootstepNoise = true;
		this.noiseAccumulator = 0;
		this.grabbedUntil = -1;
	}

	tick(delta: number): void {
		if (this.world.time < this.grabbedUntil) {
			this.velocity = { x: 0, y: 0 };
			this.motionFactor01 = 0;
			return;
		}
		const wish = norm(this.moveInput);
		const speed = this.speed * (this.crouched ? 0.45 : 1);
		this.velocity = scale(wish, speed);
		if (speed > 0 && (wish.x || wish.y)) {
			const next = add(this.pos, scale(this.velocity, delta));
			this.pos = this.world.slideAgainstBlockers(this.pos, next, this.radius);
		}

		// UScpStealthComponent::RefreshState — motion is speed over a 600uu reference.
		this.motionFactor01 = clamp(Math.hypot(this.velocity.x, this.velocity.y) / MOTION_REFERENCE_SPEED, 0, 1);
		const noiseBaseline = this.motionFactor01 * (this.crouched ? CROUCH_NOISE_MULTIPLIER : 1);

		// Footstep noise: emitted on a stride cadence, loudness = the stealth baseline.
		if (this.emitsFootstepNoise && noiseBaseline > 0.02) {
			this.noiseAccumulator += delta * (0.6 + this.motionFactor01 * 1.8);
			if (this.noiseAccumulator >= 1) {
				this.noiseAccumulator = 0;
				this.world.reportNoise(this.pos, noiseBaseline, 1500 + 1500 * noiseBaseline, this.world.time);
			}
		}
	}
}

/**
 * Blocking furniture, hydrated from a real `FD_*_DF` damageable-furniture definition:
 * `starting_health`, `furniture_armour` and the XY footprint of `blocking_collision_boxes`.
 * With no definition it falls back to plain numbers so scratch obstacles still work.
 */
export class EntityActor extends Actor {
	declare isEntity: boolean;
	declare breakable: boolean;
	declare armour: number;
	def: DefJson | null;
	halfExtent: number;
	armourName: string;
	blocksSight: boolean;
	deconstructionTier: number;
	defId: string | null;

	constructor(world: World, opts: ActorOpts) {
		const def = opts.def || null;
		const props = def?.properties || {};

		const halfExtent = opts.halfExtent ?? footprintHalfExtent(def) ?? 60;

		const health = opts.health ?? props.starting_health ?? 200;
		super(world, { radius: halfExtent, ...opts, health });

		this.isEntity = true;
		this.kind = 'furniture';
		this.def = def;
		this.halfExtent = halfExtent;
		this.armour = opts.armour ?? props.furniture_armour ?? 0;
		this.armourName = ARMOUR_TIERS[this.armour] || 'none';
		// `can_break_furniture` reads this: no destructible collection means it cannot be
		// broken, so the AI must route around it rather than retaliate.
		this.breakable = opts.breakable ?? (def ? Boolean(props.destructible_collection) : true);
		this.blocksSight = opts.blocksSight ?? true;
		this.deconstructionTier = props.deconstruction_tier ?? 0;
		this.label = opts.label || props.display_name || def?.id || 'Furniture';
		this.defId = def?.id ?? null;
	}
}

/** UDamageableFurnitureDefinition::GetEffectiveDragMass — the material tier names. */
const ARMOUR_TIERS: Record<number, string> = { 1: 'cardboard', 2: 'wood', 3: 'metal', 4: 'concrete' };

/**
 * Physical XY half-extent of a furniture definition, in uu.
 *
 * `box_size` is a HALF-extent already (it is fed to BoxTraceMulti as HalfSize), and the
 * SUPPORT box is the one that tracks the mesh AABB (≈ AABB × 1.03). The BLOCKING box is a
 * construction-placement concept — deliberately inset ~30% and lifted off the floor so a
 * ghost doesn't collide with the wall it is being built against — so it under-reports the
 * real footprint badly (a Bollard's blocking box is 1uu). Support first, blocking as a
 * fallback, null when neither is authored.
 */
export function footprintHalfExtent(def: DefJson | null): number | null {
	const props = def?.properties;
	if (!props) return null;
	for (const key of ['support_collision_boxes', 'blocking_collision_boxes']) {
		let widest = 0;
		for (const box of props[key] || []) {
			widest = Math.max(widest, box.box_size?.x || 0, box.box_size?.y || 0);
		}
		if (widest > 0) return widest;
	}
	return null;
}

/**
 * UScpHealthSet::CalculateArmorReducedDamage — the Valheim formula.
 * H = D - A when A < D/2 (flat), H = D² / (4A) when A >= D/2 (diminishing returns).
 */
export function armorReducedDamage(incoming: number, armor: number): number {
	if (armor <= 0) return incoming;
	if (incoming <= 0) return 0;
	const half = incoming * 0.5;
	if (armor < half) return Math.max(incoming - armor, 0);
	return (incoming * incoming) / (4 * armor);
}

export class EnemyActor extends Actor {
	declare isPawn: boolean;
	declare isEnemy: boolean;
	declare perception: Perception;
	declare machine: BehaviorMachine;
	enemyDef: DefJson;
	profiles: Record<string, { maxSpeed: number; accel: number; rotationRate: number }>;
	currentProfileName: string;
	maxSpeed: number;
	accel: number;
	rotationRate: number;
	speed: number;
	attacks: Array<{ ability: string; weight: number; minHealthPct?: number; maxHealthPct?: number }>;
	grantedAbilities: Set<string>;
	/** ED_ `token_cost` — HeavyStaff's 2 eats the whole attacker budget on its own. */
	tokenCost: number;
	paused: boolean;
	frozen: boolean;
	casting: Cast | null;
	attackTargetOverride: Actor | null;
	desiredMove: Vec2 | null;

	constructor(world: World, opts: ActorOpts) {
		super(world, { radius: 42, health: 200, ...opts });
		this.isPawn = true;
		this.isEnemy = true;
		this.kind = 'enemy';
		this.enemyDef = opts.enemyDef;
		this.label = opts.label ?? opts.enemyDef.id;

		this.profiles = movementProfiles(opts.enemyDef);
		this.currentProfileName = 'walk';
		this.maxSpeed = this.profiles.walk.maxSpeed;
		this.accel = this.profiles.walk.accel;
		this.rotationRate = this.profiles.walk.rotationRate;
		this.speed = 0;

		this.attacks = (opts.enemyDef.properties.attacks || []).map((a: any) => ({
			ability: a.ability,
			weight: a.weight ?? 1,
			minHealthPct: a.min_health_pct,
			maxHealthPct: a.max_health_pct,
		}));
		this.tokenCost = Math.max(1, opts.enemyDef.properties.token_cost ?? 1);

		const notGranted = new Set<string>(
			world.abilityPack.grantedByEnemy?.[opts.enemyDef.id]?.notGranted || [],
		);
		this.grantedAbilities = new Set<string>(
			this.attacks.map((a) => a.ability).filter((tag: string) => !notGranted.has(tag)),
		);

		this.paused = false;
		this.frozen = false;
		this.casting = null;
		this.attackTargetOverride = null;
		this.desiredMove = null;

		this.perception = new Perception(this, opts.profile, world);
		this.machine = new BehaviorMachine(this, opts.compiledBehavior, world);
		this.machine.start();
	}

	applyMovementProfile(name: string | undefined): void {
		if (!name) return;
		const profile = this.profiles[name];
		if (!profile) return;
		this.currentProfileName = name;
		this.maxSpeed = profile.maxSpeed;
		this.accel = profile.accel;
		this.rotationRate = profile.rotationRate;
	}

	stopMovement(): void {
		this.desiredMove = null;
		this.speed = 0;
		this.velocity = { x: 0, y: 0 };
	}

	followPath(path: NavPath, index: number, setIndex: (i: number) => void): void {
		let i = index;
		while (i < path.points.length - 1 && dist(this.pos, path.points[i]) < 60) i += 1;
		setIndex(i);
		this.desiredMove = path.points[i];
	}

	canActivate(tag: string, target: Actor | null, now: number, machine: BehaviorMachine) {
		return canActivate(this, tag, target, now, machine);
	}

	beginCast(cast: Cast): void {
		// Same object the action's memory holds, so the HUD ring and the hit window agree.
		this.casting = cast;
		// Attacks root the agent in place; the real abilities block movement input.
		this.stopMovement();
	}

	endCast(): void {
		this.casting = null;
	}

	cancelAbility(): void {
		this.casting = null;
	}

	tick(delta: number): void {
		if (this.dead) return;

		// Accel/decel toward the profile speed, then a rotation-rate-limited turn.
		const wantMove = this.desiredMove && !this.frozen && !this.casting;
		if (wantMove) {
			const toward = sub(this.desiredMove as Vec2, this.pos);
			const d = Math.hypot(toward.x, toward.y);
			if (d > 1) {
				const heading = yawOf(toward);
				this.yaw = rotateToward(this.yaw, heading, this.rotationRate * delta);
				this.speed = Math.min(this.maxSpeed, this.speed + this.accel * delta);
				// Turning hard costs speed, the way rotation-rate-limited navigation feels.
				const facingError = Math.abs(((heading - this.yaw + 540) % 360) - 180);
				const facingScale = facingError > 90 ? 0.15 : 1 - (facingError / 90) * 0.6;
				const step = Math.min(this.speed * facingScale * delta, d);
				const next = add(this.pos, scale(dirOf(this.yaw), step));
				this.pos = this.world.slideAgainstBlockers(this.pos, next, this.radius);
				this.velocity = scale(dirOf(this.yaw), this.speed * facingScale);
			} else {
				this.speed = 0;
				this.velocity = { x: 0, y: 0 };
			}
		} else {
			this.speed = Math.max(0, this.speed - this.accel * delta);
			this.velocity = { x: 0, y: 0 };
		}
	}
}

// ---------------------------------------------------------------------------
// Combat coordinator
// ---------------------------------------------------------------------------

export interface TokenPool {
	holders: Array<{ agent: Actor; cost: number; grantTime: number; lastAttackTime: number }>;
	claimants: Actor[];
	spotClaims: Array<{ agent: Actor; spot: Vec2; claimTime: number }>;
}

export class CombatCoordinator {
	maxSimultaneousAttackers: number;
	pools: Map<Actor, TokenPool>;
	/** UScpCombatCoordinatorSubsystem config (AI_Coordination.json values, defaults here). */
	stealDistanceRatio = 0.7;
	stealStallSeconds = 3.0;
	stealMinHoldSeconds = 2.0;
	private nextStealPassTime = 0;

	constructor(maxAttackers = DEFAULT_MAX_ATTACKERS) {
		this.maxSimultaneousAttackers = maxAttackers;
		this.pools = new Map();
	}

	poolFor(target: Actor): TokenPool {
		let pool = this.pools.get(target);
		if (!pool) {
			pool = { holders: [], claimants: [], spotClaims: [] };
			this.pools.set(target, pool);
		}
		return pool;
	}

	usedCost(pool: { holders: Array<{ cost: number }> }): number {
		return pool.holders.reduce((sum: number, h: { cost: number }) => sum + h.cost, 0);
	}

	tryClaim(agent: Actor | null, target: Actor | null, cost = 1, now = 0): boolean {
		if (!agent || !target) return false;
		const pool = this.poolFor(target);
		if (pool.holders.some((h) => h.agent === agent)) return true;
		if (this.usedCost(pool) + cost <= this.maxSimultaneousAttackers) {
			pool.holders.push({ agent, cost: Math.max(1, cost), grantTime: now, lastAttackTime: now });
			pool.claimants = pool.claimants.filter((c) => c !== agent);
			return true;
		}
		if (!pool.claimants.includes(agent)) pool.claimants.push(agent);
		return false;
	}

	hasToken(agent: Actor): boolean {
		for (const pool of this.pools.values()) {
			if (pool.holders.some((h) => h.agent === agent)) return true;
		}
		return false;
	}

	tokenTarget(agent: Actor): Actor | null {
		for (const [target, pool] of this.pools) {
			if (pool.holders.some((h) => h.agent === agent)) return target;
		}
		return null;
	}

	/** Release the agent's token AND spot claim — skill exit, suspension, stop, death. */
	release(agent: Actor): void {
		for (const pool of this.pools.values()) {
			pool.holders = pool.holders.filter((h) => h.agent !== agent);
			pool.claimants = pool.claimants.filter((c) => c !== agent);
			pool.spotClaims = pool.spotClaims.filter((c) => c.agent !== agent);
		}
	}

	notifyAttackStarted(agent: Actor, now: number): void {
		for (const pool of this.pools.values()) {
			for (const holder of pool.holders) {
				if (holder.agent === agent) holder.lastAttackTime = now;
			}
		}
	}

	claimSpot(agent: Actor, target: Actor, spot: Vec2, now = 0): void {
		const pool = this.poolFor(target);
		const existing = pool.spotClaims.find((c) => c.agent === agent);
		if (existing) {
			existing.spot = { ...spot };
			existing.claimTime = now;
			return;
		}
		pool.spotClaims.push({ agent, spot: { ...spot }, claimTime: now });
	}

	claimedSpots(target: Actor, ignoreAgent: Actor | null): Vec2[] {
		const pool = this.pools.get(target);
		if (!pool) return [];
		return pool.spotClaims.filter((c) => c.agent !== ignoreAgent).map((c) => c.spot);
	}

	/**
	 * The coordinator's own half-second pass: reclaim stalled holders, then let a meaningfully
	 * closer claimant steal the FARTHEST eligible holder's token, so the nearest enemy stays
	 * the threatening one. Both post AI.Event.TokenLost at the loser.
	 */
	tick(now: number, dead: (agent: Actor) => boolean): void {
		if (now < this.nextStealPassTime) return;
		this.nextStealPassTime = now + 0.5;

		for (const [target, pool] of [...this.pools]) {
			if (dead(target)) {
				for (const holder of pool.holders) this.postTokenLost(holder.agent);
				this.pools.delete(target);
				continue;
			}

			pool.holders = pool.holders.filter((h) => !dead(h.agent));
			pool.claimants = pool.claimants.filter((c) => !dead(c));
			pool.spotClaims = pool.spotClaims.filter((c) => !dead(c.agent));

			// Stalled-holder reclaim: a holder that hasn't swung for stealStallSeconds loses it.
			for (let index = pool.holders.length - 1; index >= 0; index -= 1) {
				const holder = pool.holders[index];
				if (now - holder.grantTime < this.stealMinHoldSeconds) continue;
				if (now - holder.lastAttackTime > this.stealStallSeconds) {
					pool.holders.splice(index, 1);
					this.postTokenLost(holder.agent);
				}
			}

			if (!pool.claimants.length || !pool.holders.length) {
				if (!pool.holders.length && !pool.claimants.length && !pool.spotClaims.length) {
					this.pools.delete(target);
				}
				continue;
			}

			let farthestIndex = -1;
			let farthestDistance = 0;
			for (let index = 0; index < pool.holders.length; index += 1) {
				const holder = pool.holders[index];
				if (now - holder.grantTime < this.stealMinHoldSeconds) continue;
				const d = dist(holder.agent.pos, target.pos);
				if (d > farthestDistance) {
					farthestDistance = d;
					farthestIndex = index;
				}
			}
			if (farthestIndex < 0) continue;

			let best: Actor | null = null;
			let bestDistance = Infinity;
			for (const claimant of pool.claimants) {
				const d = dist(claimant.pos, target.pos);
				if (d < bestDistance) {
					bestDistance = d;
					best = claimant;
				}
			}

			if (best && bestDistance < farthestDistance * this.stealDistanceRatio) {
				const loser = pool.holders[farthestIndex];
				pool.holders.splice(farthestIndex, 1);
				this.postTokenLost(loser.agent);
				pool.holders.push({ agent: best, cost: loser.cost, grantTime: now, lastAttackTime: now });
				pool.claimants = pool.claimants.filter((c) => c !== best);
			}
		}
	}

	private postTokenLost(agent: Actor): void {
		agent.machine?.postEvent('AI.Event.TokenLost');
	}
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
	pack: AiPack;
	abilityPack: AbilityPack;
	abilities: Record<string, AbilityData>;
	coordinator: CombatCoordinator;
	time: number;
	lastDelta: number;
	/**
	 * The world's own stream — used only for things the WORLD decides, never for anything an
	 * agent rolls (see `Actor.rng`). Seeded from `seed`, so two worlds built the same way from
	 * the same seed step identically forever.
	 */
	rng: () => number;
	seed: number;
	/** Per-world id counter: actor ids are a function of spawn order, not process history. */
	nextId: number;
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
	walls: Wall[];
	entities: EntityActor[];
	enemies: EnemyActor[];
	players: PlayerActor[];
	projectiles: Array<{ pos: Vec2; target: Actor | null; aim: Vec2; speed: number; owner: EnemyActor; damage: number; at: number; done?: boolean }>;
	hitMarkers: Array<{ pos: Vec2; at: number; reach?: number; halfWidth?: number; yaw?: number; dead?: boolean; label?: string; player?: boolean }>;
	daySection: string | null;
	paused: boolean;
	navDirty: boolean;
	sceneName?: string;
	lastNoise?: { location: Vec2; loudness: number; range: number; at: number };
	navCols = 0;
	navRows = 0;
	navBlocked: Uint8Array = new Uint8Array(0);
	navFurniture: Array<EntityActor | null> = [];
	/** Rolling decision log across every agent — feeds the timeline strip. */
	timeline: TimelineEvent[] = [];

	constructor(pack: AiPack, opts: { seed?: number } = {}) {
		this.pack = pack;
		this.seed = opts.seed ?? DEFAULT_WORLD_SEED;
		this.nextId = 1;
		// The ability table is baked in (see abilities.ts) — it is NOT part of the mod pack.
		this.abilityPack = ABILITY_PACK;
		this.abilities = this.abilityPack.abilities || {};
		this.coordinator = new CombatCoordinator(
			this.abilityPack.coordinator?.maxSimultaneousAttackers ?? DEFAULT_MAX_ATTACKERS,
		);

		this.time = 0;
		this.lastDelta = 1 / 60;
		this.rng = makeRng(mixSeed(this.seed, 0));

		this.bounds = { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
		this.walls = [];
		this.entities = [];
		this.enemies = [];
		this.players = [];
		this.projectiles = [];
		this.hitMarkers = [];

		this.daySection = null;
		this.paused = false;
		this.navDirty = true;
	}

	get actors() {
		return [...this.players, ...this.enemies, ...this.entities];
	}

	// --- construction ---

	addPlayer(opts: ActorOpts): PlayerActor {
		const player = new PlayerActor(this, { label: `Player ${this.players.length + 1}`, ...opts });
		this.players.push(player);
		return player;
	}

	addEnemy(enemyDef: DefJson, opts: ActorOpts): EnemyActor {
		const profile = resolvePerception(this.pack.perception, enemyDef.properties.perception, this.daySection);
		const behaviorDef = this.pack.behaviors[enemyDef.properties.behavior];
		if (!behaviorDef) throw new Error(`missing behavior ${enemyDef.properties.behavior}`);
		const compiled = compileBehavior(behaviorDef, this.pack.skills);
		// Real capsule radius, measured in-game. Every reach question — what the approach
		// settles at, and the surface-to-surface gap the attack gate gates on — is computed
		// from this, so a uniform 42uu default silently falsifies both for the big enemies.
		const measuredRadius = this.abilityPack.capsuleRadiusByEnemy?.[enemyDef.id];
		const enemy = new EnemyActor(this, {
			...(typeof measuredRadius === 'number' ? { radius: measuredRadius } : {}),
			enemyDef,
			profile,
			compiledBehavior: compiled,
			label: `${enemyDef.properties.display_name} ${this.enemies.length + 1}`,
			...opts,
		});
		this.enemies.push(enemy);
		return enemy;
	}

	addWall(a: Vec2, b: Vec2): void {
		this.walls.push({ a, b, id: this.nextId++ });
		this.navDirty = true;
	}

	addEntity(opts: ActorOpts): EntityActor {
		const entity = new EntityActor(this, opts);
		this.entities.push(entity);
		this.navDirty = true;
		return entity;
	}

	remove(actor: Actor): void {
		actor.removed = true;
		this.players = this.players.filter((a) => a !== actor);
		this.enemies = this.enemies.filter((a) => a !== actor);
		this.entities = this.entities.filter((a) => a !== actor);
		this.coordinator.release(actor);
		this.navDirty = true;
	}

	setDaySection(section: string | null): void {
		this.daySection = section;
		for (const enemy of this.enemies) {
			enemy.perception.setProfile(
				resolvePerception(this.pack.perception, enemy.enemyDef.properties.perception, section),
			);
			enemy.machine.context['World.DaySection'] = section;
		}
	}

	// --- senses routing ---

	hostilePawnsFor(_agent?: Actor): PlayerActor[] {
		return this.players.filter((p) => !p.dead && !p.removed);
	}

	/** UScpSensesSubsystem::ReportNoise — one emission, fanned out to every listener. */
	reportNoise(location: Vec2, loudness: number, range: number, now: number): void {
		if (loudness <= 0 || range <= 0) return;
		this.lastNoise = { location: { ...location }, loudness, range, at: now };
		for (const enemy of this.enemies) {
			if (enemy.dead) continue;
			enemy.perception.notifyNoise(location, loudness, range, now);
		}
	}

	/**
	 * UScpSensesSubsystem::PropagateAlert — ForceSee(instantSpot) on EVERY agent in radius.
	 * Deliberately not filtered by whether the ally already has a target: an engaged
	 * neighbour still gets the record, and the steal rule is what decides if it matters.
	 */
	alertAllies(source: { pos: Vec2 }, target: Actor, radius: number, now: number): void {
		for (const enemy of this.enemies) {
			if (enemy === source || enemy.dead) continue;
			if (dist(enemy.pos, source.pos) > radius) continue;
			const record = enemy.perception.findOrAddSightRecord(target, now);
			if (!record) continue;
			record.sensedNow = true;
			record.lastKnownLocation = { ...target.pos };
			record.lastSeenTime = now;
			record.lastSensedTime = now;
			record.strength = 1;
			record.spotted = true;
		}
	}

	/**
	 * ScpAi2::FindSpot's ring generator, reduced to the part behaviour depends on: a
	 * navigable point on the ring around `centre` that is not on top of another agent's
	 * claimed spot. Deterministic — it walks fixed angular slots from the agent's own stream.
	 */
	findRingSpot(
		agent: Actor,
		centre: Vec2,
		radius: number,
		jitter: number,
		claimed: Vec2[],
		navPolicy: NavPolicy,
	): Vec2 | null {
		const slots = 12;
		const offset = agent.rng() * Math.PI * 2;
		let best: Vec2 | null = null;
		let bestScore = -Infinity;
		for (let slot = 0; slot < slots; slot += 1) {
			const angle = offset + (slot / slots) * Math.PI * 2;
			const r = radius + (jitter > 0 ? (agent.rng() * 2 - 1) * jitter : 0);
			const spot = { x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r };
			if (this.findPath(agent.pos, spot, navPolicy, agent).failed) continue;
			// Separation scorer: farther from every other claim is better.
			let score = 0;
			for (const other of claimed) score -= 1 / Math.max(dist(spot, other), 1);
			// Mild bias toward the spot the agent can reach soonest.
			score -= dist(agent.pos, spot) / 10000;
			if (score > bestScore) {
				bestScore = score;
				best = spot;
			}
		}
		return best;
	}

	// --- damage ---

	resolveAttackHit(agent: EnemyActor, cast: Cast): void {
		const ability = cast.ability || this.abilities[cast.tag];
		if (!ability) return;
		if (ability.deadNote || ability.granted === false) {
			this.hitMarkers.push({ pos: { ...agent.pos }, at: this.time, dead: true, label: 'no-op' });
			return;
		}

		if (ability.kind === 'ranged') {
			this.projectiles.push({
				pos: { ...agent.pos },
				target: cast.target,
				aim: cast.target ? { ...cast.target.pos } : { ...agent.pos },
				speed: ability.projectileSpeed || 1400,
				owner: agent,
				damage: 12,
				at: this.time,
			});
			return;
		}

		// Melee/grab/charge: the notify window is a box in front of the mesh origin.
		const reach = ability.hitboxReach || 0;
		if (reach <= 0) {
			this.hitMarkers.push({ pos: { ...agent.pos }, at: this.time, dead: true, label: 'no hitbox' });
			return;
		}
		const halfWidth = ability.hitboxHalfWidth || 50;
		const forward = dirOf(agent.yaw);
		const centre = add(agent.pos, scale(forward, reach * 0.5));

		for (const victim of [...this.players, ...this.entities] as Actor[]) {
			if (victim === (agent as Actor) || victim.dead) continue;
			const to = sub(victim.pos, agent.pos);
			const along = to.x * forward.x + to.y * forward.y;
			const across = Math.abs(-to.x * forward.y + to.y * forward.x);
			if (along < -victim.radius || along > reach + victim.radius) continue;
			if (across > halfWidth + victim.radius) continue;

			this.applyDamage(agent, victim, 12);
			if (ability.kind === 'grab' && victim.isPlayer) {
				victim.grabbedUntil = this.time + (ability.grabHoldSeconds || 3);
				// A grab drags the victim to the attacker's face.
				const want = add(agent.pos, scale(forward, agent.radius + victim.radius));
				victim.pos = want;
			}
		}
		this.hitMarkers.push({ pos: centre, at: this.time, reach, halfWidth, yaw: agent.yaw });
	}

	applyDamage(source: Actor | null, victim: Actor, amount: number): void {
		// Armour reduction happens in ScpHealthSet for every damage GE; furniture armour is
		// the material tier (1 cardboard … 4 concrete) written onto the entity's ASC.
		const final = armorReducedDamage(amount, victim.armour || 0);
		victim.health = Math.max(0, victim.health - final);
		victim.lastDamage = { raw: amount, final, at: this.time, from: source?.label };

		// UScpSensesSubsystem routes the damage message: the victim senses its attacker, the
		// attacker records that it drew blood (the stalemate clock).
		if (victim.isPawn && victim.perception) victim.perception.notifyDamage(source, final, this.time);
		if (source?.perception) source.perception.notifyDamageDealt(this.time);

		if (victim.health <= 0 && !victim.dead) {
			victim.dead = true;
			if (victim.isEntity) this.navDirty = true;
		}
	}

	/** Player attacking an enemy — feeds the damage sense, the steal rule and the grudge. */
	playerAttack(player: PlayerActor, damage = 25, range = 250): EnemyActor | null {
		const forward = dirOf(player.yaw);
		let hit: { enemy: EnemyActor; d: number } | null = null;
		for (const enemy of this.enemies) {
			if (enemy.dead) continue;
			const to = sub(enemy.pos, player.pos);
			const d = Math.hypot(to.x, to.y);
			if (d > range + enemy.radius) continue;
			if (angleBetween(forward, to) > 60) continue;
			if (!hit || d < hit.d) hit = { enemy, d };
		}
		if (!hit) return null;
		this.applyDamage(player, hit.enemy, damage);
		this.hitMarkers.push({ pos: { ...hit.enemy.pos }, at: this.time, player: true });
		return hit.enemy;
	}

	// --- line of sight & navigation ---

	hasLineOfSight(from: Vec2, to: Vec2): boolean {
		for (const wall of this.walls) {
			if (segmentsIntersect(from, to, wall.a, wall.b)) return false;
		}
		for (const entity of this.entities) {
			if (!entity.blocksSight || entity.dead) continue;
			if (distToSegment(entity.pos, from, to) < entity.halfExtent) {
				// Endpoints inside the box don't count as occluded by it.
				if (dist(entity.pos, from) > entity.halfExtent && dist(entity.pos, to) > entity.halfExtent) {
					return false;
				}
			}
		}
		return true;
	}

	blockersFor(navPolicy: NavPolicy): EntityActor[] {
		// Nav policy rides the root: aggro roots BREACH (furniture is pathable at a cost),
		// everything else treats furniture as blocking.
		return navPolicy === 'breach' ? [] : this.entities.filter((e) => !e.dead);
	}

	slideAgainstBlockers(from: Vec2, to: Vec2, radius: number): Vec2 {
		let out = { ...to };
		for (const wall of this.walls) {
			if (distToSegment(out, wall.a, wall.b) < radius) {
				// Project back out along the wall normal.
				const along = norm(sub(wall.b, wall.a));
				const rel = sub(out, wall.a);
				const t = rel.x * along.x + rel.y * along.y;
				const closest = add(wall.a, scale(along, t));
				const push = norm(sub(out, closest));
				out = add(closest, scale(push.x || push.y ? push : { x: 1, y: 0 }, radius + 1));
			}
		}
		for (const entity of this.entities) {
			if (entity.dead) continue;
			const d = dist(out, entity.pos);
			const min = radius + entity.halfExtent * 0.8;
			if (d < min) {
				const push = norm(sub(out, entity.pos));
				out = add(entity.pos, scale(push.x || push.y ? push : { x: 1, y: 0 }, min));
			}
		}
		out.x = clamp(out.x, this.bounds.minX + radius, this.bounds.maxX - radius);
		out.y = clamp(out.y, this.bounds.minY + radius, this.bounds.maxY - radius);
		return out;
	}

	buildNavGrid(): void {
		const { minX, minY, maxX, maxY } = this.bounds;
		this.navCols = Math.ceil((maxX - minX) / NAV_CELL);
		this.navRows = Math.ceil((maxY - minY) / NAV_CELL);
		this.navBlocked = new Uint8Array(this.navCols * this.navRows);
		this.navFurniture = new Array(this.navCols * this.navRows).fill(null);

		for (let row = 0; row < this.navRows; row += 1) {
			for (let col = 0; col < this.navCols; col += 1) {
				const p = this.cellCentre(col, row);
				let blocked = 0;
				for (const wall of this.walls) {
					if (distToSegment(p, wall.a, wall.b) < NAV_CELL * 0.75) {
						blocked = 1;
						break;
					}
				}
				this.navBlocked[row * this.navCols + col] = blocked;
				if (!blocked) {
					for (const entity of this.entities) {
						if (entity.dead) continue;
						if (dist(p, entity.pos) < entity.halfExtent + NAV_CELL * 0.4) {
							this.navFurniture[row * this.navCols + col] = entity;
							break;
						}
					}
				}
			}
		}
		this.navDirty = false;
	}

	cellCentre(col: number, row: number): Vec2 {
		return {
			x: this.bounds.minX + col * NAV_CELL + NAV_CELL / 2,
			y: this.bounds.minY + row * NAV_CELL + NAV_CELL / 2,
		};
	}

	cellOf(p: Vec2): { col: number; row: number } {
		return {
			col: clamp(Math.floor((p.x - this.bounds.minX) / NAV_CELL), 0, this.navCols - 1),
			row: clamp(Math.floor((p.y - this.bounds.minY) / NAV_CELL), 0, this.navRows - 1),
		};
	}

	/**
	 * A* over the nav grid. Under `breach` furniture is pathable at a cost (health-bucket
	 * costs in the real filter); under `blocking` it is impassable. The first furniture cell
	 * a breach path crosses becomes $Path.BlockingEntity.
	 */
	findPath(from: Vec2, to: Vec2, navPolicy: NavPolicy, _agent?: Actor): NavPath {
		if (this.navDirty) this.buildNavGrid();
		const start = this.cellOf(from);
		const goal = this.cellOf(to);
		const cols = this.navCols;
		const rows = this.navRows;
		const index = (c: number, r: number) => r * cols + c;

		const passable = (c: number, r: number): boolean => {
			if (this.navBlocked[index(c, r)]) return false;
			const furniture = this.navFurniture[index(c, r)];
			if (!furniture) return true;
			// Breach only makes DAMAGEABLE furniture pathable. In the game non-damageable
			// furniture is a full navmesh cut with no area override, so an aggro root has to
			// route around it exactly like a wall — it can never be smashed out of the way.
			return navPolicy === 'breach' && Boolean(furniture.breakable);
		};

		const costOf = (c: number, r: number) => (this.navFurniture[index(c, r)] ? 8 : 1);

		const open = new CellHeap();
		open.push({ c: start.col, r: start.row, g: 0, f: 0 });
		const cameFrom = new Map<number, number>();
		const gScore = new Map<number, number>([[index(start.col, start.row), 0]]);
		const closed = new Set<number>();
		const h = (c: number, r: number) => Math.hypot(c - goal.col, r - goal.row);
		let found: { c: number; r: number } | null = null;
		let guard = 0;

		while (open.size && guard++ < 20000) {
			const current = open.pop() as OpenCell;
			const key = index(current.c, current.r);
			if (closed.has(key)) continue;
			closed.add(key);
			if (current.c === goal.col && current.r === goal.row) {
				found = current;
				break;
			}
			for (let dc = -1; dc <= 1; dc += 1) {
				for (let dr = -1; dr <= 1; dr += 1) {
					if (!dc && !dr) continue;
					const nc = current.c + dc;
					const nr = current.r + dr;
					if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
					if (!passable(nc, nr)) continue;
					// No corner cutting through a blocked diagonal.
					if (dc && dr && (!passable(current.c + dc, current.r) || !passable(current.c, current.r + dr))) {
						continue;
					}
					const step = (dc && dr ? 1.414 : 1) * costOf(nc, nr);
					const g = current.g + step;
					const nk = index(nc, nr);
					if (gScore.has(nk) && (gScore.get(nk) as number) <= g) continue;
					gScore.set(nk, g);
					cameFrom.set(nk, key);
					open.push({ c: nc, r: nr, g, f: g + h(nc, nr) });
				}
			}
		}

		if (!found) return { points: [], blockedBy: null, failed: true };

		const cells: number[] = [];
		let cursor: number | undefined = index(found.c, found.r);
		while (cursor !== undefined) {
			cells.unshift(cursor);
			cursor = cameFrom.get(cursor);
		}

		let blockedBy: EntityActor | null = null;
		const points: Vec2[] = cells.map((cell) => {
			const c = cell % cols;
			const r = Math.floor(cell / cols);
			if (!blockedBy && this.navFurniture[cell]) blockedBy = this.navFurniture[cell];
			return this.cellCentre(c, r);
		});
		points.push({ ...to });
		return { points, blockedBy, failed: false };
	}

	isPathable(from: Vec2, to: Vec2, navPolicy: NavPolicy): boolean {
		return !this.findPath(from, to, navPolicy).failed;
	}

	pickWanderSpot(origin: Vec2, ringMin: number, ringMax: number, agent: Actor, navPolicy: NavPolicy): Vec2 | null {
		// The agent's own stream: two enemies wandering side by side must not interleave rolls.
		const roll = agent.rng ?? this.rng;
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const angle = roll() * Math.PI * 2;
			const radius = ringMin + roll() * (ringMax - ringMin);
			const spot = {
				x: clamp(origin.x + Math.cos(angle) * radius, this.bounds.minX + 100, this.bounds.maxX - 100),
				y: clamp(origin.y + Math.sin(angle) * radius, this.bounds.minY + 100, this.bounds.maxY - 100),
			};
			if (!this.findPath(agent.pos, spot, navPolicy, agent).failed) return spot;
		}
		return null;
	}

	/**
	 * Drive every in-flight attack to completion, independent of the behaviour machine.
	 *
	 * An ability lives on the ASC, not on the action that started it: `bCommitToAttack`
	 * means it cannot be CANCELLED, but it still ends when its montage does. Ticking it from
	 * the action left a committed attack that got interrupted (root switch, skill exit)
	 * casting forever, which blocked every later attack with "already casting".
	 */
	advanceCasts(delta: number): void {
		for (const enemy of this.enemies) {
			const cast = enemy.casting;
			if (!cast) continue;

			// Face the target through the swing — bTurnAvatarTowardsTarget on the real ability.
			if (cast.target) {
				const want = yawOf(sub(cast.target.pos, enemy.pos));
				enemy.yaw = rotateToward(enemy.yaw, want, enemy.rotationRate * delta);
			}
			if (!cast.hitDone && this.time >= cast.hitAt) {
				cast.hitDone = true;
				this.resolveAttackHit(enemy, cast);
			}
			if (this.time >= cast.endsAt) {
				cast.finished = true;
				enemy.endCast();
			}
		}
	}

	/**
	 * Capsule-vs-capsule separation between pawns.
	 *
	 * This matters more than it looks: `SKL_Engage` drives to `$Attack.MaxRange × 0.9`, which
	 * is the capsule-sum approach envelope (r + r + 40) — about 111uu for two 42uu pawns.
	 * Several enemies have a melee `MaxRange` BELOW that (MaleStaff 50, TVHead/Gardener 100),
	 * so whether they can attack at all comes down to how far collision lets them press in.
	 * Without this step they float at the acceptance radius and look permanently broken.
	 */
	separatePawns(): void {
		const pawns = [...this.players, ...this.enemies].filter((a) => !a.dead);
		for (let i = 0; i < pawns.length; i += 1) {
			for (let j = i + 1; j < pawns.length; j += 1) {
				const a = pawns[i];
				const b = pawns[j];
				const minimum = a.radius + b.radius;
				const delta = sub(b.pos, a.pos);
				const d = Math.hypot(delta.x, delta.y);
				if (d >= minimum || d < 1e-4) continue;
				const push = scale(norm(delta), (minimum - d) * 0.5);
				// A grabbed pawn is held in place by the grab, not pushed out of it.
				if (this.time >= (a.grabbedUntil ?? -1)) a.pos = sub(a.pos, push);
				if (this.time >= (b.grabbedUntil ?? -1)) b.pos = add(b.pos, push);
			}
		}
	}

	// --- tick ---

	step(delta: number): void {
		this.lastDelta = delta;
		this.time += delta;

		for (const player of this.players) player.tick(delta);

		for (const enemy of this.enemies) {
			if (enemy.dead || enemy.paused) continue;
			enemy.perception.tick(this.time);

			// combatStartTime drives every ability warm-up (minCombatSeconds).
			if (enemy.perception.target && enemy.machine.combatStartTime < 0) {
				enemy.machine.combatStartTime = this.time;
			} else if (!enemy.perception.target) {
				enemy.machine.combatStartTime = -1;
			}

			enemy.machine.tick(delta);
			enemy.tick(delta);
		}
		// The coordinator runs its own half-second pass; tokens are released by the skill
		// frame tearing down, never by an external sweep over who holds what target.
		this.coordinator.tick(this.time, (actor) => actor.dead || actor.removed);

		this.advanceCasts(delta);
		this.separatePawns();

		for (const projectile of this.projectiles) {
			const to = sub(projectile.aim, projectile.pos);
			const d = Math.hypot(to.x, to.y);
			const step = projectile.speed * delta;
			if (d <= step) {
				projectile.done = true;
				for (const player of this.players) {
					if (dist(player.pos, projectile.aim) < player.radius + 40) {
						this.applyDamage(projectile.owner, player, projectile.damage);
					}
				}
				continue;
			}
			projectile.pos = add(projectile.pos, scale(norm(to), step));
			if (!this.hasLineOfSight(projectile.pos, add(projectile.pos, scale(norm(to), 10)))) {
				projectile.done = true;
			}
		}
		this.projectiles = this.projectiles.filter((p) => !p.done);
		this.hitMarkers = this.hitMarkers.filter((m) => this.time - m.at < 0.4);
	}
}
