// Perception — a port of UScpPerceptionComponent (AI2 simplified perception).
//
// Every constant here comes from the resolved PRC_ profile, never from a literal in this
// file. Where the C++ hardcodes something (the 0.75s observed linger, the 2500/5000uu update
// buckets, the 1.5x steal ratio) the number is repeated with the reason it exists.

import { approachEnvelope } from './attack';
import { clamp01, dist, sub, dirOf, angleBetween, lerp } from './util';
import type { Vec2 } from './util';
import type { ResolvedProfile, SensedRecord, VisibilityBreakdown } from './types';
import type { Actor, EnemyActor, PlayerActor, World } from './sim';

export const DetectionState = {
	None: 'None',
	Glimpsed: 'Glimpsed',
	Spotted: 'Spotted',
	Remembered: 'Remembered',
};

/** Display ranking used by target_state and GetBestDetectionState — Spotted outranks Remembered. */
export const DETECTION_RANK: Record<string, number> = {
	[DetectionState.Spotted]: 3,
	[DetectionState.Remembered]: 2,
	[DetectionState.Glimpsed]: 1,
	[DetectionState.None]: 0,
};

/** Distance buckets for the update cadence — hardcoded in TickPerception. */
const NEAR_DISTANCE = 2500;
const MID_DISTANCE = 5000;
/** One missed observed trace must not flip the statue act (UpdateObserved). */
const OBSERVED_LINGER = 0.75;
const OBSERVED_PRUNE = 2.0;
/** PushContext posts PoiChanged past this move (PoiChangedThreshold). */
const POI_CHANGED_THRESHOLD = 150;
/** Player camera FOV the observed sense tests against when no camera manager exists. */
export const PLAYER_FOV_DEGREES = 90;
/** MaxRecordsPerSense — every sense list is a fixed-capacity ring with its own eviction rule. */
const MAX_RECORDS_PER_SENSE = 4;
/** TickPerception clamps the real elapsed time; a far-bucket agent must not fill sight in one step. */
const MAX_PERCEPTION_DELTA = 2;
/** DecayRecords prunes a damage record once its total accumulator falls below this. */
const DAMAGE_PRUNE_STRENGTH = 0.25;

function newRecord(actor: Actor, now: number): SensedRecord {
	return {
		actor,
		lastKnownLocation: { ...actor.pos },
		sensedNow: false,
		firstSensedTime: now,
		lastSensedTime: now,
		lastSeenTime: -1,
		strength: 0,
		recentDamage: 0,
		spotted: false,
		avoid: false,
		lastSocialTime: -1,
	};
}

const findRecord = (list: SensedRecord[], actor: Actor | null): SensedRecord | null =>
	list.find((r) => r.actor === actor) || null;

export class Perception {
	agent: EnemyActor;
	profile: ResolvedProfile;
	world: World;

	sightRecords: SensedRecord[];
	noiseRecords: SensedRecord[];
	damageRecords: SensedRecord[];
	observedRecords: SensedRecord[];

	target: Actor | null;
	targetLostTime: number;
	lastKnownTargetLocation: Vec2;
	pointOfInterest: Vec2;
	patrolAnchor: Vec2;
	searchAtPatrolAnchor: boolean;

	provoked: boolean;
	lastBloodshedTime: number;
	/** Closest this engagement has ever got, and when that last improved. See tryStalemateGiveUp. */
	bestTargetDistance: number;
	lastTargetProgressTime: number;
	giveUpUntil: Map<Actor, number>;

	nextUpdateTime: number;
	lastUpdateTime: number;
	activeInterval?: number;

	// Inspector-only bookkeeping.
	lastAcquireRule: string | null;
	lastEvent: { t: number; text: string } | null;
	nearestHostileDistance: number;
	acquireTrace?: Array<{ rule: string; considered: Array<{ pawn: string; score: number; note?: string }>; winner: string | null }>;
	poiSource?: string;

	constructor(agent: EnemyActor, profile: ResolvedProfile, world: World) {
		this.agent = agent;
		this.profile = profile;
		this.world = world;

		this.sightRecords = [];
		this.noiseRecords = [];
		this.damageRecords = [];
		this.observedRecords = [];

		this.target = null;
		this.targetLostTime = -1;
		this.lastKnownTargetLocation = { ...agent.pos };
		this.pointOfInterest = { ...agent.pos };
		this.patrolAnchor = { ...agent.pos };
		this.searchAtPatrolAnchor = false;

		this.provoked = false;
		this.lastBloodshedTime = -1;
		this.bestTargetDistance = -1;
		this.lastTargetProgressTime = -1;
		this.giveUpUntil = new Map();

		this.nextUpdateTime = 0;
		this.lastUpdateTime = 0;

		// Inspector-only bookkeeping: why the last acquisition happened.
		this.lastAcquireRule = null;
		this.lastEvent = null;
		this.nearestHostileDistance = Infinity;
	}

