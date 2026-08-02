// Attack selection — a port of ScpAi2::SelectAttack / SelectMeleeAttack.
//
// The rule the C++ enforces and this reproduces: THE ABILITY IS THE ATTACK. A loadout entry
// whose ability was never granted is never a candidate, and CanActivateAbility (range, LoS,
// warm-up, cooldown, tags) is what decides eligibility — not the loadout weight.

import { dist } from './util';
import type { AttackCandidate } from './types';
import type { EnemyActor, Actor } from './sim';
import type { BehaviorMachine } from './machine';

/** ScpAi2::GetApproachEnvelope — agent radius + target radius + a 40uu gap. */
const APPROACH_GAP_UNITS = 40;

export function approachEnvelope(agent: Actor | null, target: Actor | null): number {
	return capsuleRadiusOf(agent) + capsuleRadiusOf(target) + APPROACH_GAP_UNITS;
}

function capsuleRadiusOf(actor: Actor | null): number {
	const radius = actor?.radius ?? 0;
	return radius > 0 ? radius : 35;
}

/**
 * Returns { ability, candidates } where candidates carries a pass/fail verdict per loadout
 * entry — that verdict list is the whole point of the tool, so it's built even for entries
 * that are rejected immediately.
 */
export function selectAttack(
	agent: EnemyActor,
	target: Actor,
	now: number,
	machine: BehaviorMachine,
): { ability: string | null; candidates: AttackCandidate[] } {
	const candidates: AttackCandidate[] = [];
	const world = agent.world;

	for (const entry of agent.attacks) {
		const ability = world.abilities[entry.ability];
		const row: AttackCandidate = {
			tag: entry.ability,
			label: ability?.label || entry.ability,
			weight: entry.weight,
			minRange: ability?.minRange ?? null,
			maxRange: ability?.maxRange ?? null,
			cooldown: ability?.cooldownSeconds ?? 0,
			eligible: false,
			reason: '',
			dead: Boolean(ability?.deadNote),
			deadNote: ability?.deadNote || null,
		};

		if (!ability) {
			row.reason = 'no ability data';
			candidates.push(row);
			continue;
		}

		// Loadout-side gates that no ability owns.
		const healthPct = agent.healthPct;
		if (entry.minHealthPct !== undefined && healthPct < entry.minHealthPct) {
			row.reason = `health ${(healthPct * 100).toFixed(0)}% < min`;
			candidates.push(row);
			continue;
		}
		if (entry.maxHealthPct !== undefined && healthPct > entry.maxHealthPct) {
			row.reason = `health ${(healthPct * 100).toFixed(0)}% > max`;
			candidates.push(row);
			continue;
		}

		// "No granted ability to consult — dead content: never a candidate."
		if (!agent.grantedAbilities.has(entry.ability)) {
			row.reason = 'ability NOT GRANTED — dead loadout entry';
			row.notGranted = true;
			candidates.push(row);
			continue;
		}

		const check = agent.canActivate(entry.ability, target, now, machine);
		if (!check.ok) {
			row.reason = check.reason;
			candidates.push(row);
			continue;
		}

		const failUntil = machine.attackFailureUntil.get(entry.ability);
		if (failUntil !== undefined && now < failUntil) {
			row.reason = `failure back-off ${(failUntil - now).toFixed(1)}s`;
			candidates.push(row);
			continue;
		}

		row.eligible = true;
		row.reason = 'castable';
		// GetMinRange()==0 means "no minimum" — point-blank filler sorts last.
		// GetMaxRange()==0 means "no maximum" — unlimited reach outranks any cap.
		row.sortMin = ability.minRange || 0;
		row.sortMax = (ability.maxRange ?? 0) > 0 ? (ability.maxRange as number) : Number.MAX_VALUE;
		row.sortCooldown = ability.cooldownSeconds || 0;
		candidates.push(row);
	}

	const eligible = candidates.filter((c) => c.eligible);
	// Priority: highest MINIMUM range first (standoff specials fire before the point-blank
	// melee filler); ties fall through to longest max range, then longest cooldown, then weight.
	eligible.sort((a, b) => {
		if (a.sortMin !== b.sortMin) return (b.sortMin ?? 0) - (a.sortMin ?? 0);
		if (a.sortMax !== b.sortMax) return (b.sortMax ?? 0) - (a.sortMax ?? 0);
		if (a.sortCooldown !== b.sortCooldown) return (b.sortCooldown ?? 0) - (a.sortCooldown ?? 0);
		return b.weight - a.weight;
	});
	eligible.forEach((row, index) => {
		row.rank = index + 1;
	});

	return { ability: eligible.length ? eligible[0].tag : null, candidates };
}

