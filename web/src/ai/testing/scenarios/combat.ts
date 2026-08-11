// Combat against a player who MOVES.
//
// Every other scenario file parks the player on a spot and asks whether the enemy can walk to
// it. That answers "does the chase work" and nothing about how the fight FEELS, because a
// standing target hides the entire class of defect a real fight is made of: an enemy that
// tracks perfectly and lands unavoidable hits, an enemy that swings where you used to be, an
// enemy that can never catch a back-pedalling player and quietly gives up, an enemy that
// overshoots when you juke past it.
//
// The observable that matters here is the WHIFF RATE — swings fired against damage landed.
// A static-target suite reports 100% and learns nothing. These scenarios keep the player
// orbiting or retreating and read the same number, which is what makes them worth running.
//
// The two inputs this file leans on are `orbit` (circle-strafe, holding a radius) and
// `keepAway` (kiting, holding a range), both with `track` so the player keeps the enemy in
// view the way a mouse would. See ../types.ts.

import type { ScenarioSpec, Trace } from '../types';

const NIGHT = 'Gameplay.DaySection.Night';

/**
 * The enemies worth running movement tests against, with the contact distance each one was
 * MEASURED at in a live session (AiApproachParityTest, 2026-08-02 — see the notes at the top
 * of engage.ts). Capsules are nowhere near uniform, so a single orbit radius would put the
 * player inside TVHead and outside Gardener; every scenario below derives its radius from
 * this number instead.
 */
const ROSTER = [
	{ def: 'ED_BoneHead', contact: 94, speed: 'slow' },
	{ def: 'ED_Gardener', contact: 70.4 },
	{ def: 'ED_HeavyStaff', contact: 105.2, speed: 'slow' },
	{ def: 'ED_Janitor', contact: 77.7 },
	{ def: 'ED_TVHead', contact: 182.9 },
	{ def: 'ED_MaleStaff', contact: 75, night: true },
];

const shortName = (def: string) => def.replace('ED_', '').toLowerCase();

/**
 * Facing error, in degrees, at the moment each swing started.
 *
 * This is the number that separates "the attack missed because the player dodged" from "the
 * attack was pointed at nothing when it fired". The hitbox is a box swept forward from the
 * mesh origin, so a swing released 90 degrees off the target cannot land whatever its reach.
 */
