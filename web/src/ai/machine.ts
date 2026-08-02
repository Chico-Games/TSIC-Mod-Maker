// Behavior machine — a port of UScpBehaviorMachine + ScpBehaviorNodes.
//
// The tick order is the one that matters and is copied exactly:
//   1. SelectRoot (paced by root_eval_interval, forced by any queued event)
//   2. per frame: process transitions (queued events first, then OnTick top-down)
//   3. tick actions parents-before-leaves; leaf all-succeeded fires actions_succeeded
//   4. any action failure bubbles OnActionFailed up the active path, then fails the frame
//
// Leaf commitment (min_commit_seconds) blocks preemption but never blocks completion.

import { dist, sub, rotateToward, yawOf } from './util';
import { selectAttack, selectMeleeAttack, approachEnvelope } from './attack';
import type {
	AttackCandidate, TimelineEvent, CompiledAction, CompiledBehavior, CompiledCondition, CompiledTransition,
	MachineFrame, RootTraceEntry, RunStatus,
} from './types';
import { DETECTION_RANK } from './perception';
import type { Actor, Cast, EnemyActor, NavPolicy, World } from './sim';

const MAX_TRANSITIONS_PER_TICK = 8;
/** UScpBehaviorMachine::RegisterAttackFailure — short and fixed; the ability is law. */
const ATTACK_FAILURE_COOLDOWN_SECONDS = 2.0;
/** FScpAction_MoveTo: goal distance must improve by this within StallEscalateSeconds. */
const STALL_PROGRESS_THRESHOLD_UNITS = 25;
const STALL_ESCALATE_SECONDS = 2.5;
/** 2D speed below which a pawn with a live path counts as pinned, not travelling. */
const STALL_PIN_SPEED_UNITS = 60;

export class BehaviorMachine {
	agent: EnemyActor;
	compiled: CompiledBehavior;
	world: World;

	rootFrame: MachineFrame;
	pendingEvents: Array<{ tag: string; payload: any }>;
	currentEvents: Array<{ tag: string; payload: any }>;
	rootFailUntil: Map<number, number>;
	nextRootEvalTime: number;
	rootEnterTime: number;
	currentRootPriority: number;
	currentRootHoldSeconds: number;
	navPolicy: NavPolicy;
	rootSelectionPaused: boolean;
	forcedRootName: string | null;

	attackFailureUntil: Map<string, number>;
	attackCooldownUntil: Map<string, number>;
	combatStartTime: number;

	context: Record<string, any>;

	// Inspector state.
	rootTrace: RootTraceEntry[];
	attackTrace: AttackCandidate[];
	log: Array<{ t: number; text: string }>;
	activeRootName: string | null;
	holdBlocking: { want: string; remaining: number } | null = null;
	commitBlocking = false;
	private _parentCache?: { compiled: CompiledBehavior; map: number[] };

	constructor(agent: EnemyActor, compiled: CompiledBehavior, world: World) {
		this.agent = agent;
		this.compiled = compiled;
		this.world = world;

		this.rootFrame = this.makeFrame(compiled, null, null, 'behavior');
		this.pendingEvents = [];
		this.currentEvents = [];
		this.rootFailUntil = new Map();
		this.nextRootEvalTime = 0;
		this.rootEnterTime = 0;
		this.currentRootPriority = Number.MAX_SAFE_INTEGER;
		this.currentRootHoldSeconds = 0;
		this.navPolicy = 'blocking';
		this.rootSelectionPaused = false;
		this.forcedRootName = null;

		this.attackFailureUntil = new Map();
		this.attackCooldownUntil = new Map();
		this.combatStartTime = -1;

		this.context = {
			'Perception.Target': null,
			'Perception.PointOfInterest': null,
			'Perception.TargetLocation': null,
			'Perception.PatrolAnchor': null,
			'Perception.Nuisance': null,
			'Attack.Tag': null,
			'Attack.Melee': null,
			'Attack.MinRange': 0,
			'Attack.MaxRange': 0,
			'Self.Actor': agent,
			'Self.Location': agent.pos,
			'World.DaySection': null,
			'World.NightFactor': 0,
			'Path.BlockingEntity': null,
			'Path.BlockingArmour': 0,
		};

		// Inspector state.
		this.rootTrace = [];
		this.attackTrace = [];
		this.log = [];
		this.activeRootName = null;
	}

	get now() {
		return this.world.time;
	}

	start() {
		this.rootFrame = this.makeFrame(this.compiled, null, null, 'behavior');
		this.nextRootEvalTime = 0;
	}

	makeFrame(
		compiled: CompiledBehavior,
		rootIndex: number | null,
		parent: MachineFrame | null,
		kind: 'behavior' | 'skill',
		inputs: Record<string, any> | null = null,
		skillId: string | null = null,
	): MachineFrame {
		return {
			compiled,
			kind,
			skillId,
			rootIndex,
			parent,
			inputs,
			vars: {},
			activePath: [],
			pathEnterTimes: [],
			actionStatus: [],
			completionHandled: [],
			memory: new Map(),
			pendingResult: 0,
			actionsLive: false,
			transitionBudget: MAX_TRANSITIONS_PER_TICK,
		};
	}

	postEvent(tag: string, payload: any = null): void {
		this.pendingEvents.push({ tag, payload });
	}

	note(text: string, kind: TimelineEvent['kind'] = 'state'): void {
		this.log.unshift({ t: this.now, text });
		if (this.log.length > 60) this.log.pop();
		// Same entries also land on the world-wide timeline, which is what the decision
		// strip draws — one shared clock across every agent so you can see them interact.
		this.world.timeline.push({ t: this.now, kind, text, agentId: this.agent.id });
		if (this.world.timeline.length > 4000) this.world.timeline.splice(0, 1000);
	}

	// -----------------------------------------------------------------------
	// Tick
	// -----------------------------------------------------------------------

