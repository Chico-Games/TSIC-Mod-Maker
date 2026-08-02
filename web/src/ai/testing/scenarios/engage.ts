// Engagement scenarios: closing the gap and landing an attack.
//
// These seed the target through the ally-alert path at t=0 rather than waiting to be seen.
// Acquisition is covered in the perception file; what is under test here is everything AFTER
// a target exists, and a scenario that spends its first seconds waiting for a patrol to turn
// around is a scenario that mostly tests the wander roll.
//
// The number that governs all of it: SKL_Engage drives to `$Attack.MaxRange × 0.9`, and
// `$Attack.MaxRange` is the capsule-sum APPROACH ENVELOPE (agentRadius + targetRadius + 40 =
// 124 for two 42uu pawns), not the ability's reach. So every enemy parks at ~112uu and only
// the ones whose melee reaches that far can hit anything.

import type { ScenarioSpec } from '../types';

/**
 * The melee reach each enemy is granted, straight off the GA_ CDOs in abilities.ts.
 *
 * `night` marks enemies whose daytime personality declines to fight — the MaleStaff greets
 * outside 420uu — so the engagement sweep runs them at night where combat is the intent.
 */
const MELEE = [
	{ def: 'ED_BoneHead', tag: 'AI.BoneHead.Attack.Melee', reach: 150 },
	{ def: 'ED_HeavyStaff', tag: 'AI.HeavyStaff.Attack.Melee', reach: 120, measuredContact: 105.2 },
	{ def: 'ED_Janitor', tag: 'AI.Janitor.Attack.Melee', reach: 110, measuredContact: 77.7 },
	{
		def: 'ED_TVHead',
		tag: 'AI.TVHead.Attack.Melee',
		reach: 100,
		measuredContact: 182.9,
		// TVHead's melee DOES fire here now — the range gate passes. What does not land is the
		// damage, because this port models its hitbox as the 140uu box the MaleStaff montages
		// use (they are shared) while its capsule is ~3x wider, so the box stops short of a
		// target its own body is holding 183uu away. The live run has CH_TVHead_C dealing 189
		// damage, so the GAME lands it and the modelled hitbox geometry is what is wrong.
		// Needs a real hitbox measurement (notify offset + extent on the TVHead montages)
		// before this can be asserted either way.
		hitboxKnownBug:
			'Hitbox geometry, not reach: the melee activates, but this port models TVHead with ' +
			"the shared 140uu MaleStaff hitbox while its capsule is ~141uu wide, so the box " +
			'cannot span the 183uu its own body enforces. The live game lands 189 damage.',
	},
	{ def: 'ED_Gardener', tag: 'AI.Gardener.Attack.Melee', reach: 100, measuredContact: 70.4 },
	{ def: 'ED_MaleStaff', tag: 'AI.MaleStaff.Attack.Melee', reach: 50, night: true },
];

const NIGHT = 'Gameplay.DaySection.Night';

/** SKL_Engage's stopping distance for two standard 42uu pawns. */
const ENGAGE_ACCEPTANCE = (42 + 42 + 40) * 0.9;

/**
 * Where a chase actually STOPS: capsule contact, not the engage acceptance.
 *
 * SKL_Engage's acceptance decides when the MOVE reports success; it does not decide where the
 * pawn ends up. Real path following drives at the target and collision settles it at the
 * capsule sum. TSIC.AI.V2's AiApproachParityTest Gauntlet node measured this on 2026-08-02:
 * Gardener 70.4uu, Janitor 77.7uu, HeavyStaff 105.2uu — all inside the 112uu acceptance, and
 * all landing real damage (297 / 106 / 315). Using acceptance as the stopping distance is what
 * made this suite wrongly report three of them as unable to hit anything.
 */
const CONTACT_DISTANCE = 42 + 42;

/** Every enemy closes the distance once it holds a target. */
const closesIn: ScenarioSpec[] = MELEE.map((enemy) => ({
	id: `engage/closes-in/${enemy.def.replace('ED_', '').toLowerCase()}`,
	title: `${enemy.def} closes on its target`,
	tags: ['combat', 'engage', 'sweep'],
	seconds: 25,
	daySection: enemy.night ? NIGHT : null,
	enemies: [{ def: enemy.def, x: 0, y: 0, yaw: 0 }],
	players: [{ x: 1400, y: 0, silent: true }],
	script: [{ at: 0, alert: { target: 'player' } }],
	check: (t, e) => {
		const agent = t.agent();
		e.contains('reaches the Combat root', agent.roots, 'Combat');
		// The envelope SCALES WITH THE ENEMY: SKL_Engage drives to
		// (rEnemy + rPlayer + 40) x 0.9, and rEnemy is not 42 for everyone — TVHead's capsule
		// puts its acceptance near 200uu, so a flat bound would fail it for being big rather
		// than for being broken. `measuredContact` is rEnemy + rPlayer, straight from the
		// in-game measurement, so the envelope is that plus the 40uu approach gap.
		const envelope = ((enemy.measuredContact ?? 84) + 40) * 0.9;
		e.lte('closes to its own engage envelope', agent.minDistTo('player'), envelope + 25);
		e.happenedWithin('and gets there promptly', agent.firstRootTime('Combat'), 15);
	},
}));