	setProfile(profile: ResolvedProfile): void {
		this.profile = profile;
	}

	// -----------------------------------------------------------------------
	// Tick
	// -----------------------------------------------------------------------

	tick(now: number): boolean {
		if (now < this.nextUpdateTime) return false;

		// Real elapsed time, clamped — distant agents update on the far bucket and must not
		// bank a whole interval of sight fill in one step (TickPerception clamps to 2s).
		const delta = this.lastUpdateTime > 0 ? Math.min(now - this.lastUpdateTime, MAX_PERCEPTION_DELTA) : 0;
		this.lastUpdateTime = now;

		let nearest = Infinity;
		nearest = this.updateSight(now, delta, nearest);
		if (this.profile.observed?.enabled) this.updateObserved(now);
		this.decayRecords(now, delta);
		this.updateTarget(now);
		this.pushContext(now);

		this.nearestHostileDistance = nearest;
		const iv = this.profile.update_interval;
		const interval = nearest < NEAR_DISTANCE ? iv.near : nearest < MID_DISTANCE ? iv.mid : iv.far;
		this.nextUpdateTime = now + Math.max(interval, 0.02);
		this.activeInterval = Math.max(interval, 0.02);
		return true;
	}

	// -----------------------------------------------------------------------
	// Sight
	// -----------------------------------------------------------------------

	updateSight(now: number, delta: number, nearest: number): number {
		const candidates = new Set();
		for (const pawn of this.world.hostilePawnsFor(this.agent)) {
			candidates.add(pawn);
			nearest = Math.min(nearest, dist(this.agent.pos, pawn.pos));
		}
		// Anything already tracked stays a candidate — hostile NPCs arrive via the damage sense.
		for (const record of this.sightRecords) candidates.add(record.actor);

		for (const pawn of candidates) this.updateSightRecord(pawn as Actor, now, delta);

		const memory = this.profile.sight.memory_seconds;
		this.sightRecords = this.sightRecords.filter((r) => {
			if (r.actor.dead || r.actor.removed) return false;
			const forget = !r.spotted ? r.strength <= 0 : now - r.lastSensedTime > memory;
			return !forget;
		});
		return nearest;
	}

	updateSightRecord(pawn: Actor, now: number, delta: number): void {
		if (pawn.dead || pawn.removed) return;

		let record = findRecord(this.sightRecords, pawn);
		const isHeldTarget = Boolean(record && record.spotted && this.target === pawn);
		const vis = this.evaluateSightVisibility(pawn, isHeldTarget, record);
		const sight = this.profile.sight;

		if (vis.fill > 0) {
			if (!record) {
				record = this.findOrAddSightRecord(pawn, now);
				if (!record) return;
			}
			const wasSensed = record.sensedNow;
			record.sensedNow = true;
			record.lastKnownLocation = { ...pawn.pos };
			record.lastSeenTime = now;
			record.lastSensedTime = now;
			record.lastVisibility = vis;

			if (!record.spotted) {
				// Touch (proximity) spots with no ramp; everything else fills over time_to_spot.
				record.strength = vis.instant
					? 1
					: clamp01(record.strength + (vis.fill * delta) / Math.max(sight.time_to_spot, 0.05));
				if (record.strength >= 1) {
					record.spotted = true;
					this.lastEvent = { t: now, text: `Spotted ${pawn.label}` };
				}
			}
			return;
		}

		if (!record) return;
		record.sensedNow = false;
		record.lastVisibility = vis;

		if (!record.spotted) {
			record.strength -= delta / Math.max(sight.time_to_forget_glimpse, 0.05);
			return;
		}

		// Ghost track: the LKP keeps following the truth for a window after losing sight,
		// then freezes. Damage re-stamps lastSeenTime, so an attacker hitting through a
		// barricade keeps its LKP glued to the target.
		if (record.lastSeenTime >= 0 && now - record.lastSeenTime < sight.ghost_track_seconds) {
			record.lastKnownLocation = { ...pawn.pos };
		}
	}