	tick(delta: number): void {
		this.currentEvents = this.pendingEvents;
		this.pendingEvents = [];

		this.context['Self.Location'] = this.agent.pos;
		this.selectRoot();
		if (this.rootFrame) this.tickFrame(this.rootFrame, delta);
		this.currentEvents = [];
	}

	selectRoot(): void {
		const entries = this.compiled.rootEntries;
		if (!entries.length || this.rootSelectionPaused) return;
		const now = this.now;

		// Any queued event forces an immediate pass so reactions don't wait out the interval.
		if (now < this.nextRootEvalTime && this.currentEvents.length === 0) return;
		this.nextRootEvalTime = now + this.compiled.rootEvalInterval;

		// Attack selection shares the eval cadence — when-lists (has_attack) and SKL_Engage
		// read the freshly-published $Attack.* slots.
		this.refreshAttackSelection();

		const currentRoot = this.rootFrame.activePath.length ? this.rootFrame.activePath[0] : -1;

		let desired = null;
		this.rootTrace = [];
		for (const entry of entries) {
			const trace: RootTraceEntry = {
				name: entry.name,
				alias: entry.isAlias,
				conditions: [],
				pass: true,
				cooldown: false,
				entryIndex: entry.entryIndex,
				selected: false,
			};
			const failUntil = this.rootFailUntil.get(entry.stateIndex);
			if (failUntil !== undefined && now < failUntil) {
				trace.cooldown = true;
				trace.cooldownRemaining = failUntil - now;
				trace.pass = false;
			}
			for (const condition of entry.when) {
				const raw = this.evaluateCondition(condition, this.rootFrame);
				const pass = raw !== condition.negate;
				trace.conditions.push({ label: describeCondition(condition), pass, raw });
				if (!pass) trace.pass = false;
			}
			trace.entryIndex = entry.entryIndex;
			this.rootTrace.push(trace);
			if (trace.pass && !desired) {
				if (this.forcedRootName && entry.name !== this.forcedRootName) continue;
				desired = entry;
			}
		}
		if (this.forcedRootName) {
			desired = entries.find((e) => e.name === this.forcedRootName) || null;
		}
		// Match on the ENTRY, not the name: alias entries share a name, and only the entry
		// whose when-list actually won is the one that selected the root.
		for (const trace of this.rootTrace) {
			trace.selected = desired ? trace.entryIndex === desired.entryIndex : false;
		}

		const desiredRoot = desired ? desired.stateIndex : -1;
		if (desiredRoot === currentRoot) {
			if (desired) this.currentRootPriority = desired.priority;
			return;
		}

		// Hold window: LOWER-priority roots wait it out; higher-priority ones preempt.
		if (
			currentRoot !== -1 &&
			desired &&
			desired.priority > this.currentRootPriority &&
			now < this.rootEnterTime + this.currentRootHoldSeconds
		) {
			this.holdBlocking = {
				want: desired.name,
				remaining: this.rootEnterTime + this.currentRootHoldSeconds - now,
			};
			return;
		}
		this.holdBlocking = null;

		// Root switches respect leaf commitment like any other preemption.
		if (this.rootFrame.activePath.length && this.isLeafCommitted(this.rootFrame)) {
			this.commitBlocking = true;
			return;
		}
		this.commitBlocking = false;

		if (this.rootFrame.activePath.length) {
			this.exitToDepth(this.rootFrame, 0, 'Interrupted');
		}

		if (desired) {
			this.rootFrame.actionsLive = true;
			this.enterStateChain(this.rootFrame, desiredRoot);
			this.rootEnterTime = now;
			this.currentRootPriority = desired.priority;
			this.currentRootHoldSeconds = desired.holdSeconds;
			this.navPolicy = desired.navPolicy;
			this.activeRootName = desired.name;
			this.note(`root → ${desired.name}${desired.isAlias ? ' (alias entry)' : ''}`, 'root');
		} else {
			this.currentRootPriority = Number.MAX_SAFE_INTEGER;
			this.currentRootHoldSeconds = 0;
			this.activeRootName = null;
			this.note('root → (none)', 'root');
		}
	}

	tickFrame(frame: MachineFrame, delta: number): number {
		if (frame.pendingResult !== 0) return frame.pendingResult;
		frame.transitionBudget = MAX_TRANSITIONS_PER_TICK;
		if (!frame.activePath.length) return 0;

		this.processTransitions(frame);
		if (frame.pendingResult !== 0) return frame.pendingResult;

		if (!frame.actionsLive && frame.activePath.length) {
			for (let depth = 0; depth < frame.activePath.length; depth += 1) {
				this.enterActionsAtDepth(frame, depth);
			}
			frame.actionsLive = true;
		}

		this.tickActions(frame, delta);
		return frame.pendingResult;
	}

	processTransitions(frame: MachineFrame): boolean {
		let budget = MAX_TRANSITIONS_PER_TICK;

		// Pass 1 — queued events, in order.
		for (const event of this.currentEvents) {
			const committed = this.isLeafCommitted(frame);
			for (let depth = 0; depth < frame.activePath.length && budget > 0; depth += 1) {
				const state = frame.compiled.states[frame.activePath[depth]];
				let transitioned = false;
				for (const transition of state.transitions) {
					if (transition.trigger !== 'event' || transition.event !== event.tag) continue;
					// Events blocked by commitment are dropped, not re-queued.
					if (committed) continue;
					if (!this.conditionsPass(transition.conditions, frame)) continue;
					this.performTransition(frame, transition, `event ${event.tag}`);
					budget -= 1;
					transitioned = true;
					break;
				}
				if (transitioned || frame.pendingResult !== 0) break;
			}
			if (frame.pendingResult !== 0) return true;
		}

		// Pass 2 — OnTick, top-down, first match wins.
		const committed = this.isLeafCommitted(frame);
		for (let depth = 0; depth < frame.activePath.length && budget > 0; depth += 1) {
			const state = frame.compiled.states[frame.activePath[depth]];
			for (const transition of state.transitions) {
				if (transition.trigger !== 'tick') continue;
				if (committed) continue;
				if (!this.conditionsPass(transition.conditions, frame)) continue;
				this.performTransition(frame, transition, 'tick condition');
				return true;
			}
		}
		return false;
	}

