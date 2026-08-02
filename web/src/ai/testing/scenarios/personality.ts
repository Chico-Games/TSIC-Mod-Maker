// Per-enemy personality scenarios — the parts of the content that are deliberately NOT the
// base hostile behaviour, plus a sweep that every shipped v2 enemy has to survive.

import type { ScenarioSpec } from '../types';

/** Every enemy carrying `ai_stack: "v2"` in the shipped pack. */
export const V2_ENEMIES = [
	'ED_BoneHead',
	'ED_Gardener',
	'ED_HeavyStaff',
	'ED_Janitor',
	'ED_LivingMannequin',
	'ED_MaleStaff',
	'ED_TVHead',
];

/** Boot + idle + engage, once per enemy. The net that catches "this one throws". */
const sweep: ScenarioSpec[] = V2_ENEMIES.map((def) => ({
	id: `sweep/runs-clean/${def.replace('ED_', '').toLowerCase()}`,
	title: `${def} boots, idles and engages without breaking`,
	tags: ['sweep', 'robustness'],
	seconds: 30,
	enemies: [{ def, x: 0, y: 0, yaw: 0 }],
	players: [{ x: 1200, y: 0, silent: true }],
	script: [{ at: 8, alert: { target: 'player' } }],
	check: (t, e) => {
		const agent = t.agent();
		e.gt('it selected at least one root', agent.roots.length, 0);
		e.ok('no root is ever null after the first tick', agent.at(2).root !== null, `root at 2s: ${agent.at(2).root}`);
		e.happenedWithin('it responds to the alert', agent.firstTargetTime('player'), 12);
		// The generic Flee root was removed from the stack deliberately — nothing may flee.
		e.excludes('never flees', agent.roots, 'Flee');
	},
}));

export const personalityScenarios: ScenarioSpec[] = [
	...sweep,

	{
		id: 'personality/mannequin-freezes-when-watched',
		title: 'The Mannequin freezes while a player is looking at it',
		tags: ['personality', 'mannequin'],
		seconds: 25,
		// Player at +X facing back down -X, straight at the mannequin: is_observed is true.
		enemies: [{ def: 'ED_LivingMannequin', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 900, y: 0, yaw: 180, silent: true }],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('Freeze wins while observed', agent.roots, 'Freeze');
			e.eq('and it holds', agent.at(12).root, 'Freeze');
			e.lt('the statue does not move', agent.distanceTravelled, 60);
		},
	},
	{
		id: 'personality/mannequin-moves-when-unwatched',
		title: 'Look away and the Mannequin starts moving',
		tags: ['personality', 'mannequin'],
		seconds: 30,
		enemies: [{ def: 'ED_LivingMannequin', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 900, y: 0, yaw: 180, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 8, who: 'player', face: 0 },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('frozen while watched', agent.at(6).root, 'Freeze');
			e.ok(
				'moving once the player looks away',
				agent.samples.some((s) => s.t > 10 && s.root !== 'Freeze'),
				`roots after 10s: ${[...new Set(agent.samples.filter((s) => s.t > 10).map((s) => s.root))].join(',')}`,
			);
		},
	},
	{
		id: 'personality/mannequin-gives-up-while-frozen',
		title: 'Staring at a Mannequin should not make it forget you',
		tags: ['personality', 'mannequin', 'stalemate'],
		seconds: 30,
		enemies: [{ def: 'ED_LivingMannequin', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 700, y: 0, yaw: 180, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		// FIXED 2026-08-02. PRC_LivingMannequin inherited PRC_BaseHostile's 8-second give-up,
		// so a Freeze longer than that — which is the whole point of the freeze — tripped the
		// no-bloodshed clock and you could walk away from a mannequin by staring at it. Its
		// profile now sets `give_up_seconds: 0`: patience IS the mannequin.
		check: (t, e) => {
			const agent = t.agent();
			e.eq('still remembers the watcher after the freeze', agent.at(20).target, 'player');
		},
	},
	{
		id: 'personality/malestaff-greets-by-day',
		title: 'The MaleStaff greets rather than attacks in daylight',
		tags: ['personality', 'malestaff', 'daynight'],
		seconds: 30,
		daySection: 'Gameplay.DaySection.Day',
		enemies: [{ def: 'ED_MaleStaff', x: 0, y: 0, yaw: 0 }],
		// Outside the 420uu Combat gate: the day personality should socialise, not fight.
		players: [{ x: 1100, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('Greet is selected', agent.roots, 'Greet');
			e.eq('and nothing is swung', agent.attacks.length, 0);
		},
	},
	{
		id: 'personality/malestaff-hunts-by-night',
		title: 'At night the MaleStaff fights at any range',
		tags: ['personality', 'malestaff', 'daynight'],
		seconds: 30,
		daySection: 'Gameplay.DaySection.Night',
		enemies: [{ def: 'ED_MaleStaff', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 1100, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			// The night Combat entry drops the target_within gate entirely.
			e.contains('Combat is selected at range', agent.roots, 'Combat');
			e.lt('and it closes in', agent.minDistTo('player'), 300);
		},
	},
	{
		id: 'personality/malestaff-provoked-by-day',
		title: 'Hitting a daytime MaleStaff turns it hostile',
		tags: ['personality', 'malestaff'],
		seconds: 30,
		daySection: 'Gameplay.DaySection.Day',
		enemies: [{ def: 'ED_MaleStaff', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 1100, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 5, damage: { to: 'ED_MaleStaff', from: 'player', amount: 30 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			// The provoked Combat entry has no range gate.
			e.ok(
				'Combat takes over once provoked',
				agent.samples.some((s) => s.t > 6 && s.root === 'Combat'),
				`roots after 6s: ${[...new Set(agent.samples.filter((s) => s.t > 6).map((s) => s.root))].join(',')}`,
			);
		},
	},
	{
		id: 'personality/heavystaff-is-slower-than-a-janitor',
		title: 'Movement profiles actually differentiate the enemies',
		tags: ['personality', 'movement'],
		seconds: 30,
		enemies: [
			{ as: 'heavy', def: 'ED_HeavyStaff', x: 0, y: -400, yaw: 0 },
			{ as: 'janitor', def: 'ED_Janitor', x: 0, y: 400, yaw: 0 },
		],
		players: [{ x: 2400, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const heavy = t.agent('heavy').distanceTravelled;
			const janitor = t.agent('janitor').distanceTravelled;
			e.gt('both give chase', Math.min(heavy, janitor), 500);
			e.lt('the heavy one lags behind', heavy, janitor);
		},
	},
	{
		id: 'personality/bonehead-melee-still-works',
		title: 'BoneHead lands its melee across a long kiting fight',
		tags: ['personality', 'bonehead', 'abilities'],
		seconds: 60,
		bounds: { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 },
		enemies: [{ def: 'ED_BoneHead', x: -1200, y: 0, yaw: 0 }],
		players: [{ x: 1200, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// Kite: run away, let it re-open the gap, then let it close again.
			{ at: 12, move: 'player', to: { x: -2600, y: 1800 } },
			{ at: 30, move: 'player', to: { x: 2600, y: -1800 } },
		],
		check: (t, e) => {
			// Whether the standoff attacks are usable at all is engage/standoff-attacks-are-reachable.
			// How MANY swings land depends on where the wander after each give-up drops it, so
			// this asserts that the fight happens at all, not how big it gets.
			e.contains('melee is used', t.agent().attackTags, 'AI.BoneHead.Attack.Melee');
			e.gt('and the player is actually hurt', t.player().damageTaken, 0);
		},
	},
];