	/**
	 * FindOrAddSightRecord — the sight list is a fixed-capacity ring. Past capacity it evicts
	 * the STALEST record that is not the held target, and refuses outright when every slot is
	 * the target. A crowd is the case this exists for: without the cap the sim tracks eight
	 * pawns the game would have forgotten.
	 */
	findOrAddSightRecord(pawn: Actor, now: number): SensedRecord | null {
		const existing = findRecord(this.sightRecords, pawn);
		if (existing) return existing;

		if (this.sightRecords.length >= MAX_RECORDS_PER_SENSE) {
			let evictIndex = -1;
			let stalest = Infinity;
			for (let index = 0; index < this.sightRecords.length; index += 1) {
				if (this.sightRecords[index].actor === this.target) continue;
				if (this.sightRecords[index].lastSensedTime < stalest) {
					stalest = this.sightRecords[index].lastSensedTime;
					evictIndex = index;
				}
			}
			if (evictIndex < 0) return null;
			this.sightRecords[evictIndex] = newRecord(pawn, now);
			return this.sightRecords[evictIndex];
		}

		const record = newRecord(pawn, now);
		this.sightRecords.push(record);
		return record;
	}

	/**
	 * The whole sight model in one function, returning both the fill multiplier and a
	 * breakdown the inspector renders (this is the "why can't it see me" answer).
	 */
	evaluateSightVisibility(pawn: Actor, isHeldTarget: boolean, _existingRecord: SensedRecord | null): VisibilityBreakdown {
		const sight = this.profile.sight;
		const out: VisibilityBreakdown = {
			fill: 0,
			instant: false,
			reason: '',
			distance: 0,
			angle: 0,
			coneGain: 0,
			distanceFalloff: 0,
			motionMultiplier: 0,
			stealthMultiplier: 1,
			los: false,
			via: null,
		};

		const stealthed = Boolean(pawn.stealthed);
		const toTarget = sub(pawn.pos, this.agent.pos);
		const distance = Math.hypot(toTarget.x, toTarget.y);
		out.distance = distance;

		const rangeScale = stealthed ? sight.stealth.range_multiplier : 1;
		const primaryRange = sight.range * rangeScale;
		const peripheralRange = sight.peripheral_range * rangeScale;
		out.primaryRange = primaryRange;
		out.peripheralRange = peripheralRange;

		const forward = dirOf(this.agent.yaw);
		const angle = distance > 1e-3 ? angleBetween(forward, toTarget) : 0;
		out.angle = angle;

		const autoDetect = distance <= sight.auto_detect_radius;
		let coneGain = 0;
		let effectiveRange = primaryRange;

		if (autoDetect) {
			coneGain = 1;
			effectiveRange = Math.max(sight.auto_detect_radius, 1);
			out.via = 'proximity';
		} else if (isHeldTarget && distance <= primaryRange) {
			// Cones ACQUIRE, traces KEEP — an engaged enemy doesn't forget you for strafing
			// behind it mid-swing.
			coneGain = 1;
			out.via = 'held target (cone bypassed)';
		} else if (distance <= Math.max(primaryRange, peripheralRange)) {
			// Angular falloff lerps 1 at dead centre down to peripheral_gain at the outer
			// edge. The primary/peripheral split gates RANGE only, not the falloff.
			const peripheralHalf = Math.max(sight.peripheral_cone_angle * 0.5, 1);
			const angleFrac = clamp01(angle / peripheralHalf);
			const angularGain = lerp(1, sight.peripheral_gain, angleFrac);

			if (angle <= sight.cone_angle * 0.5 && distance <= primaryRange) {
				coneGain = angularGain;
				effectiveRange = primaryRange;
				out.via = 'primary cone';
			} else if (angle <= sight.peripheral_cone_angle * 0.5 && distance <= peripheralRange) {
				coneGain = angularGain;
				effectiveRange = peripheralRange;
				out.via = 'peripheral cone';
			}
		}

		out.coneGain = coneGain;
		out.effectiveRange = effectiveRange;

		if (coneGain <= 0) {
			out.reason =
				distance > Math.max(primaryRange, peripheralRange)
					? `out of range (${distance.toFixed(0)} > ${Math.max(primaryRange, peripheralRange).toFixed(0)})`
					: `outside cones (${angle.toFixed(0)}° > ${(sight.peripheral_cone_angle / 2).toFixed(0)}° half-peripheral)`;
			return out;
		}

		// The one budgeted trace of the sight model. Never through walls, proximity included.
		out.los = this.world.hasLineOfSight(this.agent.pos, pawn.pos);
		if (!out.los) {
			out.reason = 'line of sight blocked';
			return out;
		}

		if (autoDetect) {
			out.instant = true;
			out.fill = 1;
			out.reason = 'proximity — instant spot';
			return out;
		}

		out.distanceFalloff = 1 - clamp01(distance / Math.max(effectiveRange, 1));
		out.stealthMultiplier = stealthed ? sight.stealth.spot_multiplier : 1;
		const motion01 = pawn.motionFactor01 ?? 0.5;
		out.motion01 = motion01;
		out.motionMultiplier = lerp(sight.motion.still, sight.motion.sprint, motion01);

		out.fill = Math.max(
			out.distanceFalloff * out.coneGain * out.stealthMultiplier * out.motionMultiplier,
			1e-4,
		);
		out.reason = `filling at ${out.fill.toFixed(2)}x`;
		return out;
	}