	tickActions(frame: MachineFrame, delta: number): void {
		if (!frame.activePath.length || !frame.actionsLive) return;

		for (let depth = 0; depth < frame.activePath.length; depth += 1) {
			const state = frame.compiled.states[frame.activePath[depth]];
			const statuses = frame.actionStatus[depth];
			if (!statuses) return;

			let anyFailed = false;
			for (let slot = 0; slot < state.actions.length && slot < statuses.length; slot += 1) {
				if (statuses[slot] !== 'Running') {
					anyFailed ||= statuses[slot] === 'Failed';
					continue;
				}
				statuses[slot] = this.tickAction(frame, depth, slot, state.actions[slot], delta);
				anyFailed ||= statuses[slot] === 'Failed';
			}

			const isLeaf = depth === frame.activePath.length - 1;
			if (anyFailed) {
				this.handleActionFailure(frame, depth);
				return;
			}

			if (isLeaf && !frame.completionHandled[depth] && statuses.length > 0) {
				if (statuses.every((s) => s === 'Succeeded')) {
					frame.completionHandled[depth] = true;
					// Completing a committed state is not preemption — completion runs.
					for (const transition of state.transitions) {
						if (transition.trigger !== 'actions_succeeded') continue;
						if (!this.conditionsPass(transition.conditions, frame)) continue;
						this.performTransition(frame, transition, 'actions succeeded');
						return;
					}
				}
			}
		}
	}

	handleActionFailure(frame: MachineFrame, depth: number): void {
		// Failure escalation: bubble action_failed up the active path.
		for (let d = depth; d >= 0; d -= 1) {
			const state = frame.compiled.states[frame.activePath[d]];
			for (const transition of state.transitions) {
				if (transition.trigger !== 'action_failed') continue;
				if (!this.conditionsPass(transition.conditions, frame)) continue;
				this.performTransition(frame, transition, 'action failed');
				return;
			}
		}

		if (frame.kind === 'skill') {
			this.exitToDepth(frame, 0, 'Completed');
			frame.pendingResult = -1;
			return;
		}
		this.handleRootFailure(frame);
	}

	handleRootFailure(frame: MachineFrame): void {
		// Machines never dead-stop: the failed root sits out its fail_cooldown and the next
		// matching root (typically Search under a failing Chase) takes over immediately.
		const rootState = frame.activePath.length ? frame.activePath[0] : -1;
		this.exitToDepth(frame, 0, 'Interrupted');
		if (frame === this.rootFrame && rootState !== -1) {
			const entry = this.compiled.rootEntries.find((e) => e.stateIndex === rootState);
			const cooldown = entry ? entry.failCooldown : 6;
			this.rootFailUntil.set(rootState, this.now + cooldown);
			this.nextRootEvalTime = 0;
			this.note(`root FAILED: ${entry?.name || '?'} — ${cooldown}s cooldown`, 'fail');
		}
	}

	performTransition(frame: MachineFrame, transition: CompiledTransition, reason: string): void {
		if (transition.result) {
			this.exitToDepth(frame, 0, 'Completed');
			frame.pendingResult = transition.result === 'succeeded' ? 1 : -1;
			return;
		}
		// Budget exhausted: an authored cycle is resolving within one tick.
		frame.transitionBudget -= 1;
		if (frame.transitionBudget < 0) {
			if (frame.kind === 'skill') {
				this.exitToDepth(frame, 0, 'Completed');
				frame.pendingResult = -1;
			} else {
				this.handleRootFailure(frame);
			}
			return;
		}
		if (transition.toIndex < 0) return;
		this.enterStateChain(frame, transition.toIndex, reason);
	}

	enterStateChain(frame: MachineFrame, stateIndex: number, reason = ''): void {
		const states = frame.compiled.states;
		const chain = [];
		for (let index = stateIndex; index !== undefined && index >= 0; ) {
			chain.unshift(index);
			const parent = this.parentOf(frame.compiled, index);
			if (parent < 0) break;
			index = parent;
		}

		// Keep the shared prefix — but never the target itself: explicit re-entry restarts it
		// (SKL_Investigate's Approach→Approach on PoiChanged re-paths this way).
		let keepDepth = 0;
		while (
			keepDepth < frame.activePath.length &&
			keepDepth < chain.length - 1 &&
			frame.activePath[keepDepth] === chain[keepDepth]
		) {
			keepDepth += 1;
		}
		this.exitToDepth(frame, keepDepth, 'Interrupted');

		for (let i = keepDepth; i < chain.length; i += 1) {
			this.pushDepth(frame, chain[i]);
		}
		let descend = states[stateIndex].initialChild;
		while (descend >= 0) {
			this.pushDepth(frame, descend);
			descend = states[descend].initialChild;
		}

		if (reason && frame === this.rootFrame) {
			this.note(`${this.describePath(frame)} (${reason})`);
		}

		if (frame.actionsLive) {
			for (let depth = frame.activePath.length - 1; depth >= 0; depth -= 1) {
				if ((frame.actionStatus[depth] || []).some((s) => s === 'Failed')) {
					this.handleActionFailure(frame, depth);
					return;
				}
			}
		}
	}

	pushDepth(frame: MachineFrame, stateIndex: number): void {
		const depth = frame.activePath.length;
		frame.activePath.push(stateIndex);
		frame.pathEnterTimes.push(this.now);
		frame.actionStatus.push([]);
		frame.completionHandled.push(false);
		if (frame.actionsLive) this.enterActionsAtDepth(frame, depth);
	}

	parentOf(compiled: CompiledBehavior, stateIndex: number): number {
		if (this._parentCache?.compiled === compiled) return this._parentCache.map[stateIndex] ?? -1;
		const map = new Array(compiled.states.length).fill(-1);
		compiled.states.forEach((state, index) => {
			for (const child of state.children) map[child] = index;
		});
		this._parentCache = { compiled, map };
		return map[stateIndex] ?? -1;
	}

