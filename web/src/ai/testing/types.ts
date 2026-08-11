// Scenario shapes for the deterministic AI test harness.
//
// A scenario is DATA: a world to build, a script of timed inputs, and a set of checks run
// against the recorded trace afterwards. Nothing in here touches the DOM, the filesystem or
// the clock, so the exact same scenario runs in the browser (the AI tab's Scenarios view)
// and headlessly under node.

import type { Vec2 } from '../util';
import type { AiPack, DefJson, TimelineEvent } from '../types';

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

/** Prebuilt arenas. `box` is a plain walled rectangle; the rest add interior geometry. */
export type ArenaName = 'box' | 'open' | 'corridor' | 'shop' | 'pillar' | 'room';

export interface EnemySpec {
	/** Handle used by the script and the checks. Defaults to the definition id. */
	as?: string;
	def: string;
	x: number;
	y: number;
	yaw?: number;
	health?: number;
	/**
	 * Nails the agent to the spot facing its spawn yaw while brain, senses and machine keep
	 * running. This is the seam that makes pure perception tests possible: an unfrozen enemy
	 * patrols, and a patrolling enemy turns, so "never spots the player" would really be
	 * testing which way the wander happened to point it.
	 */
	frozen?: boolean;
	/** Fully inert — no brain, no senses. For bystanders that must not join in. */
	paused?: boolean;
}

export interface PlayerSpec {
	as?: string;
	x: number;
	y: number;
	yaw?: number;
	health?: number;
	crouched?: boolean;
	stealthed?: boolean;
	/** Footstep noise is on by default; turn it off to isolate sight from hearing. */
	silent?: boolean;
	/** Run at the sprint speed (GE_SprintSpeedBoost, 1.4x the walk) for the whole scenario. */
	sprint?: boolean;
	speed?: number;
}

export interface FurnitureSpec {
	as?: string;
	/** A `damageable_furniture_definitions` id. Omit to use the raw numbers below. */
	def?: string;
	x: number;
	y: number;
	health?: number;
	armour?: number;
	halfExtent?: number;
	breakable?: boolean;
	blocksSight?: boolean;
}

/** One timed input. Every step carries the sim time (seconds) it fires at. */
export type ScriptStep = { at: number } & (
	| { move: string; to: Vec2 }
	| { move: string; dir: Vec2 }
	| { move: string; awayFrom: string }
	/**
	 * Circle-strafe: hold `radius` from `orbit` and slide around it. This is what a player
	 * actually does in a melee fight, and it is the input that separates an enemy which
	 * tracks you from one that swings where you used to be.
	 */
	| { move: string; orbit: string; radius?: number; clockwise?: boolean }
	/**
	 * Kite: back off when closer than `distance`, close the gap when further than 1.25x it.
	 * Holds a chosen range against something that is trying to close.
	 */
	| { move: string; keepAway: string; distance: number }
	/**
	 * Keep facing an actor every step, the way a mouse does — independent of where the feet
	 * are going, so it composes with any of the move directives above. `null` releases it.
	 * Without this a strafing player keeps its spawn yaw and its own swings miss.
	 */
	| { who: string; track: string | null }
	| { stop: string }
	| { who: string; crouch: boolean }
	| { who: string; stealth: boolean }
	| { who: string; teleport: Vec2 }
	| { who: string; face: number }
	| { who: string; silent: boolean }
	| { who: string; frozen: boolean }
	| { who: string; paused: boolean }
	/** Player swings at whatever is in front of them — the real damage-sense path. */
	| { attack: string; damage?: number; range?: number }
	/** Direct damage, bypassing geometry: `to` takes damage from `from`. */
	| { damage: { to: string; from?: string; amount: number } }
	| { noise: { at: Vec2; loudness?: number; range?: number } }
	/** Plant a target through the ally-alert path, the way a spotter would. */
	| { alert: { enemy?: string; target: string; radius?: number } }
	| { kill: string }
	| { remove: string }
	| { daySection: string | null }
	/** Escape hatch for anything the declarative steps don't cover. */
	| { run: (ctx: ScenarioContext) => void }
);

export interface ScenarioSpec {
	id: string;
	title: string;
	/** Free-form grouping: 'perception', 'combat', 'nav', 'aggro', 'regression', ... */
	tags: string[];
	/** How long to simulate, in sim-seconds. */
	seconds: number;
	/** Overrides the runner's seed. Use only when a scenario needs a specific roll. */
	seed?: number;
	arena?: ArenaName;
	bounds?: { minX: number; minY: number; maxX: number; maxY: number };
	/** Extra walls as [ax, ay, bx, by]. */
	walls?: Array<[number, number, number, number]>;
	daySection?: string | null;
	players?: PlayerSpec[];
	enemies?: EnemySpec[];
	furniture?: FurnitureSpec[];
	script?: ScriptStep[];
	/** Assertions over the finished trace. Never throws — it records verdicts. */
	check: (trace: Trace, expect: Expect) => void;
	/**
	 * Set when the scenario documents a KNOWN defect rather than desired behaviour. The
	 * runner reports these separately so a red bar always means a regression.
	 */
	knownBug?: string;
	/** Skip with a reason rather than deleting a scenario that is temporarily unrunnable. */
	skip?: string;
}