	// -----------------------------------------------------------------------
	// Observed (the mannequin's "someone is looking at me")
	// -----------------------------------------------------------------------

	updateObserved(now: number): void {
		const observed = this.profile.observed;
		for (const player of this.world.players) {
			let record = findRecord(this.observedRecords, player);
			let observing = false;

			const toSelf = sub(this.agent.pos, player.pos);
			const distance = Math.hypot(toSelf.x, toSelf.y);
			if (distance <= observed.range) {
				const halfFov = PLAYER_FOV_DEGREES * 0.5 + observed.fov_margin;
				const angle = angleBetween(dirOf(player.yaw), toSelf);
				if (angle <= halfFov) {
					// A player staring through a wall is not an observer.
					observing = this.world.hasLineOfSight(player.pos, this.agent.pos);
				}
			}

			if (observing) {
				if (!record) {
					if (this.observedRecords.length >= MAX_RECORDS_PER_SENSE) continue;
					record = newRecord(player, now);
					this.observedRecords.push(record);
				}
				record.sensedNow = true;
				record.lastSensedTime = now;
				record.lastKnownLocation = { ...player.pos };
			} else if (record) {
				record.sensedNow = now - record.lastSensedTime < OBSERVED_LINGER;
			}
		}
		this.observedRecords = this.observedRecords.filter(
			(r) => r.sensedNow || now - r.lastSensedTime <= OBSERVED_PRUNE,
		);
	}

	isObservedNow(): boolean {
		return this.observedRecords.some((r) => r.sensedNow);
	}

	// -----------------------------------------------------------------------
	// Hearing / damage
	// -----------------------------------------------------------------------

	/** Routed from UScpSensesSubsystem::ReportNoise — attenuation happens there, not here. */
	notifyNoise(location: Vec2, loudness: number, range: number, now: number): void {
		const hearing = this.profile.hearing;
		const distance = dist(this.agent.pos, location);
		if (distance > range) return;
		let strength = loudness * (1 - distance / range) * hearing.acuity;
		if (strength <= 1e-4) return;
		if (!this.world.hasLineOfSight(this.agent.pos, location)) {
			strength *= hearing.occlusion_attenuation;
		}
		this.pushNoiseStimulus(location, strength, now);
	}

	/** NotifyNoise proper — the strength arriving here is already attenuated by the router. */
	pushNoiseStimulus(location: Vec2, strength: number, now: number): void {
		if (strength <= 1e-4) return;
		// Hearing never attributes identity — the record is an anonymous stimulus.
		const stimulus: SensedRecord = {
			...newRecord({ pos: { ...location } } as Actor, now),
			actor: null as unknown as Actor,
			lastKnownLocation: { ...location },
			strength,
			sensedNow: true,
			lastSeenTime: -1,
		};
		if (this.noiseRecords.length >= MAX_RECORDS_PER_SENSE) {
			// Fixed capacity: replace the weakest by LIVE (decayed) strength, not raw.
			const lifetime = this.profile.hearing.noise_lifetime;
			let weakestIndex = 0;
			let weakest = Infinity;
			for (let index = 0; index < this.noiseRecords.length; index += 1) {
				const live = this.decayedNoise(this.noiseRecords[index], now, lifetime);
				if (live < weakest) {
					weakest = live;
					weakestIndex = index;
				}
			}
			this.noiseRecords[weakestIndex] = stimulus;
		} else {
			this.noiseRecords.push(stimulus);
		}
		this.lastEvent = { t: now, text: `Heard noise @ ${strength.toFixed(2)}` };
	}