	exitToDepth(frame: MachineFrame, keepDepth: number, reason: string): void {
		for (let depth = frame.activePath.length - 1; depth >= keepDepth; depth -= 1) {
			this.exitActionsAtDepth(frame, depth, reason);
			frame.activePath.splice(depth, 1);
			frame.pathEnterTimes.splice(depth, 1);
			frame.actionStatus.splice(depth, 1);
			frame.completionHandled.splice(depth, 1);
		}
	}

	enterActionsAtDepth(frame: MachineFrame, depth: number): void {
		const state = frame.compiled.states[frame.activePath[depth]];
		const statuses = new Array(state.actions.length).fill('Running');
		frame.actionStatus[depth] = statuses;
		frame.completionHandled[depth] = false;
		for (let slot = 0; slot < state.actions.length; slot += 1) {
			frame.memory.set(`${depth}:${slot}`, {});
			statuses[slot] = this.enterAction(frame, depth, slot, state.actions[slot]);
		}
	}

	exitActionsAtDepth(frame: MachineFrame, depth: number, reason: string): void {
		const state = frame.compiled.states[frame.activePath[depth]];
		const statuses = frame.actionStatus[depth] || [];
		for (let slot = 0; slot < state.actions.length && slot < statuses.length; slot += 1) {
			// Completed actions exit as Completed regardless of why the state is leaving.
			const why = statuses[slot] === 'Running' ? reason : 'Completed';
			this.exitAction(frame, depth, slot, state.actions[slot], why);
		}
		frame.actionStatus[depth] = [];
	}

	isLeafCommitted(frame: MachineFrame): boolean {
		if (!frame.activePath.length) return false;
		const depth = frame.activePath.length - 1;
		const state = frame.compiled.states[frame.activePath[depth]];
		if (state.minCommitSeconds <= 0) return false;
		return this.now - frame.pathEnterTimes[depth] < state.minCommitSeconds;
	}

	describePath(frame: MachineFrame): string {
		return frame.activePath.map((i) => frame.compiled.states[i].name).join(' / ');
	}

	// -----------------------------------------------------------------------
	// Value sources
	// -----------------------------------------------------------------------

	/** Resolve a `$Ref` / literal exactly as FScpValueSource does — never snapshotted. */
	resolve(frame: MachineFrame, raw: any): any {
		if (typeof raw !== 'string' || !raw.startsWith('$')) return raw;
		const ref = raw.slice(1);
		if (ref.startsWith('Var.')) {
			// Vars are frame-local and never alias upward.
			return frame.vars?.[ref.slice(4)] ?? null;
		}
		if (ref.startsWith('In.')) {
			// Skill inputs ALIAS the caller's sources, resolved through the parent frame.
			const key = ref.slice(3);
			const source = frame.inputs?.[key];
			return source === undefined ? null : this.resolve(frame.parent || frame, source);
		}
		if (ref in this.context) return this.context[ref];
		return null;
	}

	resolveLocation(frame: MachineFrame, raw: any): any {
		const value = this.resolve(frame, raw);
		if (!value) return null;
		if (typeof value === 'object' && 'x' in value && 'y' in value) return value;
		if (value.pos) return value.pos;
		return null;
	}

	/** A float field that may be a literal or a `$Ref`. */
	resolveNumber(frame: MachineFrame, raw: any): number {
		const value = this.resolve(frame, raw);
		return typeof value === 'number' ? value : Number(value ?? 0);
	}

	// -----------------------------------------------------------------------
	// Attack selection
	// -----------------------------------------------------------------------

	refreshAttackSelection(): void {
		const perception = this.agent.perception;
		const target = this.agent.attackTargetOverride || perception.target;

		const result = target
			? selectAttack(this.agent, target, this.now, this)
			: { ability: null, candidates: [] };

		this.attackTrace = result.candidates;
		this.context['Attack.Tag'] = result.ability;
		// The winning attack's OWN minimum range. Was hardcoded to 0 on both sides, which threw
		// away the one number a standoff special needs — see ScpAi2::SelectAttack.
		this.context['Attack.MinRange'] =
			result.candidates.find((c) => c.tag === result.ability)?.sortMin ?? 0;
		// The approach envelope, not the ability range, is how close move_to drives.
		this.context['Attack.MaxRange'] = target ? approachEnvelope(this.agent, target) : 0;
		// $Attack.Melee: the plain melee attack regardless of what is castable right now —
		// a ClearPath asking "what do I smash this with" must still get an answer.
		this.context['Attack.Melee'] = selectMeleeAttack(this.agent);
	}

	// -----------------------------------------------------------------------
	// Conditions
	// -----------------------------------------------------------------------

	conditionsPass(conditions: CompiledCondition[], frame: MachineFrame): boolean {
		return conditions.every((c) => this.evaluateCondition(c, frame) !== c.negate);
	}