/**
 * $Attack.Melee — the shortest-reach granted attack, castable or not. GetMaxRange()==0 means
 * unlimited reach, i.e. the opposite of a point-blank filler, so it sorts LAST.
 */
export function selectMeleeAttack(agent: EnemyActor): string | null {
	let best: string | null = null;
	let bestRange = Number.MAX_VALUE;
	for (const entry of agent.attacks) {
		if (!agent.grantedAbilities.has(entry.ability)) continue;
		const ability = agent.world.abilities[entry.ability];
		const reach = ability && (ability.maxRange ?? 0) > 0 ? (ability.maxRange as number) : Number.MAX_VALUE;
		if (!best || reach < bestRange) {
			best = entry.ability;
			bestRange = reach;
		}
	}
	return best;
}

/**
 * CanActivateAbility, reduced to the gates the AI path actually consults.
 * Returns { ok, reason } so the inspector can print WHY an attack didn't fire.
 */
export function canActivate(
	agent: EnemyActor,
	tag: string,
	target: Actor | null,
	now: number,
	machine: BehaviorMachine,
): { ok: boolean; reason: string } {
	const ability = agent.world.abilities[tag];
	if (!ability) return { ok: false, reason: 'no ability' };
	if (!target) return { ok: false, reason: 'no target' };

	const cooldownUntil = machine.attackCooldownUntil.get(tag);
	if (cooldownUntil !== undefined && now < cooldownUntil) {
		return { ok: false, reason: `cooldown ${(cooldownUntil - now).toFixed(1)}s` };
	}

	// minCombatSeconds — the warm-up that stops specials firing the instant combat starts.
	if (ability.minCombatSeconds > 0) {
		const engaged = machine.combatStartTime >= 0 ? now - machine.combatStartTime : -1;
		if (engaged < ability.minCombatSeconds) {
			return {
				ok: false,
				reason: `warm-up ${Math.max(0, ability.minCombatSeconds - Math.max(engaged, 0)).toFixed(1)}s left`,
			};
		}
	}

	// SURFACE-TO-SURFACE capsule gap, not centre-to-centre distance.
	//
	// This one line carried the biggest wrong answer this tool ever produced. The AI attack
	// gate is UGameplayAbility_PlayAnimation::CheckAIAttackRequirements, which computes
	// `max(0, Dist2D - radiusA - radiusB)` — "the gap I can hit across". Modelling it as
	// centre-to-centre made every melee whose MaxRange was under the capsule sum look
	// unreachable, and this suite duly reported that four of the six shipped enemies could
	// never land a hit. TSIC.AI.V2's AiApproachParityTest measured the truth in a live
	// session on 2026-08-02: ALL of them land hits, MaleStaff included — 243 damage from
	// 74.8uu with a 50uu MaxRange, which is only possible against a gap of ~0.
	//
	// (The centre-to-centre reading came from ValidateRange, the GENERIC ability path. The AI
	// never goes through it. Check the function the caller actually uses.)
	const centres = dist(agent.pos, target.pos);
	const gap = Math.max(0, centres - agent.radius - (target.radius ?? 35));
	if (ability.minRange !== null && ability.minRange > 0 && gap < ability.minRange) {
		return { ok: false, reason: `too close (gap ${gap.toFixed(0)} < min ${ability.minRange})` };
	}
	if (ability.maxRange !== null && ability.maxRange > 0 && gap > ability.maxRange) {
		return { ok: false, reason: `out of reach (gap ${gap.toFixed(0)} > max ${ability.maxRange})` };
	}
	if (ability.checkLineOfSight && !agent.world.hasLineOfSight(agent.pos, target.pos)) {
		return { ok: false, reason: 'no line of sight' };
	}
	if (agent.casting) return { ok: false, reason: 'already casting' };

	return { ok: true, reason: 'castable' };
}