	notifyDamage(source: Actor | null, amount: number, now: number): void {
		if (amount <= 0) return;

		// Unattributed harm (environmental fire, traps): no identity to aggro, but SOMETHING
		// is here — investigate the immediate area. NotifyNoise takes an ALREADY-attenuated
		// strength (the router does the falloff), so this lands at a flat 1.0.
		if (!source || source.removed) {
			this.pushNoiseStimulus(this.agent.pos, 1, now);
			return;
		}

		// One damage list holds pawns AND entities; entity entries are the nuisances. Capacity
		// is counted PER KIND (pawn/entity) so a wall of furniture can't evict the attacker.
		let record = findRecord(this.damageRecords, source);
		if (!record) {
			const sourceIsPawn = Boolean(source.isPawn);
			let kindCount = 0;
			let weakestIndex = -1;
			let weakest = Infinity;
			for (let index = 0; index < this.damageRecords.length; index += 1) {
				const candidate = this.damageRecords[index];
				if (Boolean(candidate.actor?.isPawn) !== sourceIsPawn) continue;
				kindCount += 1;
				if (candidate.strength < weakest) {
					weakest = candidate.strength;
					weakestIndex = index;
				}
			}
			record = newRecord(source, now);
			record.strength = 0;
			record.recentDamage = 0;
			if (kindCount >= MAX_RECORDS_PER_SENSE && weakestIndex >= 0) {
				this.damageRecords[weakestIndex] = record;
			} else {
				this.damageRecords.push(record);
			}
		}
		record.strength += amount;
		record.recentDamage += amount;
		record.lastSensedTime = now;
		record.sensedNow = true;
		record.lastKnownLocation = { ...source.pos };
		// `avoid` is ONLY ever set by MarkNuisanceAvoid, which nothing in the game calls —
		// deriving it from breakability here made the sim avoid nuisances the game never does.

		// Blood drawn: this engagement is a fight, so the stalemate clock restarts.
		this.lastBloodshedTime = now;
		this.lastEvent = { t: now, text: `Took ${amount.toFixed(0)} from ${source.label}` };

		// Being hit cancels any give-up window on the attacker — walking away was conditional
		// on them leaving us alone, and they did not.
		this.giveUpUntil.delete(source);

		// A fresh hit from the held target opens the provocation latch — being hurt ends a
		// statue act just like landing an attack does.
		if (this.target === source) this.provoked = true;

		if (!source.isPawn) return;

		// Pawn instigator: instant Spotted with a positional fix — pain tells the agent where
		// the attacker IS, walls or not.
		const sight = this.findOrAddSightRecord(source, now);
		if (!sight) return;
		sight.spotted = true;
		sight.strength = 1;
		sight.lastSensedTime = now;
		sight.lastSeenTime = now;
		sight.lastKnownLocation = { ...source.pos };

		// Being hurt aggros IMMEDIATELY — no waiting out the distance-bucketed cadence.
		this.updateTarget(now);
		if (this.target === source) this.provoked = true;
		this.pushContext(now);
	}

	/**
	 * Landing hits — on the player, or on the cabinet between us — is progress, so the
	 * stalemate clock restarts. Deliberately NOT provocation and deliberately not gated on
	 * holding a target: the hit that lands a frame before acquisition still counts.
	 */
	notifyDamageDealt(now: number): void {
		this.lastBloodshedTime = now;
	}

	/**
	 * The machine activating an attack. Swinging at anything opens the provocation latch, and
	 * only target loss closes it — and it does NOTHING else. Refreshing the sight record here
	 * as well meant flailing at thin air (or at furniture the agent cannot hurt) kept a
	 * Spotted record alive forever and no chase ever timed out.
	 */
	notifyEngaged(_now: number): void {
		if (!this.target) return;
		this.provoked = true;
	}

	decayRecords(now: number, delta: number): void {
		const damage = this.profile.damage;
		const totalDecay = Math.pow(0.5, delta / Math.max(damage.total_halflife, 0.05));
		const recentDecay = Math.pow(0.5, delta / Math.max(damage.recent_window, 0.05));
		for (const record of this.damageRecords) {
			record.strength *= totalDecay;
			record.recentDamage *= recentDecay;
		}
		this.damageRecords = this.damageRecords.filter(
			(r) => r.strength >= DAMAGE_PRUNE_STRENGTH && !r.actor.removed,
		);
		// bSensedNow on a damage record means "hurt us inside the recent window".
		for (const record of this.damageRecords) {
			record.sensedNow = now - record.lastSensedTime < damage.recent_window;
		}

		const lifetime = this.profile.hearing.noise_lifetime;
		for (const record of this.noiseRecords) {
			record.liveStrength = this.decayedNoise(record, now, lifetime);
		}
		this.noiseRecords = this.noiseRecords.filter((r) => (r.liveStrength ?? 0) > 0.01);
	}

	decayedNoise(record: SensedRecord, now: number, lifetime: number): number {
		const age = now - record.firstSensedTime;
		return record.strength * Math.max(0, 1 - age / Math.max(lifetime, 0.05));
	}

	// -----------------------------------------------------------------------
	// Targeting
	// -----------------------------------------------------------------------