	evaluateCondition(condition: CompiledCondition, frame: MachineFrame): boolean {
		const p = condition.params;
		const perception = this.agent.perception;
		const now = this.now;

		switch (condition.kind) {
			case 'has_target':
				return Boolean(perception.target);
			case 'target_within': {
				if (!perception.target) return false;
				// The LAST-KNOWN location, not the live one: a target that broke line of sight
				// leaves its LKP frozen after the ghost-track window, so a `target_within`
				// Combat gate stops passing once the player is genuinely gone.
				return dist(this.agent.pos, perception.lastKnownTargetLocation) <= Number(p.distance);
			}
			case 'target_visible':
				return perception.targetVisible(now);
			case 'target_state': {
				const map: Record<string, string> = {
					glimpsed: 'Glimpsed',
					spotted: 'Spotted',
					remembered: 'Remembered',
				};
				const want = map[String(p.at_least ?? 'glimpsed')] || 'Glimpsed';
				return DETECTION_RANK[perception.getBestDetectionState()] >= DETECTION_RANK[want];
			}
			case 'time_since_seen': {
				const seen = perception.timeSinceSeen(now);
				if (p.under !== undefined) return seen < Number(p.under);
				if (p.over !== undefined) return seen > Number(p.over);
				return false;
			}
			case 'target_lost_within':
				return perception.targetLostTime >= 0 && now - perception.targetLostTime <= Number(p.seconds);
			case 'heard_noise_within':
				return perception.hasNoiseWithin(now, Number(p.seconds), Number(p.min_strength || 0));
			case 'has_nuisance':
				return Boolean(perception.getStrongestNuisance(Number(p.min_damage || 0)));
			case 'damaged_within':
				return perception.wasDamagedWithin(now, Number(p.seconds));
			case 'greeted_within':
				return perception.greetedTargetWithin(now, Number(p.seconds));
			case 'is_observed':
				return perception.isObservedNow();
			case 'provoked':
				return perception.isProvoked();
			case 'health_below':
				return this.agent.healthPct < Number(p.pct);
			case 'health_above':
				return this.agent.healthPct > Number(p.pct);
			case 'has_attack':
				return Boolean(this.context['Attack.Tag']);
			case 'has_attack_token':
				return this.world.coordinator.hasToken(this.agent);
			case 'can_break_furniture': {
				// Any DAMAGEABLE furniture is breakable by any enemy — armour tiers gate player
				// tools, not agents. The C++ tests the definition class, nothing else.
				const entity = this.resolve(frame, p.entity);
				return Boolean(entity && entity.isEntity && entity.breakable);
			}
			case 'distance': {
				const a = this.resolveLocation(frame, p.a);
				const b = this.resolveLocation(frame, p.b);
				if (!a || !b) return false;
				const d = dist(a, b);
				if (p.less_than !== undefined) return d < Number(this.resolveNumber(frame, p.less_than));
				if (p.greater_than !== undefined) return d > Number(this.resolveNumber(frame, p.greater_than));
				return false;
			}
			case 'has_los':
				// Conditions never trace: this is the perception component's cached bit.
				return perception.sensedNowFor(this.resolve(frame, p.target));
			case 'day_section':
				return this.context['World.DaySection'] === p.is;
			case 'is_valid': {
				const value = this.resolve(frame, p.ref);
				// A released pooled entity is gone even though the object still exists.
				return Boolean(value) && !value.removed && !(value.isEntity && value.dead);
			}
			case 'chance':
				// The agent's own stream, not the world's — see Actor.rng.
				return this.agent.rng() < Number(p.p ?? 0.5);
			case 'timer_elapsed':
				return now - (frame.pathEnterTimes.at(-1) ?? now) >= Number(p.seconds || 0);
			case 'var_compare': {
				const a = Number(this.resolveNumber(frame, p.a));
				const b = Number(this.resolveNumber(frame, p.b));
				switch (String(p.op || 'lt')) {
					case 'le': return a <= b;
					case 'gt': return a > b;
					case 'ge': return a >= b;
					case 'eq': return Math.abs(a - b) < 1e-4;
					default: return a < b;
				}
			}
			case 'tag_query':
				// No ASC in the sim, so the agent owns no tags: `none` is vacuously true and
				// `all`/`any` are vacuously false. Returning a flat false inverted `none`.
				return String(p.match || 'any') === 'none';
			default:
				return false;
		}
	}

	// -----------------------------------------------------------------------
	// Actions
	// -----------------------------------------------------------------------

	memoryOf(frame: MachineFrame, depth: number, slot: number): any {
		const key = `${depth}:${slot}`;
		if (!frame.memory.has(key)) frame.memory.set(key, {});
		return frame.memory.get(key);
	}

	enterAction(frame: MachineFrame, depth: number, slot: number, action: CompiledAction): RunStatus {
		const memory = this.memoryOf(frame, depth, slot);
		const p = action.params;
		const agent = this.agent;

		switch (action.kind) {
			case 'move_to':
				agent.applyMovementProfile(p.speed_profile);
				memory.destination = null;
				memory.repathFrom = null;
				return 'Running';
			case 'wander':
				agent.applyMovementProfile(p.speed_profile);
				memory.phase = 0;
				memory.failedPicks = 0;
				return 'Running';
			case 'stop_movement':
				agent.stopMovement();
				return 'Succeeded';
			case 'freeze_pose':
				agent.frozen = true;
				agent.stopMovement();
				return 'Running';
			case 'set_movement_profile':
				agent.applyMovementProfile(p.profile);
				return 'Succeeded';
			case 'wait': {
				const jitter = Number(p.jitter || 0);
				memory.until =
					this.now +
					this.resolveNumber(frame, p.seconds ?? 1) +
					(jitter > 0 ? agent.rng() * jitter : 0);
				return 'Running';
			}
			case 'face':
				memory.target = p.target;
				return 'Running';
			case 'look_around':
				memory.sweeps = Number(p.sweeps || 2);
				memory.done = 0;
				memory.baseYaw = agent.yaw;
				memory.phase = 0;
				memory.until = this.now + 0.6;
				agent.stopMovement();
				return 'Running';
			case 'make_noise':
				this.world.reportNoise(agent.pos, Number(p.loudness ?? 1), Number(p.range ?? 1500), this.now);
				return 'Succeeded';
			case 'mark_social': {
				const who = this.resolve(frame, p.target);
				if (who) agent.perception.markSocial(who, this.now);
				return 'Succeeded';
			}
			case 'post_event':
				this.postEvent(p.event, null);
				return 'Succeeded';
			case 'set_var': {
				const name = String(p.out || '').replace(/^\$Var\./, '');
				if (name) frame.vars[name] = this.resolve(frame, p.value);
				return 'Succeeded';
			}
			case 'find_spot': {
				// Ring generator + the separation claim. The scorers the C++ weighs (path cost,
				// LOS, noise, furniture clearance) are not modelled; what IS modelled is that a
				// spot lands on navigable ground away from the other claimants, which is the
				// part behaviour transitions depend on.
				const name = String(p.out || '').replace(/^\$Var\./, '');
				const around = this.resolveLocation(frame, p.query?.generator?.ring?.around);
				if (!name || !around) return 'Failed';
				const radius = Number(p.query?.generator?.ring?.radius ?? 500);
				const jitter = Number(p.query?.generator?.ring?.radius_jitter ?? 0);
				const separation = Number(p.query?.scorers?.separation ?? 0);
				const aroundActor = this.resolve(frame, p.query?.generator?.ring?.around);
				const claimed =
					separation > 0 && aroundActor?.pos
						? this.world.coordinator.claimedSpots(aroundActor, agent)
						: [];
				const spot = this.world.findRingSpot(agent, around, radius, jitter, claimed, this.navPolicy);
				if (!spot) return 'Failed';
				frame.vars[name] = spot;
				if (separation > 0 && aroundActor?.pos) {
					this.world.coordinator.claimSpot(agent, aroundActor, spot);
				}
				return 'Succeeded';
			}
			case 'claim_attack_token': {
				const target = this.resolve(frame, p.target);
				memory.deadline = this.now + Number(p.timeout ?? 4);
				memory.target = target;
				if (!target) return 'Failed';
				return this.world.coordinator.tryClaim(agent, target, agent.tokenCost, this.now) ? 'Succeeded' : 'Running';
			}
			case 'activate_ability': {
				const tag = this.resolve(frame, p.ability);
				const target = p.target ? this.resolve(frame, p.target) : agent.perception.target;
				return this.beginAbility(frame, memory, tag, target);
			}
			case 'run_skill': {
				const skill = frame.compiled.skills[p.skill];
				if (!skill) {
					this.note(`run_skill: unknown skill ${p.skill}`);
					return 'Failed';
				}
				const child = this.makeFrame(frame.compiled, skill.rootIndex, frame, 'skill', p.params || {}, p.skill);
				child.actionsLive = true;
				memory.frame = child;
				this.enterStateChain(child, skill.rootIndex);
				return 'Running';
			}
			default:
				return 'Succeeded';
		}
	}

