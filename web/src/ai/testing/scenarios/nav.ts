// Navigation, furniture and idle-behaviour scenarios.
//
// The nav model under test: a root's `nav_policy` decides whether furniture is pathable at
// all. `breach` (the aggro roots) treats furniture as passable at a cost and reports the
// first blocker as $Path.BlockingEntity; `blocking` (everything else) routes around it. Only
// furniture the agent CAN break is reported — a blocker it cannot break must never raise
// PathBlocked, because Chase's action_failed self-loop would live-lock on the grace ticks.

import type { ScenarioSpec } from '../types';

/** A line of furniture across the middle of the map with open floor above and below it. */
function furnitureLine(opts: { breakable: boolean; armour?: number; health?: number }) {
	const ys: number[] = [];
	for (let y = -1000; y <= 1000; y += 200) ys.push(y);
	return ys.map((y, i) => ({
		as: `block${i}`,
		x: 600,
		y,
		halfExtent: 110,
		health: opts.health ?? 200,
		armour: opts.armour ?? 1,
		breakable: opts.breakable,
		blocksSight: false,
	}));
}

export const navScenarios: ScenarioSpec[] = [
	{
		id: 'nav/blind-corner-chase',
		title: 'A chase around a blind corner goes to the last known position',
		tags: ['nav', 'chase'],
		seconds: 30,
		arena: 'corridor',
		enemies: [{ def: 'ED_Janitor', x: -1600, y: 0, yaw: 0 }],
		players: [{ x: -1000, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 2, move: 'player', to: { x: 2200, y: 1600 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('it commits to the chase', agent.roots, 'Chase');
			e.gt('and covers real ground', agent.distanceTravelled, 800);
			e.lt('closing on the player rather than milling about', agent.minDistTo('player'), 1200);
		},
	},
	{
		id: 'nav/routes-around-unbreakable-furniture',
		title: 'Furniture it cannot break is routed around, not attacked',
		tags: ['nav', 'furniture'],
		seconds: 35,
		enemies: [{ def: 'ED_Janitor', x: -1200, y: 0, yaw: 0 }],
		players: [{ x: 1200, y: 0, silent: true }],
		// Blocks the direct line; open floor above y=1100 and below y=-1100 is the detour.
		furniture: furnitureLine({ breakable: false }),
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			// Checked as a ROUTE, not an arrival: crossing the line at all proves it detoured.
			// Whether it still holds the target by the time it gets there is
			// aggro/visible-target-is-not-abandoned's problem, not this scenario's.
			e.gt('it gets past the barrier', Math.max(...agent.samples.map((s) => s.x)), 700);
			e.gt('by going around the end of it', Math.max(...agent.samples.map((s) => Math.abs(s.y))), 900);
			e.eq(
				'and never swings at the unbreakable blocker',
				t.damage.filter((d) => d.victimKind === 'furniture').length,
				0,
			);
		},
	},
	{
		id: 'nav/blocker-smash-narrow',
		title: 'A narrow breakable blocker is approached AND smashed',
		tags: ['nav', 'furniture', 'reach'],
		// 200hp of furniture at ~12 damage a swing, through ~3s montages with cooldowns, is
		// roughly a minute of demolition before the doorway opens. The old 40s budget was
		// shorter than the job and read as "the chase never gets through".
		seconds: 100,
		// The furniture fills the doorway exactly: no gap to slip through, so the only way
		// past is through it. Narrow enough that SKL_DestroyEntity's hardcoded 180uu
		// acceptance is physically reachable — collision only holds the agent off at
		// agentRadius + halfExtent x 0.8 = 130uu.
		walls: [
			[600, -2200, 600, -110],
			[600, 110, 600, 2200],
		],
		enemies: [{ def: 'ED_BoneHead', x: -1200, y: 0, yaw: 0 }],
		players: [{ x: 1200, y: 0, silent: true }],
		furniture: [
			{ as: 'door', x: 600, y: 0, halfExtent: 110, health: 120, armour: 1, breakable: true, blocksSight: false },
		],
		script: [{ at: 0, alert: { target: 'player' } }],
		// FIXED 2026-08-02. This carried a long "the deliberate smash can never fire, for ANY
		// enemy at ANY blocker size" note, reasoned from ability range being checked
		// centre-to-centre. It is not: the AI gate is CheckAIAttackRequirements, which measures
		// the SURFACE-TO-SURFACE capsule gap, so a 180uu approach against a 60uu blocker leaves
		// a ~68uu gap that BoneHead's 150uu melee covers comfortably. The smash lands.
		check: (t, e) => {
			const agent = t.agent();
			e.contains('it takes the ClearPath branch', agent.states, 'ClearPath');
			e.gt('the blocker takes damage', t.damage.filter((d) => d.to === 'door').length, 0);
			e.lt('and the chase resumes on the far side', agent.minDistTo('player'), 600);
		},
	},
	{
		id: 'nav/blocker-smash-wide',
		title: 'A wide breakable blocker is at least approached',
		tags: ['nav', 'furniture', 'reach'],
		seconds: 45,
		walls: [
			[600, -2200, 600, -260],
			[600, 260, 600, 2200],
		],
		enemies: [{ def: 'ED_BoneHead', x: -1200, y: 0, yaw: 0 }],
		players: [{ x: 1200, y: 0, silent: true }],
		furniture: [
			{ as: 'door', x: 600, y: 0, halfExtent: 260, health: 120, armour: 1, breakable: true, blocksSight: false },
		],
		script: [{ at: 0, alert: { target: 'player' } }],
		// FIXED 2026-08-02. A wide blocker could not be APPROACHED: collision holds the agent
		// at `agentRadius + halfExtent x 0.8` while SKL_DestroyEntity asked for a hardcoded
		// 180uu, so the move never succeeded and Smash was never entered. The skill now uses
		// `acceptance_from_actor: "$In.Entity"` — the capsule-sum envelope, which scales with
		// the furniture — so the stop is always somewhere the agent can physically stand.
		check: (t, e) => {
			e.gt('the wide blocker takes damage', t.damage.filter((d) => d.to === 'door').length, 0);
			e.contains('through the ClearPath branch', t.agent().states, 'ClearPath');
		},
	},
	{
		id: 'nav/real-furniture-definition-hydrates',
		title: 'A real damageable-furniture definition drives the blocker',
		tags: ['nav', 'furniture', 'content'],
		seconds: 20,
		enemies: [{ def: 'ED_BoneHead', x: -1200, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 1200, y: 0, silent: true }],
		// FD_BulletinBoard_DF: starting_health 30, furniture_armour 1, ~90uu half-extent —
		// read straight out of the shipped JSON rather than hand-fed numbers. Damaged by
		// script rather than by the AI, because the smash chain is broken independently
		// (nav/blocker-smash-narrow) and this scenario is about the JSON -> sim hydration.
		furniture: [{ as: 'board', def: 'FD_BulletinBoard_DF', x: 0, y: 0 }],
		script: [
			{ at: 1, damage: { to: 'board', amount: 12 } },
			{ at: 2, damage: { to: 'board', amount: 12 } },
			{ at: 3, damage: { to: 'board', amount: 12 } },
		],
		check: (t, e) => {
			const hits = t.damage.filter((d) => d.to === 'board');
			e.eq('all three hits land', hits.length, 3);
			// armour 1 vs 12 raw: 1 < 6 so the flat branch applies, 12 - 1 = 11.
			e.eq('the armour tier comes from the JSON', hits[0]?.final, 11);
			// starting_health 30: three 11s overkill it.
			e.ok('and starting_health comes from the JSON too', hits.length === 3, 'hydrated');
		},
	},
	{
		id: 'nav/armour-curve',
		title: 'Furniture armour follows the Valheim curve',
		tags: ['nav', 'furniture', 'formula'],
		seconds: 6,
		enemies: [{ def: 'ED_BoneHead', x: -2000, y: -2000, yaw: 0, frozen: true, paused: true }],
		players: [{ x: 2000, y: 2000, silent: true }],
		furniture: [
			{ as: 'cardboard', x: 0, y: -600, halfExtent: 60, health: 999, armour: 1, breakable: true },
			{ as: 'wood', x: 0, y: -200, halfExtent: 60, health: 999, armour: 2, breakable: true },
			{ as: 'metal', x: 0, y: 200, halfExtent: 60, health: 999, armour: 3, breakable: true },
			{ as: 'concrete', x: 0, y: 600, halfExtent: 60, health: 999, armour: 4, breakable: true },
		],
		script: [
			{ at: 1, damage: { to: 'cardboard', amount: 12 } },
			{ at: 1, damage: { to: 'wood', amount: 12 } },
			{ at: 1, damage: { to: 'metal', amount: 12 } },
			{ at: 1, damage: { to: 'concrete', amount: 12 } },
			// A weak hit against concrete: 4 >= 6/2, so this one crosses into the curve.
			{ at: 2, damage: { to: 'concrete', amount: 6 } },
		],
		check: (t, e) => {
			const took = (who: string) => t.damage.find((d) => d.to === who)?.final ?? null;
			// H = D - A while A < D/2 (flat), H = D^2 / 4A once A >= D/2 (diminishing).
			e.eq('cardboard: flat subtraction', took('cardboard'), 11);
			e.eq('wood: flat subtraction', took('wood'), 10);
			e.eq('metal: flat subtraction', took('metal'), 9);
			e.eq('concrete, big hit: still the flat branch', took('concrete'), 8);
			// 6² / (4 × 4) = 2.25 — heavy armour turns a light hit into a scratch.
			e.eq('concrete, light hit: the diminishing branch', t.damage.filter((d) => d.to === 'concrete')[1]?.final, 2.25);
		},
	},
	{
		id: 'nav/unreachable-target-does-not-wedge',
		title: 'A target that cannot be reached at all degrades to searching',
		tags: ['nav', 'chase', 'robustness'],
		seconds: 40,
		walls: [
			[600, -500, 600, 500],
			[600, 500, 1600, 500],
			[600, -500, 1600, -500],
			[1600, -500, 1600, 500],
		],
		enemies: [{ def: 'ED_Janitor', x: -1000, y: 0, yaw: 0 }],
		players: [{ x: 1100, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			e.gt('it tried something', agent.roots.length, 0);
			// The failure mode this guards: pinned in Chase forever, retrying a dead path.
			e.lte('it does not sit in Chase for the whole run', agent.secondsInRoot('Chase'), 30);
			e.ok(
				'it ends up somewhere sane',
				['Search', 'Patrol', 'Investigate', 'Chase'].includes(agent.final.root ?? ''),
				`final root ${agent.final.root}`,
			);
		},
	},
	{
		id: 'nav/idle-patrol-moves',
		title: 'With nothing to do an enemy patrols',
		tags: ['nav', 'idle'],
		seconds: 40,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2800, y: 2000, silent: true }],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('Patrol is the resting root', agent.roots, 'Patrol');
			e.gt('and it actually walks', agent.distanceTravelled, 400);
			// Wander legs are 6s: a healthy patrol re-picks, it does not thrash every tick.
			e.lte('without thrashing between roots', agent.rootSwitches, 8);
		},
	},
	{
		id: 'nav/wander-streams-are-per-agent',
		title: 'Two identical enemies on the same spot wander differently',
		tags: ['nav', 'idle', 'determinism'],
		seconds: 40,
		enemies: [
			{ as: 'twin-a', def: 'ED_Janitor', x: 0, y: 0, yaw: 0 },
			{ as: 'twin-b', def: 'ED_Janitor', x: 0, y: 0, yaw: 0 },
		],
		players: [{ x: 2800, y: 2000, silent: true }],
		check: (t, e) => {
			const a = t.agent('twin-a').final;
			const b = t.agent('twin-b').final;
			// Each agent draws from its own seeded stream, so they diverge — and they do it the
			// same way on every run. A shared stream would make this test meaningless in the
			// other direction: adding an agent would shift everyone else's rolls.
			e.gt('the twins end up in different places', Math.hypot(a.x - b.x, a.y - b.y), 200);
		},
	},
	{
		id: 'nav/investigate-then-settle',
		title: 'After investigating a noise it settles back to patrol',
		tags: ['nav', 'idle', 'hearing'],
		seconds: 45,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2800, y: 2000, silent: true }],
		script: [{ at: 1, noise: { at: { x: 1200, y: 0 }, loudness: 1, range: 2500 } }],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('it investigates', agent.roots, 'Investigate');
			// heard_noise_within is 8s and noise_lifetime 8s: the interest must expire.
			e.eq('and is back on patrol by the end', agent.final.root, 'Patrol');
		},
	},
	{
		id: 'nav/no-target-no-combat',
		title: 'An idle enemy never enters a combat root on its own',
		tags: ['nav', 'idle', 'robustness'],
		seconds: 45,
		bounds: { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 },
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2800, y: 2800, silent: true }],
		check: (t, e) => {
			const agent = t.agent();
			e.excludes('no Combat', agent.roots, 'Combat');
			e.excludes('no Chase', agent.roots, 'Chase');
			e.eq('no attacks fired', agent.attacks.length, 0);
		},
	},
];