	updateTarget(now: number): void {
		let held = this.target;
		let targetRecord = held ? findRecord(this.sightRecords, held) : null;
		if (targetRecord) this.lastKnownTargetLocation = { ...targetRecord.lastKnownLocation };

		// 1. DROP — dead, despawned, or the record was forgotten.
		if (held && (held.dead || held.removed || !targetRecord)) {
			this.dropTarget(now);
			held = null;
			targetRecord = null;
		}

		// 1b. GIVE UP — holding a target, nobody bleeding, nobody closing. Runs BEFORE the
		// steal check so a dead-end chase ends rather than being handed to a challenger.
		if (held) this.updateEngagementProgress(now);
		if (held && this.tryStalemateGiveUp(now)) {
			held = null;
			targetRecord = null;
		}

		// 2. STEAL — only ever through damage. No score re-evaluation exists while a target is
		// held, so target juggling is impossible by construction.
		if (held) {
			const incumbent = findRecord(this.damageRecords, held);
			const incumbentRecent = incumbent ? incumbent.recentDamage : 0;
			const threshold = Math.max(this.profile.targeting.switch_damage, incumbentRecent * 1.5);
			let challenger = null;
			let challengerRecent = threshold;
			for (const record of this.sightRecords) {
				if (record.actor === held || !record.spotted) continue;
				const dmg = findRecord(this.damageRecords, record.actor);
				if (dmg && dmg.recentDamage > challengerRecent) {
					challengerRecent = dmg.recentDamage;
					challenger = record.actor;
				}
			}
			if (challenger) this.acquireTarget(challenger, now, true, 'damage steal');
			return;
		}

		// 3. ACQUIRE — first priority rule that yields a Spotted candidate wins.
		for (const [pawn, until] of [...this.giveUpUntil]) {
			if (pawn.removed || now >= until) this.giveUpUntil.delete(pawn);
		}

		this.acquireTrace = [];
		for (const rule of this.profile.compiledPriority) {
			let best = null;
			let bestScore = 0;
			const considered = [];
			for (const record of this.sightRecords) {
				const pawn = record.actor;
				if (!record.spotted || pawn.dead || pawn.removed) continue;
				if (this.giveUpUntil.has(pawn)) {
					considered.push({ pawn: pawn.label, score: 0, note: 'gave up on this one' });
					continue;
				}
				let score = 0;
				if (rule === 'strongest_attacker') {
					const dmg = findRecord(this.damageRecords, pawn);
					score = dmg ? dmg.strength : 0;
				} else if (rule === 'closest_spotted') {
					score = 1 / Math.max(dist(this.agent.pos, pawn.pos), 1);
				} else if (rule === 'closest_visible') {
					score = record.sensedNow ? 1 / Math.max(dist(this.agent.pos, pawn.pos), 1) : 0;
				} else if (rule === 'first_spotted') {
					score = 1 / Math.max(record.firstSensedTime, 1);
				}
				considered.push({ pawn: pawn.label, score });
				if (score > bestScore) {
					bestScore = score;
					best = pawn;
				}
			}
			this.acquireTrace.push({ rule, considered, winner: best?.label || null });
			if (best) {
				this.acquireTarget(best, now, false, rule);
				return;
			}
		}
	}

	acquireTarget(pawn: Actor, now: number, switched: boolean, rule: string): void {
		this.target = pawn;
		this.targetLostTime = -1;
		this.searchAtPatrolAnchor = false;
		this.lastAcquireRule = rule;
		// The stalemate clock runs from acquisition, but a target SWITCH keeps the existing
		// clock — the pack has been in this fight since the first of them engaged. DropTarget
		// is what clears it, so a genuinely fresh engagement still starts from now.
		if (this.lastBloodshedTime < 0) this.lastBloodshedTime = now;
		if (this.lastTargetProgressTime < 0) {
			this.lastTargetProgressTime = now;
			this.bestTargetDistance = -1;
		}
		const record = findRecord(this.sightRecords, pawn);
		if (record) this.lastKnownTargetLocation = { ...record.lastKnownLocation };
		this.lastEvent = { t: now, text: `Target ${switched ? 'stolen' : 'acquired'}: ${pawn.label} (${rule})` };

		// Fresh acquisition alerts every agent within the radius to the same target.
		const radius = this.profile.targeting.alert_allies_radius;
		if (!switched && radius > 0) this.world.alertAllies(this.agent, pawn, radius, now);
	}

	dropTarget(now: number): void {
		if (this.target) this.lastEvent = { t: now, text: `Lost target ${this.target.label}` };
		this.target = null;
		this.targetLostTime = now;
		this.provoked = false;
		// Losing the target ends the fight; the next acquisition starts fresh clocks.
		this.lastBloodshedTime = -1;
		this.lastTargetProgressTime = -1;
		this.bestTargetDistance = -1;
		this.reanchorPatrolIfNeeded();
	}