	tickAction(frame: MachineFrame, depth: number, slot: number, action: CompiledAction, delta: number): RunStatus {
		const memory = this.memoryOf(frame, depth, slot);
		const p = action.params;
		const agent = this.agent;
		const now = this.now;

		switch (action.kind) {
			case 'move_to':
				return this.tickMoveTo(frame, memory, p);
			case 'wander':
				return this.tickWander(frame, memory, p);
			case 'wait':
				return now >= memory.until ? 'Succeeded' : 'Running';
			case 'freeze_pose':
				agent.frozen = true;
				return 'Running';
			case 'face': {
				const target = this.resolveLocation(frame, memory.target);
				if (!target) return 'Failed';
				const want = yawOf(sub(target, agent.pos));
				agent.yaw = rotateToward(agent.yaw, want, agent.rotationRate * delta);
				return Math.abs(((want - agent.yaw + 540) % 360) - 180) < 5 ? 'Succeeded' : 'Running';
			}
			case 'look_around': {
				const sweepYaw = memory.baseYaw + (memory.phase % 2 === 0 ? 75 : -75);
				agent.yaw = rotateToward(agent.yaw, sweepYaw, agent.rotationRate * delta);
				if (now >= memory.until) {
					memory.phase += 1;
					memory.until = now + 0.8;
					if (memory.phase >= memory.sweeps * 2) return 'Succeeded';
				}
				return 'Running';
			}
			case 'claim_attack_token': {
				const target = memory.target;
				if (!target) return 'Failed';
				if (this.world.coordinator.tryClaim(agent, target, agent.tokenCost, this.now)) return 'Succeeded';
				// A claim that times out FAILS — the queued agent drops out of the attack
				// branch into whatever the skill authored for action_failed.
				return now >= memory.deadline ? 'Failed' : 'Running';
			}
			case 'activate_ability':
				return this.tickAbility(memory);
			case 'run_skill': {
				const child = memory.frame;
				if (!child) return 'Failed';
				const result = this.tickFrame(child, delta);
				if (result === 1) return 'Succeeded';
				if (result === -1) return 'Failed';
				return 'Running';
			}
			default:
				return 'Succeeded';
		}
	}

	exitAction(frame: MachineFrame, depth: number, slot: number, action: CompiledAction, reason: string): void {
		const memory = this.memoryOf(frame, depth, slot);
		const agent = this.agent;
		switch (action.kind) {
			case 'move_to':
			case 'wander':
				if (reason !== 'Completed') agent.stopMovement();
				break;
			case 'freeze_pose':
				agent.frozen = false;
				break;
			case 'run_skill':
				if (memory.frame && reason !== 'Completed') {
					this.exitToDepth(memory.frame, 0, 'Interrupted');
				}
				memory.frame = null;
				// A skill frame tearing down releases the agent's attack token AND spot claim —
				// that is the ONLY thing that ever gives a token back.
				this.world.coordinator.release(agent);
				break;
			case 'activate_ability':
				if (memory.cast && reason === 'Interrupted' && !memory.cast.commit) {
					agent.cancelAbility();
				}
				break;
			default:
				break;
		}
	}

	// --- movement actions ---

