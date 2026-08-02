// Targeting and aggro scenarios.
//
// The shipped model is burst-or-loss-only: once a target is held there is NO score
// re-evaluation, so a target can only change hands through damage (switch_damage 25, or 1.5×
// the incumbent's recent damage) or be given up entirely (stalemate: 8s with nobody
// bleeding, then a 20s refusal to re-acquire). Everything below pins one edge of that.

import type { ScenarioSpec } from '../types';

/** Highest number of agents holding an attack token at any single sampled instant. */
function peakSimultaneousTokens(handles: string[], trace: any): number {
	const rows = handles.map((h) => trace.agent(h).samples);
	const length = Math.min(...rows.map((r: any[]) => r.length));
	let peak = 0;
	for (let i = 0; i < length; i += 1) {
		peak = Math.max(peak, rows.filter((r: any[]) => r[i].hasToken).length);
	}
	return peak;
}

export const aggroScenarios: ScenarioSpec[] = [
	{
		id: 'aggro/no-juggling-between-targets',
		title: 'A held target is not swapped for a closer one',
		tags: ['aggro', 'targeting'],
		seconds: 35,
		// BoneHead, not a Janitor: its melee actually reaches, so the fight keeps drawing
		// blood and the stalemate give-up never fires. Otherwise this would be testing
		// engage/lands-a-hit rather than target juggling.
		enemies: [{ def: 'ED_BoneHead', x: 0, y: 0, yaw: 0 }],
		players: [
			{ as: 'first', x: 900, y: 0, silent: true },
			{ as: 'closer', x: -2200, y: 0, silent: true },
		],
		script: [
			{ at: 0, alert: { target: 'first' } },
			// The second player walks in much closer and just stands there.
			{ at: 6, who: 'closer', teleport: { x: 300, y: 300 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('the original target is kept', agent.final.target, 'first');
			e.excludes('the closer player never steals it', agent.targetsHeld, 'closer');
		},
	},
	{
		id: 'aggro/damage-steals-the-target',
		title: 'A hard hit from a second player takes the aggro',
		tags: ['aggro', 'targeting'],
		seconds: 30,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [
			{ as: 'first', x: 900, y: 0, silent: true },
			{ as: 'attacker', x: -900, y: 0, silent: true },
		],
		script: [
			{ at: 0, alert: { target: 'first' } },
			// switch_damage is 25; 40 in one hit clears it outright.
			{ at: 8, damage: { to: 'ED_Janitor', from: 'attacker', amount: 40 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('aggro moves to whoever hurt it', agent.at(10).target, 'attacker');
			e.gte('and it stays moved', agent.secondsInRoot('Chase') + agent.secondsInRoot('Combat'), 5);
		},
	},
	{
		id: 'aggro/chip-damage-does-not-steal',
		title: 'Chip damage below the threshold never pulls aggro',
		tags: ['aggro', 'targeting'],
		seconds: 30,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [
			{ as: 'first', x: 900, y: 0, silent: true },
			{ as: 'pest', x: -900, y: 0, silent: true },
		],
		script: [
			{ at: 0, alert: { target: 'first' } },
			// 5 per hit, 3s apart: recentDamage decays on a 2s half-life so it never stacks
			// anywhere near switch_damage 25.
			...[8, 11, 14, 17, 20, 23].map((at) => ({ at, damage: { to: 'ED_Janitor', from: 'pest', amount: 5 } })),
		],
		check: (t, e) => {
			e.eq('the incumbent survives the chip', t.agent().final.target, 'first');
		},
	},
	{
		id: 'aggro/contagion-alerts-nearby-allies',
		title: 'A fresh acquisition alerts allies in radius',
		tags: ['aggro', 'targeting'],
		seconds: 20,
		enemies: [
			{ as: 'spotter', def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true },
			// 1200uu away: inside alert_allies_radius 1500, and facing away so it cannot
			// possibly have seen the player itself.
			{ as: 'ally', def: 'ED_Janitor', x: 0, y: 1200, yaw: 180, frozen: true },
		],
		players: [{ x: 700, y: 0, silent: true }],
		check: (t, e) => {
			const spotter = t.agent('spotter');
			const ally = t.agent('ally');
			e.happenedWithin('the spotter sees the player', spotter.firstTargetTime('player'), 10);
			e.happenedWithin('the ally is told about it', ally.firstTargetTime('player'), 12);
			e.eq('the ally never saw anything itself', ally.peakDetection('player'), 1);
		},
	},
	{
		id: 'aggro/contagion-respects-radius',
		title: 'An ally outside the contagion radius is not alerted',
		tags: ['aggro', 'targeting'],
		seconds: 20,
		bounds: { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 },
		enemies: [
			{ as: 'spotter', def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true },
			// 2200uu: outside alert_allies_radius 1500.
			{ as: 'distant', def: 'ED_Janitor', x: 0, y: 2200, yaw: 180, frozen: true },
		],
		players: [{ x: 700, y: 0, silent: true }],
		check: (t, e) => {
			e.happenedWithin('the spotter sees the player', t.agent('spotter').firstTargetTime('player'), 10);
			e.neverHappened('the distant ally hears nothing', t.agent('distant').firstTargetTime());
		},
	},
	{
		id: 'aggro/stalemate-give-up',
		title: 'A fight where nobody bleeds is abandoned after 8s',
		tags: ['aggro', 'stalemate'],
		seconds: 30,
		// The player is sealed behind unbreakable walls: seen, never reachable, never hit.
		walls: [
			[600, -400, 600, 400],
			[600, 400, 1400, 400],
			[600, -400, 1400, -400],
			[1400, -400, 1400, 400],
		],
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 1000, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			// give_up_seconds 8, measured from the acquisition that starts the bloodshed clock.
			e.ok(
				'the target is dropped once the stalemate clock runs out',
				agent.at(14).target === null,
				`target at 14s: ${agent.at(14).target ?? 'none'}`,
			);
			// resume_seconds 20 keeps it from re-acquiring straight away.
			e.eq('and it does not immediately re-acquire', agent.at(24).target, null);
		},
	},
	{
		id: 'aggro/visible-target-is-not-abandoned',
		title: 'A chase longer than 8 seconds does not end on its own',
		tags: ['aggro', 'stalemate', 'chase'],
		seconds: 25,
		bounds: { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 },
		// Nothing in the way, nothing to hide behind: just a long walk toward a player who is
		// standing in the open, in the enemy's own line of sight, the whole time.
		enemies: [{ def: 'ED_Janitor', x: -2600, y: 0, yaw: 0 }],
		players: [{ x: 2600, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		// FIXED 2026-08-02. TryStalemateGiveUp used to test ONLY
		// `Now - LastBloodshedTime >= GiveUpSeconds`, so any approach longer than the eight
		// seconds every hostile carries — a long aisle, a detour around furniture, a chase up
		// a floor — ended with the enemy walking away from a player it could see. It now needs
		// a SECOND clock to run out as well: no ground gained. See
		// UScpPerceptionComponent::UpdateEngagementProgress and its port.
		check: (t, e) => {
			const agent = t.agent();
			e.eq('still on the player at 12s', agent.at(12).target, 'player');
			e.eq('and at 20s', agent.at(20).target, 'player');
		},
	},
	{
		id: 'aggro/damage-cancels-the-give-up',
		title: 'Being hit keeps the fight alive past the stalemate window',
		tags: ['aggro', 'stalemate'],
		seconds: 30,
		walls: [
			[600, -400, 600, 400],
			[600, 400, 1400, 400],
			[600, -400, 1400, -400],
			[1400, -400, 1400, 400],
		],
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 1000, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// Every hit restamps lastBloodshedTime, so the 8s clock never runs out.
			...[5, 11, 17, 23].map((at) => ({ at, damage: { to: 'ED_Janitor', from: 'player', amount: 8 } })),
		],
		check: (t, e) => {
			e.eq('the target is still held at the end', t.agent().final.target, 'player');
		},
	},
	{
		id: 'aggro/ghost-track-then-freeze',
		title: 'A lost target is chased to its last known position, not through walls',
		tags: ['aggro', 'memory', 'nav'],
		seconds: 30,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: -1400, y: 0, yaw: 0 }],
		players: [{ x: -1400, y: 900, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			// Behind the pillar and then far away: after the 5s ghost-track window the last
			// known position freezes, so the chase must go THERE, not to the player.
			{ at: 4, who: 'player', teleport: { x: 900, y: 0 } },
			{ at: 12, who: 'player', teleport: { x: 2600, y: 2000 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.contains('it gives chase', agent.roots, 'Chase');
			// It walked to where the player WAS, around x≈900.
			e.lt('it reaches the last known position', agent.minDistTo('player'), 600);
			// After the second teleport it must NOT converge on the new position: the ghost
			// track window is 5s and the LKP freezes when it lapses. Searching around the old
			// spot is fine and seed-dependent; closing on the new one would be x-ray vision.
			const afterTeleport = agent.samples.filter((s) => s.t > 14);
			e.gt(
				'it never x-ray-follows the teleport',
				Math.min(...afterTeleport.map((s) => Math.hypot(s.x - 2600, s.y - 2000))),
				1500,
			);
		},
	},

	// --- the combat coordinator -------------------------------------------

	{
		id: 'coord/two-attacker-cap',
		title: 'At most two agents hold an attack token on one player',
		tags: ['combat', 'coordinator'],
		seconds: 30,
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -600, y: -600, yaw: 0 },
			{ as: 'b', def: 'ED_Janitor', x: -600, y: 600, yaw: 0 },
			{ as: 'c', def: 'ED_Janitor', x: -1200, y: -600, yaw: 0 },
			{ as: 'd', def: 'ED_Janitor', x: -1200, y: 600, yaw: 0 },
		],
		players: [{ x: 600, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const peak = peakSimultaneousTokens(['a', 'b', 'c', 'd'], t);
			e.gte('agents do claim tokens', peak, 1);
			// UScpCombatCoordinatorSubsystem::MaxSimultaneousAttackers is 2, cost 1 each.
			e.lte('never more than the cap', peak, 2);
		},
	},
	{
		id: 'coord/token-frees-when-a-holder-dies',
		title: 'A dead token holder releases its slot',
		tags: ['combat', 'coordinator'],
		seconds: 35,
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -400, y: -400, yaw: 0 },
			{ as: 'b', def: 'ED_Janitor', x: -400, y: 400, yaw: 0 },
			{ as: 'c', def: 'ED_Janitor', x: -1200, y: 0, yaw: 0 },
		],
		players: [{ x: 500, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 15, kill: 'a' },
			{ at: 15.1, kill: 'b' },
		],
		check: (t, e) => {
			const third = t.agent('c');
			e.gt('the queued agent eventually gets a token', third.secondsWithToken, 0);
			e.ok(
				'and only after the holders are gone',
				third.samples.some((s) => s.t > 16 && s.hasToken),
				`token seconds: ${third.secondsWithToken.toFixed(1)}`,
			);
		},
	},
	{
		id: 'coord/tokens-are-per-target',
		title: 'Two players carry two independent token pools',
		tags: ['combat', 'coordinator'],
		seconds: 30,
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -800, y: -900, yaw: 0 },
			{ as: 'b', def: 'ED_Janitor', x: -800, y: -600, yaw: 0 },
			{ as: 'c', def: 'ED_Janitor', x: -800, y: 600, yaw: 0 },
			{ as: 'd', def: 'ED_Janitor', x: -800, y: 900, yaw: 0 },
		],
		players: [
			{ as: 'left', x: 500, y: -750, silent: true },
			{ as: 'right', x: 500, y: 750, silent: true },
		],
		script: [
			{ at: 0, alert: { enemy: 'a', target: 'left', radius: 700 } },
			{ at: 0, alert: { enemy: 'c', target: 'right', radius: 700 } },
		],
		check: (t, e) => {
			const peak = peakSimultaneousTokens(['a', 'b', 'c', 'd'], t);
			// Two pools of two: up to four holders at once, which one shared pool could never do.
			e.gte('both pools issue tokens', peak, 3);
			e.lte('and neither exceeds its own cap', peak, 4);
		},
	},
];