	/**
	 * Restart the give-up progress clock whenever the agent meaningfully closes on where it
	 * believes the target to be. Distance is to the LAST-KNOWN location, not the true one: a
	 * target that vanished behind a wall must not read as "getting away" just because it kept
	 * running, and closing on a stale belief is still the agent doing its job.
	 */
	updateEngagementProgress(now: number): void {
		// Matches FScpAction_MoveTo's stall threshold — the same question, one layer up.
		const progressThresholdUnits = 25;
		const distance = dist(this.agent.pos, this.lastKnownTargetLocation);
		if (
			this.lastTargetProgressTime < 0 ||
			this.bestTargetDistance < 0 ||
			distance < this.bestTargetDistance - progressThresholdUnits
		) {
			this.bestTargetDistance = distance;
			this.lastTargetProgressTime = now;
			return;
		}

		// Standing at arm's length from a target it can see is not a stalemate — it is an
		// agent that has ARRIVED and is waiting its turn. Only maxSimultaneousAttackers hold a
		// token at once, so the third enemy in a pack draws no blood and gains no ground
		// through no fault of its own.
		if (
			this.getTargetState() === DetectionState.Spotted &&
			distance <= approachEnvelope(this.agent, this.target) * 2
		) {
			this.lastTargetProgressTime = now;
		}
	}

	tryStalemateGiveUp(now: number): boolean {
		const s = this.profile.stalemate;
		if (s.give_up_seconds <= 0 || this.lastBloodshedTime < 0) return false;
		if (now - this.lastBloodshedTime < s.give_up_seconds) return false;
		// A stalemate is a fight going nowhere, and "nowhere" means both nobody bleeding AND
		// nobody closing. Bloodshed alone made every approach longer than give_up_seconds
		// indistinguishable from a dead end.
		if (now - this.lastTargetProgressTime < s.give_up_seconds) return false;

		const abandoned = this.target;
		if (s.resume_seconds > 0 && abandoned) {
			this.giveUpUntil.set(abandoned, now + s.resume_seconds);
		}
		// Forget the sighting outright — leaving a Spotted record would let the very next
		// UpdateTarget re-acquire the moment the give-up window lapses.
		if (abandoned) this.sightRecords = this.sightRecords.filter((r) => r.actor !== abandoned);
		this.dropTarget(now);
		this.searchAtPatrolAnchor = s.search_near_spawn;
		this.lastEvent = { t: now, text: `Gave up (stalemate ${s.give_up_seconds}s)` };
		return true;
	}

	reanchorPatrolIfNeeded(): void {
		const here = this.agent.pos;
		const returnDistance = this.profile.targeting.patrol_return_distance;
		const usable =
			dist(here, this.patrolAnchor) <= returnDistance &&
			this.world.isPathable(here, this.patrolAnchor, 'blocking');
		if (!usable) this.patrolAnchor = { ...here };
	}

	// -----------------------------------------------------------------------
	// Context push
	// -----------------------------------------------------------------------

	pushContext(now: number): void {
		// POI follows the stimulus ladder: freshest glimpse > noise > give-up anchor > LKP.
		let poi = this.pointOfInterest;
		let source = 'held';
		let freshestGlimpse = null;
		for (const record of this.sightRecords) {
			if (!record.spotted && record.strength > 0) {
				if (!freshestGlimpse || record.lastSensedTime > freshestGlimpse.lastSensedTime) {
					freshestGlimpse = record;
				}
			}
		}
		const strongestNoise = this.getStrongestNoise();
		if (freshestGlimpse) {
			poi = freshestGlimpse.lastKnownLocation;
			source = 'glimpse';
		} else if (strongestNoise) {
			poi = strongestNoise.lastKnownLocation;
			source = 'noise';
		} else if (this.searchAtPatrolAnchor) {
			poi = this.patrolAnchor;
			source = 'patrol anchor (gave up)';
		} else if (this.targetLostTime >= 0 || this.target) {
			poi = this.lastKnownTargetLocation;
			source = 'last known target location';
		}

		if (dist(poi, this.pointOfInterest) > POI_CHANGED_THRESHOLD) {
			this.agent.machine?.postEvent('AI.Event.PoiChanged');
		}
		this.pointOfInterest = { ...poi };
		this.poiSource = source;

		// Publish the slots the behaviour reads. Everything downstream ($Perception.Target,
		// $Perception.TargetLocation, ...) resolves through here — the machine never reaches
		// into the perception component itself.
		const context = this.agent.machine?.context;
		if (!context) return;
		context['Perception.Target'] = this.target;
		context['Perception.TargetLocation'] = { ...this.lastKnownTargetLocation };
		context['Perception.PointOfInterest'] = { ...this.pointOfInterest };
		context['Perception.PatrolAnchor'] = { ...this.patrolAnchor };
		context['Perception.Nuisance'] = this.getStrongestNuisance();
	}