	tickMoveTo(frame: MachineFrame, memory: any, p: any): RunStatus {
		const agent = this.agent;
		const destination = this.resolveLocation(frame, p.target);
		if (!destination) {
			memory.failReason = `${p.target} resolved to null`;
			return 'Failed';
		}
		memory.failReason = null;

		// acceptance_from_actor wins when it resolves: the same capsule-sum envelope
		// SelectAttack publishes, so a smash approach stops as close to a bin as to a
		// bookcase. Falls back to the authored number when the actor is gone.
		let acceptance;
		const envelopeActor = p.acceptance_from_actor ? this.resolve(frame, p.acceptance_from_actor) : null;
		if (envelopeActor && envelopeActor.pos) {
			acceptance = Math.max(approachEnvelope(agent, envelopeActor) * Number(p.acceptance_scale ?? 1), 5);
		} else {
			let raw = p.acceptance;
			if (typeof raw === 'string' && raw.startsWith('$')) raw = Number(this.resolve(frame, raw) || 0);
			acceptance = Math.max(Number(raw ?? 50) * Number(p.acceptance_scale ?? 1), 5);
		}
		memory.acceptance = acceptance;

		// Blocked-path grace: the event fired last tick. If no transition consumed it by now,
		// this context doesn't break furniture — fail into the authored escalation.
		if (memory.blockedGraceTicks > 0) {
			memory.blockedGraceTicks -= 1;
			if (memory.blockedGraceTicks === 0) {
				memory.failReason = 'blocked and nothing handled it';
				return 'Failed';
			}
			return 'Running';
		}

		const now = this.now;
		const repath = Number(p.repath_if_moved || 0);
		if (
			!memory.destination ||
			(repath > 0 && dist(destination, memory.destination) > repath) ||
			memory.pathDirty
		) {
			memory.destination = { ...destination };
			memory.path = this.world.findPath(agent.pos, destination, this.navPolicy, agent);
			memory.pathDirty = false;
			memory.pathIndex = 0;
			memory.bestGoalDistance = Infinity;
			memory.lastProgressTime = now;
			// The velocity clock is deliberately NOT reset by a repath: an enemy chasing a
			// MOVING player into a low sofa repaths every tick, and resetting here would stop
			// the pin from ever escalating.
			if (memory.lastMovingTime === undefined) memory.lastMovingTime = now;
		}

		if (!memory.path || !memory.path.points.length) {
			// IssueMove failed outright — no route at all. Escalate before giving up.
			if (this.reportBlockedPath(agent.pos, destination)) {
				memory.blockedGraceTicks = 2;
				return 'Running';
			}
			memory.failReason = 'no path to destination';
			agent.stopMovement();
			return 'Failed';
		}

		// Arrival against a PAWN is capsule contact, not the acceptance radius.
		//
		// This is the single correction that mattered most in the whole sim. Stopping the
		// agent the instant `dist <= acceptance` — ~112uu for SKL_Engage's envelope x 0.9 —
		// made this tool report that Gardener (melee reach 100), TVHead (100) and Janitor
		// (110) could never get inside their own weapon and were unable to land a hit at all.
		// TSIC.AI.V2's AiApproachParityTest Gauntlet node measured the real thing on
		// 2026-08-02: those three close to 70.4 / 182.9 / 77.7uu and deal 297 / 189 / 106
		// damage. Real path following drives AT the target and collision decides where it
		// ends up, so the stopping distance is the capsule sum, not the authored acceptance.
		// The acceptance still decides when the MOVE reports success (that is what advances
		// the skill), it just no longer decides where the pawn physically ends up.
		// Arrival is the authored acceptance, exactly as the C++ move node has it.
		//
		// A contact-based arrival was tried and reverted: it is a knife edge for a big capsule
		// (TVHead floors at ~183uu against a 42uu pawn, so an arrival test AT 183 never fires)
		// and it was only ever compensating for this port measuring ability range
		// centre-to-centre. With the range gate corrected to the surface-to-surface gap the
		// engine actually uses, stopping at acceptance leaves every shipped melee comfortably
		// inside its own reach — a Janitor at 112uu is a 28uu GAP against a 110uu weapon.
		//
		// The real pawn does end up closer than this (70-105uu, measured by
		// AiApproachParityTest) because path following carries momentum into the stop. That
		// costs some positional fidelity and changes no verdict, so it stays unmodelled rather
		// than approximated with a fudge factor.
		if (dist(agent.pos, destination) <= acceptance) {
			agent.stopMovement();
			return 'Succeeded';
		}

		// Physical-stall escalation. The path is live but the pawn isn't getting anywhere —
		// pinned against, or sliding along, furniture the breach path runs through. Two
		// independent signals: no progress TOWARD the goal, and near-zero real velocity.
		// Either held for STALL_ESCALATE_SECONDS posts PathBlocked so ClearPath can smash it.
		const goalDistance = dist(agent.pos, memory.destination);
		if (goalDistance < (memory.bestGoalDistance ?? Infinity) - STALL_PROGRESS_THRESHOLD_UNITS) {
			memory.bestGoalDistance = goalDistance;
			memory.lastProgressTime = now;
		}
		if (Math.hypot(agent.velocity.x, agent.velocity.y) >= STALL_PIN_SPEED_UNITS) {
			memory.lastMovingTime = now;
		}
		const goalStalled = now - (memory.lastProgressTime ?? now) >= STALL_ESCALATE_SECONDS;
		const velocityPinned = now - (memory.lastMovingTime ?? now) >= STALL_ESCALATE_SECONDS;
		if (goalStalled || velocityPinned) {
			memory.lastProgressTime = now;
			memory.lastMovingTime = now;
			if (this.reportBlockedPath(agent.pos, memory.destination)) {
				memory.blockedGraceTicks = 2;
				return 'Running';
			}
			// Pinned on something unbreakable: fail rather than push the wall forever.
			memory.failReason = 'pinned with no breakable blocker';
			return 'Failed';
		}

		agent.followPath(memory.path, memory.pathIndex, (index) => {
			memory.pathIndex = index;
		});
		return 'Running';
	}