/**
 * The reach audit. An enemy whose melee is shorter than the approach acceptance stops
 * outside its own weapon and swings at nothing — or never swings at all.
 */
const reachAudit: ScenarioSpec[] = MELEE.map((enemy) => {
	// Can this enemy actually get inside its own weapon?
	//
	// The gate is the SURFACE-TO-SURFACE gap (CheckAIAttackRequirements), not centre distance,
	// so the question is how much clear air is left when the approach stops — acceptance minus
	// contact — against the ability's MaxRange. For every shipped enemy that is ~18-28uu
	// against a 50-150uu weapon, so they can all reach. This suite spent a long time asserting
	// the opposite because it compared MaxRange against CENTRE distance.
	const contact = enemy.measuredContact ?? CONTACT_DISTANCE;
	const gapAtStop = Math.max(0, (contact + 40) * 0.9 - contact);
	const canReach = enemy.reach >= gapAtStop;
	return {
		id: `engage/lands-a-hit/${enemy.def.replace('ED_', '').toLowerCase()}`,
		title: `${enemy.def} (melee reach ${enemy.reach}) actually hits the player`,
		tags: ['combat', 'engage', 'reach', 'sweep'],
		seconds: 30,
		daySection: enemy.night ? NIGHT : null,
		enemies: [{ def: enemy.def, x: 0, y: 0, yaw: 0 }],
		players: [{ x: 900, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		knownBug: enemy.hitboxKnownBug
			? enemy.hitboxKnownBug
			: canReach
			? undefined
			: `${enemy.def} settles ${contact.toFixed(0)}uu from its target (capsule contact, measured ` +
				`in-game by TSIC.AI.V2's AiApproachParityTest) and ability range is checked ` +
				`centre-to-centre — UGameplayAbility_PlayAnimation::CalculateDistance is a plain ` +
				`FVector::Dist — so its ${enemy.reach}uu melee is unreachable BY CONSTRUCTION. No ` +
				`approach tuning can fix this; only raising the ability's MaxRange can.`,
		check: (t, e) => {
			const agent = t.agent();
			e.happenedWithin('fires its melee', agent.firstAttackTime(enemy.tag), 25);
			e.gt('and the player loses health', t.player().damageTaken, 0);
		},
	};
});

export const engageScenarios: ScenarioSpec[] = [
	...closesIn,
	...reachAudit,

	{
		id: 'engage/mannequin-grab',
		title: 'The Mannequin grabs a player who is not looking at it',
		tags: ['combat', 'engage'],
		seconds: 30,
		// Facing +X with the mannequin behind: is_observed is false, so it does not freeze.
		enemies: [{ def: 'ED_LivingMannequin', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 900, y: 0, yaw: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			// Grab: reach 200, warm-up 5s, cooldown 14s — the only granted attack it has.
			e.happenedWithin('grabs once the warm-up lapses', agent.firstAttackTime('Attack.Grab'), 25);
			e.gte('the warm-up is honoured', agent.firstAttackTime('Attack.Grab'), 5);
			e.ok('the player is held', t.player().everGrabbed);
		},
	},
	{
		id: 'engage/warmup-gate-holds',
		title: 'A min-combat warm-up keeps the special out of the opening exchange',
		tags: ['combat', 'abilities'],
		seconds: 30,
		enemies: [{ def: 'ED_BoneHead', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 600, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const charge = t.agent().firstAttackTime('Attack.Charge');
			const throwAt = t.agent().firstAttackTime('Attack.Throw');
			// Both carry minCombatSeconds 5; melee carries none.
			e.ok(
				'Charge never fires inside the 5s warm-up',
				charge === null || charge >= 5,
				`first charge at ${charge ?? 'never'}`,
			);
			e.ok(
				'Throw never fires inside the 5s warm-up',
				throwAt === null || throwAt >= 5,
				`first throw at ${throwAt ?? 'never'}`,
			);
		},
	},
	{
		id: 'engage/min-range-gate',
		title: 'A standoff attack is skipped at point-blank range',
		tags: ['combat', 'abilities'],
		seconds: 30,
		enemies: [{ def: 'ED_BoneHead', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 200, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			// Charge is min 150 / max 750; from a standing start inside melee it should never
			// be the pick once the agent has closed to ~112uu.
			const chargeInside = agent.attacks.filter((a) => a.tag.endsWith('Charge') && a.distance < 150);
			e.eq('Charge never fires below its minimum range', chargeInside.length, 0);
			e.contains('melee is what it uses up close', agent.attackTags, 'AI.BoneHead.Attack.Melee');
		},
	},
	{
		id: 'engage/standoff-attacks-are-reachable',
		title: 'A standoff attack with a minimum range can actually be used',
		tags: ['combat', 'abilities', 'reach'],
		seconds: 60,
		bounds: { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 },
		enemies: [{ def: 'ED_BoneHead', x: -1800, y: 0, yaw: 0 }],
		players: [{ x: 1400, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// Kite so the fight spends plenty of time in the 150–750 and 400–2000 bands.
			{ at: 14, move: 'player', to: { x: -2600, y: 1800 } },
			{ at: 34, move: 'player', to: { x: 2600, y: -1800 } },
		],
		knownBug:
			'No attack with a minimum range can ever fire. SKL_Engage only leaves CloseIn for ' +
			'Swing on actions_succeeded — i.e. after ARRIVING — so by the time an attack is ' +
			'allowed to fire the agent sits at the approach envelope, inside every standoff ' +
			'minimum. The gate is the surface-to-surface GAP, so BoneHead needs ~244uu of ' +
			'centre distance for its 150-gap Charge and gets ~121. The selector sorts ' +
			'highest-minimum-range first precisely so specials beat the point-blank filler, ' +
			'and nothing ever reaches it. HALF-FIXED 2026-08-02: ScpAi2::SelectAttack now ' +
			'publishes the winner\'s real MinRange into $Attack.MinRange (it was hardcoded to ' +
			'0, throwing away the one number a standoff needs), so a behaviour CAN now gate an ' +
			'early swing on it — no shipped skill does yet, which is why this still fails.',
		check: (t, e) => {
			const tags = t.agent().attackTags;
			e.gte('more than the point-blank filler is used', tags.length, 2);
			e.ok(
				'a min-range ability fires at least once',
				tags.some((tag) => tag.endsWith('Charge') || tag.endsWith('Throw')),
				`fired [${tags.join(', ') || 'nothing'}]`,
			);
		},
	},
	{
		id: 'engage/attack-cadence-respects-cooldown',
		title: 'Melee cadence is bounded by cooldown and montage length',
		tags: ['combat', 'abilities'],
		seconds: 30,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 400, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const swings = t.agent().attacks.filter((a) => a.tag === 'AI.Janitor.Attack.Melee');
			e.gte('it does keep attacking', swings.length, 3);
			// 1.75s cooldown on top of a 2.63s montage caps this well under 30/1.75.
			e.lte('but never faster than the cooldown allows', swings.length, Math.ceil(30 / 1.75));
			const gaps = swings.slice(1).map((a, i) => a.t - swings[i].t);
			e.gte('no two swings overlap', Math.min(...(gaps.length ? gaps : [99])), 1.75);
		},
	},
	{
		id: 'engage/committed-attack-roots-the-agent',
		title: 'An agent mid-swing does not slide around',
		tags: ['combat', 'abilities'],
		seconds: 25,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 400, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const casting = t.agent().samples.filter((s) => s.casting);
			e.gt('it swings at all', casting.length, 0);
			e.eq('speed is zero for every casting sample', casting.filter((s) => s.speed > 1).length, 0);
		},
	},
	{
		id: 'engage/no-op-abilities-outrank-the-working-one',
		title: "The Janitor's live melee is not shouldered aside by its dead acid attacks",
		tags: ['combat', 'abilities', 'content'],
		seconds: 40,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 500, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		knownBug:
			'MOSTLY REFUTED 2026-08-02 — kept as a watch. Acid.Melee is NOT dead: GA_AcidAOE ' +
			'carries two live effect groups (MouthSpray 22 damage, AcidPool 8 / 30-vs-entities) ' +
			'and Roar__1__Anim1_Montage has the matching Hitbox notifies for both — read from ' +
			'the live assets, where the old note had guessed. The pool actor it spawns WAS ' +
			'broken: A_AcidAOE shipped with an empty GameplayEffects array and logged "This AOE ' +
			'will not function" on every cast; that is now wired to GE_Damage and saved. What ' +
			'remains UNVERIFIED is Acid.Ranged — AS_Throw has no Hitbox notify, so the ability ' +
			'own effect group never fires and the damage rides on a flask actor spawned by an ' +
			'AnimNotify_SpawnActor whose payload has not been read.',
		check: (t, e) => {
			const agent = t.agent();
			const dead = agent.attacks.filter((a) => a.dead);
			e.eq('no montage is spent on a no-op ability', dead.length, 0);
			e.gt('the working melee does fire', agent.attacks.filter((a) => !a.dead).length, 0);
		},
	},
	{
		id: 'engage/target-dies-mid-fight',
		title: 'Killing the target ends the engagement cleanly',
		tags: ['combat', 'aggro'],
		seconds: 30,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 500, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 12, kill: 'player' },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('it was fighting', agent.roots, 'Combat');
			e.eq('the target is dropped once dead', agent.final.target, null);
			e.excludes('and it does not sit in Combat forever', [agent.final.root ?? ''], 'Combat');
		},
	},
];