/** What the harness hands to `run` steps and to scenario builders. */
export interface ScenarioContext {
	world: any;
	pack: AiPack;
	enemy: (handle: string) => any;
	player: (handle: string) => any;
	furniture: (handle: string) => any;
	def: (folder: keyof AiPack, id: string) => DefJson | undefined;
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

export interface AgentSample {
	t: number;
	root: string | null;
	/** Active state names, outermost first — the leaf is the last entry. */
	path: string[];
	target: string | null;
	targetState: string;
	casting: string | null;
	x: number;
	y: number;
	yaw: number;
	health: number;
	hasToken: boolean;
	attackTag: string | null;
	/** Sight fill 0..1 per sensed pawn label. */
	detection: Record<string, number>;
	frozen: boolean;
	speed: number;
}

export interface PlayerSample {
	t: number;
	x: number;
	y: number;
	health: number;
	grabbed: boolean;
}

export interface AttackRecord {
	t: number;
	agent: string;
	tag: string;
	target: string | null;
	distance: number;
	/** The ability carries a `deadNote` — it plays a montage and resolves to nothing. */
	dead: boolean;
}

export interface DamageRecord {
	t: number;
	from: string | null;
	to: string;
	raw: number;
	final: number;
	victimKind: string;
}

export interface Trace {
	spec: ScenarioSpec;
	seed: number;
	simSeconds: number;
	steps: number;
	events: TimelineEvent[];
	attacks: AttackRecord[];
	damage: DamageRecord[];
	/** Every agent handle in the scenario, in spawn order. */
	agentHandles: string[];
	playerHandles: string[];
	agent(handle?: string): AgentTrace;
	player(handle?: string): PlayerTrace;
	/** Digest of the finished world — identical runs produce identical hashes. */
	hash: string;
}

export interface AgentTrace {
	handle: string;
	defId: string;
	samples: AgentSample[];
	/** Every root this agent ever selected, in first-seen order. */
	roots: string[];
	/** Every leaf state name it ever entered. */
	states: string[];
	attacks: AttackRecord[];
	final: AgentSample;

	at(t: number): AgentSample;
	everRoot(name: string): boolean;
	firstRootTime(name: string): number | null;
	secondsInRoot(name: string): number;
	rootSwitches: number;
	everState(name: string): boolean;
	firstStateTime(name: string): number | null;

	targetAt(t: number): string | null;
	firstTargetTime(handle?: string): number | null;
	targetSwitches: number;
	targetsHeld: string[];
	/** True when the agent held `handle` as its target for `seconds` continuously. */
	heldTargetFor(handle: string, seconds: number): boolean;

	firstAttackTime(tag?: string): number | null;
	attackTags: string[];
	damageDealtTo(handle: string): number;

	minDistTo(handle: string): number;
	maxDistTo(handle: string): number;
	distToAt(handle: string, t: number): number;
	distanceTravelled: number;
	/** Peak detection fill this agent ever reached on `handle`. */
	peakDetection(handle: string): number;
	secondsWithToken: number;
}

export interface PlayerTrace {
	handle: string;
	samples: PlayerSample[];
	final: PlayerSample;
	at(t: number): PlayerSample;
	damageTaken: number;
	everGrabbed: boolean;
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

export interface CheckResult {
	name: string;
	ok: boolean;
	detail: string;
}

/** Recording assertions — they never throw, so one bad check can't hide the rest. */
export interface Expect {
	results: CheckResult[];
	ok(name: string, condition: boolean, detail?: string): boolean;
	eq(name: string, actual: unknown, expected: unknown): boolean;
	lte(name: string, actual: number | null, bound: number): boolean;
	gte(name: string, actual: number | null, bound: number): boolean;
	lt(name: string, actual: number | null, bound: number): boolean;
	gt(name: string, actual: number | null, bound: number): boolean;
	between(name: string, actual: number | null, lo: number, hi: number): boolean;
	/** `actual` must be a number, i.e. the event happened at all, and be <= bound. */
	happenedWithin(name: string, actual: number | null, bound: number): boolean;
	neverHappened(name: string, actual: number | null): boolean;
	contains(name: string, haystack: string[], needle: string): boolean;
	excludes(name: string, haystack: string[], needle: string): boolean;
}

export interface ScenarioResult {
	id: string;
	title: string;
	tags: string[];
	seed: number;
	passed: boolean;
	skipped: string | null;
	knownBug: string | null;
	checks: CheckResult[];
	hash: string;
	simSeconds: number;
	steps: number;
	wallMs: number;
	error: string | null;
	trace: Trace | null;
}