function facingErrorsAtSwing(trace: Trace, agentHandle?: string, playerHandle = 'player'): number[] {
	const agent = trace.agent(agentHandle);
	const player = trace.player(playerHandle);
	return agent.attacks.map((attack) => {
		const a = agent.at(attack.t);
		const p = player.at(attack.t);
		const want = (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
		return Math.abs(((want - a.yaw + 540) % 360) - 180);
	});
}

const mean = (rows: number[]) => (rows.length ? rows.reduce((sum, v) => sum + v, 0) / rows.length : 0);

// ---------------------------------------------------------------------------
// Circle-strafe
// ---------------------------------------------------------------------------

/**
 * The core case. The player holds contact range and walks a circle around the enemy for the
 * whole fight, facing it the entire time — exactly what a person does when a melee enemy
 * closes on them.
 *
 * What this must prove is that the enemy still gets to FIGHT: it keeps its target, it keeps
 * up with the circle, and its swings are pointed at the player when they are released. It
 * deliberately does NOT assert that every swing lands — a player who strafes well should beat
 * some of them, and asserting otherwise would be asking for an enemy that cannot be dodged.
 */
const circleStrafe: ScenarioSpec[] = ROSTER.map((enemy) => ({
	id: `combat/circle-strafe/${shortName(enemy.def)}`,
	title: `${enemy.def} keeps fighting a player circling it at contact range`,
	tags: ['combat', 'movement', 'strafe', 'sweep'],
	seconds: 30,
	daySection: enemy.night ? NIGHT : null,
	enemies: [{ def: enemy.def, x: 0, y: 0, yaw: 0 }],
	players: [{ x: enemy.contact + 60, y: 0, silent: true }],
	script: [
		{ at: 0, alert: { target: 'player' } },
		// Let it close first, then start circling — a player who orbits from across the room
		// is testing the chase, not the fight.
		{ at: 4, move: 'player', orbit: enemy.def, radius: enemy.contact + 30 },
		{ at: 4, who: 'player', track: enemy.def },
	],
	check: (t, e) => {
		const agent = t.agent();
		e.contains('is in the Combat root', agent.roots, 'Combat');
		e.ok('holds the player for 10s straight', agent.heldTargetFor('player', 10));
		// Keeping up with the circle: the enemy must stay near the ring, not be left behind.
		e.lte('stays in contact with the circling player', agent.minDistTo('player'), enemy.contact + 90);
		e.gt('swings at it', agent.attacks.length, 0);
		const errors = facingErrorsAtSwing(t);
		e.lte('swings are aimed at the player when released', mean(errors), 45);
	},
}));

// ---------------------------------------------------------------------------
// Kiting
// ---------------------------------------------------------------------------

/**
 * The player back-pedals and holds 500uu. Nothing here is dodgeable — the question is whether
 * the enemy keeps trying.
 *
 * This is the scenario the stalemate give-up was built for and the one most likely to catch a
 * regression in it: an agent that never draws blood and never closes is exactly what
 * `TryStalemateGiveUp` looks for, and a retreating player produces both conditions honestly.
 * The fix landed on 2026-08-02 requires BOTH the bloodshed clock and a no-progress clock to
 * run out, and a kited enemy IS making progress on the target's last known position, so it
 * must not give up.
 */
const kite: ScenarioSpec[] = ROSTER.filter((enemy) => !enemy.night).map((enemy) => ({
	id: `combat/kited-enemy-does-not-give-up/${shortName(enemy.def)}`,
	title: `${enemy.def} keeps chasing a player back-pedalling at 500uu`,
	tags: ['combat', 'movement', 'kite', 'stalemate', 'sweep'],
	seconds: 30,
	// A big arena: a kited chase eats ground, and a player cornered against a wall is a
	// different scenario (it stops being a kite the moment the retreat runs out).
	bounds: { minX: -6000, minY: -4000, maxX: 6000, maxY: 4000 },
	enemies: [{ def: enemy.def, x: 0, y: 0, yaw: 0 }],
	players: [{ x: 500, y: 0, silent: true }],
	script: [
		{ at: 0, alert: { target: 'player' } },
		{ at: 0.5, move: 'player', keepAway: enemy.def, distance: 500 },
		{ at: 0.5, who: 'player', track: enemy.def },
	],
	check: (t, e) => {
		const agent = t.agent();
		e.ok('still holds the player at the end', agent.final.target === 'player');
		e.gt('and actually chased it', agent.distanceTravelled, 1500);
		e.excludes('never falls back to Patrol', agent.roots, 'Patrol');
	},
}));

// ---------------------------------------------------------------------------
// One-off situations
// ---------------------------------------------------------------------------

const situations: ScenarioSpec[] = [
	{
		id: 'combat/nobody-can-catch-a-walking-player',
		title: 'Every enemy is slower than a player who simply walks away',
		tags: ['combat', 'movement', 'kite', 'tuning'],
		seconds: 25,
		bounds: { minX: -2000, minY: -4000, maxX: 16000, maxY: 4000 },
		// One of each, all chasing the same retreating player in a straight line. Any of them
		// that gains ground proves it can win a footrace; the rest cannot.
		enemies: [
			{ as: 'bonehead', def: 'ED_BoneHead', x: -300, y: 0, yaw: 0 },
			{ as: 'gardener', def: 'ED_Gardener', x: -300, y: 200, yaw: 0 },
			{ as: 'heavystaff', def: 'ED_HeavyStaff', x: -300, y: -200, yaw: 0 },
			{ as: 'janitor', def: 'ED_Janitor', x: -300, y: 400, yaw: 0 },
			{ as: 'mannequin', def: 'ED_LivingMannequin', x: -300, y: -400, yaw: 0 },
		],
		players: [{ x: 0, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// Straight-line retreat at the plain WALK speed. No sprint, no dodging, no corners:
			// if an enemy cannot close this it cannot close anything.
			{ at: 0.5, move: 'player', dir: { x: 1, y: 0 } },
		],
		knownBug:
			'THE CENTRAL COMBAT-FEEL DEFECT, and the sim only had to be told the real numbers to ' +
			'show it. Every chase and SKL_Engage runs the `sprint` movement profile, which is ' +
			'315uu/s on BoneHead/Gardener/Janitor/MaleStaff/TVHead, 238 on HeavyStaff and 364 on ' +
			'the LivingMannequin (enemy_definitions/*.json movement_profiles). AScpCharacter ' +
			'sets MaxWalkSpeed 500, and GE_SprintSpeedBoost takes that to 700. So a player who ' +
			'never presses sprint is 59% faster than the fastest thing in the game, and every ' +
			'enemy loses ground on a straight retreat forever. That is why a fight ends with the ' +
			'enemy trailing behind and then wandering off: nothing can force an engagement. ' +
			'Fixing it is a TUNING decision (raise sprint profiles, or make the chase gait ' +
			'catch-up-scaled) and belongs to the user, not to this suite.',
		check: (t, e) => {
			// Ground gained over the run: start distance minus closest approach. Positive means
			// the enemy got nearer at some point than it began; negative means it lost the race.
			for (const handle of t.agentHandles) {
				const agent = t.agent(handle);
				const start = agent.distToAt('player', 1);
				const end = agent.distToAt('player', 22);
				e.lt(`${handle} gains ground on the retreat`, end - start, 0);
			}
		},
	},
	{
		id: 'combat/juke-past-the-enemy',
		title: 'A player who sprints straight past a Janitor is re-acquired, not lost',
		tags: ['combat', 'movement', 'juke'],
		seconds: 25,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 1200, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// Run through the enemy and out the far side: it has to stop, turn and re-close.
			{ at: 3, move: 'player', to: { x: -1200, y: 0 } },
			{ at: 12, stop: 'player' },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.ok('never loses the player', agent.heldTargetFor('player', 15));
			e.lte('and closes on it again after the juke', agent.minDistTo('player'), 160);
			// The turn-around is the interesting half: an agent that overshoots by a room's
			// width and lumbers back is the "wonky" feel, even though it re-acquires.
			e.gt('kept moving through the reversal', agent.distanceTravelled, 800);
		},
	},
	{
		id: 'combat/corner-peek-holds-aggro',
		title: 'Orbiting a pillar that keeps breaking line of sight does not shake the enemy',
		tags: ['combat', 'movement', 'perception'],
		seconds: 30,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: 0, y: -1200, yaw: 90 }],
		players: [{ x: 0, y: 900, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// The pillar spans +/-300; orbit outside it so the block is intermittent.
			{ at: 2, move: 'player', orbit: 'ED_Janitor', radius: 700 },
			{ at: 2, who: 'player', track: 'ED_Janitor' },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.ok('holds the player through repeated LOS breaks', agent.heldTargetFor('player', 12));
			e.excludes('never drops to Patrol', agent.roots, 'Patrol');
		},
	},
	{
		id: 'combat/surrounded-while-moving',
		title: 'Three enemies on a circling player still respect the two-attacker cap',
		tags: ['combat', 'movement', 'coordinator'],
		seconds: 30,
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -600, y: 0, yaw: 0 },
			{ as: 'b', def: 'ED_Gardener', x: 600, y: 0, yaw: 180 },
			{ as: 'c', def: 'ED_Janitor', x: 0, y: 600, yaw: 270 },
		],
		players: [{ x: 0, y: -900, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 4, move: 'player', orbit: 'a', radius: 500 },
			{ at: 4, who: 'player', track: 'a' },
		],
		check: (t, e) => {
			// The cap is the whole point: a moving player must not turn the pack into a
			// free-for-all just because the token holder keeps falling out of range.
			let peak = 0;
			const handles = t.agentHandles;
			const samples = handles.map((h) => t.agent(h).samples);
			for (let i = 0; i < samples[0].length; i += 1) {
				peak = Math.max(peak, samples.filter((rows) => rows[i]?.hasToken).length);
			}
			e.lte('never more than two attackers at once', peak, 2);
			e.gt('but somebody does engage', peak, 0);
			for (const handle of handles) {
				e.ok(`${handle} keeps the player`, t.agent(handle).heldTargetFor('player', 8));
			}
		},
	},
];

export const combatScenarios: ScenarioSpec[] = [...circleStrafe, ...kite, ...situations];
