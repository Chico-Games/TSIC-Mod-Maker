// Engagement scenarios: closing the gap and landing an attack.
//
// These seed the target through the ally-alert path at t=0 rather than waiting to be seen.
// Acquisition is covered in the perception file; what is under test here is everything AFTER
// a target exists, and a scenario that spends its first seconds waiting for a patrol to turn
// around is a scenario that mostly tests the wander roll.
//
// The number that governs all of it: SKL_Engage drives to `$Attack.MaxRange × 0.9`, and
// `$Attack.MaxRange` is the capsule-sum APPROACH ENVELOPE (agentRadius + targetRadius + 40),
// not the ability's reach — so an enemy parks roughly 40uu × 0.9 of clear air short of contact.
//
// That leftover air is what an attack has to reach across, because the AI attack gate
// (UGameplayAbility_PlayAnimation::CheckAIAttackRequirements) measures the SURFACE-TO-SURFACE
// capsule gap, NOT centre-to-centre distance. It comes to ~18-28uu against weapons of 50-150uu,
// so every shipped melee reaches comfortably. This file spent a long time asserting the
// opposite — that four of six enemies could never land a hit — because it compared MaxRange
// against centre distance and read the generic ValidateRange path instead of the AI one.
// TSIC.AI.V2's AiApproachParityTest settled it in a live session: they all land hits.

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
		// TVHead's melee DOES fire — the range gate passes. What does not land is the damage,
		// and it is a ~2uu MODELLING MARGIN, not a content bug. Measured, not guessed.
		hitboxKnownBug:
			"TVHead's hitbox is byte-identical to MaleStaff's (offset 0,80,90 scale 1.0,1.2,1.3 " +
			'-> reach 140 from the mesh origin, read from AS_Attack_01_Montage on 2026-08-02), ' +
			'and its own capsule holds it ~184uu from the target. Reach 140 plus the 42uu ' +
			"player radius is 182, so this port's 2D box-vs-circle test lands 2uu on the MISS " +
			'side while the real 3D box-vs-capsule overlap lands on the HIT side — the live ' +
			'game deals 162-189 damage every run. Closing this needs a real capsule overlap ' +
			'test, not a different reach number.',
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
			: `${enemy.def} stops with a ${gapAtStop.toFixed(0)}uu surface-to-surface gap to its ` +
				`target (capsule contact ${contact.toFixed(0)}uu, measured in-game by ` +
				`TSIC.AI.V2's AiApproachParityTest). CheckAIAttackRequirements gates on that GAP, ` +
				`so a ${enemy.reach}uu melee cannot reach across it. Only raising the ability's ` +
				`MaxRange closes this; approach tuning cannot.`,
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
			'Swing on actions_succeeded — i.e. after ARRIVING — so by the time an attack may ' +
			'fire the agent is at the approach envelope, inside every standoff minimum. ' +
			"HALF-FIXED 2026-08-02: ScpAi2::SelectAttack now publishes the winner's real " +
			'MinRange into $Attack.MinRange (it was hardcoded to 0, discarding the one number a ' +
			'standoff needs), so a behaviour CAN gate on it. THE OBVIOUS FIX IS WRONG, THOUGH — ' +
			'adding `on: tick -> Swing when has_attack && $Attack.MinRange > 0` makes this ' +
			'scenario pass and makes the GAME worse: AiApproachParityTest measured BoneHead ' +
			'hovering at 691uu burning 4s and 7s standoff montages and dealing 0 damage, where ' +
			'it had been closing to ~120uu for 240. Firing a special costs the approach, and ' +
			'BoneHead has ~20s of standoff montage to spend in a 30s fight. A real fix has to ' +
			'bound how much of an engagement standoff attacks may consume — design call, not a ' +
			'transition. Reverted 2026-08-02; the sim alone would have shipped it.',
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