	// -----------------------------------------------------------------------
	// Reads used by conditions
	// -----------------------------------------------------------------------

	recordState(record: SensedRecord): string {
		if (record.spotted) return record.sensedNow ? DetectionState.Spotted : DetectionState.Remembered;
		return record.strength > 0 ? DetectionState.Glimpsed : DetectionState.None;
	}

	getDetectionState(pawn: Actor | null): string {
		const record = pawn ? findRecord(this.sightRecords, pawn) : null;
		return record ? this.recordState(record) : DetectionState.None;
	}

	getTargetState(): string {
		return this.getDetectionState(this.target);
	}

	/**
	 * Best state across EVERY sight record — what `target_state` actually reads (it is not
	 * scoped to the held target). Display ranking: Spotted > Remembered > Glimpsed > None.
	 */
	getBestDetectionState(): string {
		let best = DetectionState.None;
		for (const record of this.sightRecords) {
			const state = this.recordState(record);
			if (DETECTION_RANK[state] > DETECTION_RANK[best]) best = state;
		}
		return best;
	}

	getDetectionProgress(pawn: Actor | null): number {
		const record = pawn ? findRecord(this.sightRecords, pawn) : null;
		if (!record) return 0;
		return record.spotted ? 1 : clamp01(record.strength);
	}

	timeSinceSeen(now: number): number {
		const record = this.target ? findRecord(this.sightRecords, this.target) : null;
		if (!record || record.lastSeenTime < 0) return Infinity;
		return now - record.lastSeenTime;
	}

	/**
	 * `target_visible` — the C++ demands BOTH a Spotted state and a raw sighting inside the
	 * last half second. A Glimpsed record that happens to be sensed this update is not
	 * "visible" to the behaviour layer.
	 */
	targetVisible(now: number): boolean {
		return this.getTargetState() === DetectionState.Spotted && this.timeSinceSeen(now) < 0.5;
	}

	/** Raw "is the sight record live", which is what has_los reads. */
	targetSensedNow(): boolean {
		const record = this.target ? findRecord(this.sightRecords, this.target) : null;
		return Boolean(record && record.sensedNow);
	}

	/** has_los reads the CACHED visibility bit for a pawn — conditions never trace. */
	sensedNowFor(pawn: Actor | null): boolean {
		const record = pawn ? findRecord(this.sightRecords, pawn) : null;
		return Boolean(record && record.sensedNow);
	}

	hasNoiseWithin(now: number, seconds: number, minStrength = 0): boolean {
		const lifetime = this.profile.hearing.noise_lifetime;
		return this.noiseRecords.some(
			(r) => now - r.firstSensedTime <= seconds && this.decayedNoise(r, now, lifetime) >= minStrength,
		);
	}

	getStrongestNoise(): SensedRecord | null {
		let best = null;
		for (const record of this.noiseRecords) {
			const live = record.liveStrength ?? record.strength;
			if (!best || live > (best.liveStrength ?? best.strength)) best = record;
		}
		return best;
	}

	getStrongestNuisance(minDamage = 0): Actor | null {
		let best = null;
		let bestStrength = minDamage;
		for (const record of this.damageRecords) {
			if (!record.actor.isEntity || record.avoid) continue;
			if (record.strength > bestStrength) {
				bestStrength = record.strength;
				best = record.actor;
			}
		}
		return best;
	}

	wasDamagedWithin(now: number, seconds: number): boolean {
		return this.damageRecords.some((r) => now - r.lastSensedTime <= seconds);
	}

	greetedTargetWithin(now: number, seconds: number): boolean {
		const record = this.target ? findRecord(this.sightRecords, this.target) : null;
		return Boolean(record && record.lastSocialTime >= 0 && now - record.lastSocialTime <= seconds);
	}

	markSocial(pawn: Actor, now: number): void {
		const record = findRecord(this.sightRecords, pawn);
		if (record) record.lastSocialTime = now;
	}

	isProvoked(): boolean {
		return this.provoked;
	}

	secondsSinceBloodshed(now: number): number {
		if (!this.target || this.lastBloodshedTime < 0) return -1;
		return now - this.lastBloodshedTime;
	}
}