	/**
	 * ReportBlockedPath — the nearest DAMAGEABLE furniture toward the goal, published to
	 * $Path.* and announced as AI.Event.PathBlocked. Non-damageable furniture is a full nav
	 * blocker and is deliberately NOT reported: with no actionable blocker the move fails
	 * instead of live-locking. Returns true when something was found and the event posted.
	 */
	reportBlockedPath(from: any, destination: any): boolean {
		const findAt = (point: any, sphereRadius: number) => {
			let nearest = null;
			let nearestDistance = Infinity;
			for (const entity of this.world.entities) {
				if (entity.dead || !entity.breakable) continue;
				// The overlap sphere is against the entity's footprint, not its origin.
				if (dist(point, entity.pos) > sphereRadius + entity.halfExtent) continue;
				const d = dist(entity.pos, from);
				if (d < nearestDistance) {
					nearestDistance = d;
					nearest = entity;
				}
			}
			return nearest;
		};

		const toGoal = sub(destination, from);
		const length = Math.hypot(toGoal.x, toGoal.y) || 1;
		const probe = {
			x: from.x + (toGoal.x / length) * 150,
			y: from.y + (toGoal.y / length) * 150,
		};
		let found = findAt(probe, 200);

		// Anti-cheese: a CLOSE unreachable destination (player perched on a shelf) — smash
		// the furniture at or under the destination itself.
		if (!found && dist(from, destination) <= 800) found = findAt(destination, 250);
		if (!found) return false;

		this.context['Path.BlockingEntity'] = found;
		this.context['Path.BlockingArmour'] = found.armour || 0;
		this.postEvent('AI.Event.PathBlocked');
		return true;
	}

	tickWander(frame: MachineFrame, memory: any, p: any): RunStatus {
		const agent = this.agent;
		const now = this.now;
		const ringMin = Number(p.ring_min ?? 800);
		const ringMax = Number(p.ring_max ?? 2500);
		const pauseSeconds = Number(p.pause_seconds ?? 2);
		const legSeconds = Number(p.leg_seconds ?? 0);
		// Ring anchor: the authored origin, but only while picks are landing — after two
		// consecutive failures it degrades to the agent's own position.
		const authoredOrigin = this.resolveLocation(frame, p.origin);
		const origin =
			(memory.failedPicks || 0) < 2 && authoredOrigin ? authoredOrigin : agent.pos;

		if (memory.phase === 0) {
			const spot = this.world.pickWanderSpot(origin, ringMin, ringMax, agent, this.navPolicy);
			if (!spot) {
				// Wander NEVER fails: no navmesh yet, or nowhere to go, and it idles briefly
				// and retries. After two consecutive misses the ring falls back to SELF so an
				// unreachable POI degrades to searching the immediate area.
				memory.failedPicks = Math.min((memory.failedPicks || 0) + 1, 200);
				memory.pauseUntil = now + pauseSeconds;
				memory.phase = 2;
				return 'Running';
			}
			memory.failedPicks = 0;
			memory.destination = spot;
			memory.path = this.world.findPath(agent.pos, spot, this.navPolicy, agent);
			memory.pathIndex = 0;
			// Legs and pauses are jittered exactly as the C++ does, so one far pick can't
			// monopolise the wander and two agents don't march in lockstep.
			memory.legDeadline = legSeconds > 0 ? now + legSeconds * (0.6 + agent.rng() * 0.8) : Infinity;
			memory.phase = 1;
			return 'Running';
		}

		if (memory.phase === 1) {
			const arrived = dist(agent.pos, memory.destination) <= 120;
			if (arrived || now >= memory.legDeadline || !memory.path?.points.length) {
				agent.stopMovement();
				memory.pauseUntil = now + pauseSeconds * (0.5 + agent.rng());
				memory.phase = 2;
				return 'Running';
			}
			agent.followPath(memory.path, memory.pathIndex, (index) => {
				memory.pathIndex = index;
			});
			return 'Running';
		}

		if (now >= memory.pauseUntil) memory.phase = 0;
		return 'Running';
	}

	// --- ability actions ---

	beginAbility(frame: MachineFrame, memory: any, tag: string | null, target: Actor | null): RunStatus {
		const agent = this.agent;
		if (!tag) return 'Failed';
		const ability = this.world.abilities[tag];
		if (!ability) return 'Failed';

		const check = agent.canActivate(tag, target, this.now, this);
		if (!check.ok) {
			// RegisterAttackFailure: a short, fixed exclusion window. The ability's own
			// cooldown effect is the real pacing knob — the ability is law.
			this.attackFailureUntil.set(tag, this.now + ATTACK_FAILURE_COOLDOWN_SECONDS);
			this.note(`ability ${tag} refused: ${check.reason}`, 'fail');
			return 'Failed';
		}

		const duration = ability.montageSeconds / (ability.playRate || 1);
		memory.cast = {
			tag,
			target,
			ability,
			endsAt: this.now + duration,
			commit: ability.commitToAttack,
			// The hitbox notify window sits roughly mid-montage; the real timing lives on the
			// AnimNotifyState, which this tool does not read.
			hitAt: this.now + duration * 0.45,
			hitDone: false,
		};
		agent.beginCast(memory.cast);
		if (ability.cooldownSeconds > 0) {
			this.attackCooldownUntil.set(tag, this.now + duration + ability.cooldownSeconds);
		}
		this.world.coordinator.notifyAttackStarted(agent, this.now);
		agent.perception.notifyEngaged(this.now);
		this.note(`ability ${ability.label}`, 'ability');
		return 'Running';
	}

	/**
	 * Observe the cast — the WORLD advances it (see World.advanceCasts).
	 *
	 * The ability owns its own lifetime, exactly as it does on the ASC. Ticking it from the
	 * action instead meant a committed attack that got interrupted at the state level (root
	 * switch, skill exit) never reached its end: `agent.casting` stayed set forever and every
	 * later attack was refused with "already casting".
	 */
	tickAbility(memory: any): RunStatus {
		const cast = memory.cast;
		if (!cast) return 'Failed';
		if (cast.finished) {
			memory.cast = null;
			return 'Succeeded';
		}
		return 'Running';
	}
}

export function describeCondition(condition: CompiledCondition): string {
	const p = condition.params;
	const extras = Object.entries(p)
		.filter(([k]) => !['if', 'negate', 'invert'].includes(k))
		.map(([k, v]) => `${k}=${v}`)
		.join(' ');
	return `${condition.negate ? '!' : ''}${condition.kind}${extras ? ` ${extras}` : ''}`;
}
