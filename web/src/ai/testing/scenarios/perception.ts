// Perception scenarios: what an enemy can and cannot sense, and how long it takes.
//
// The sensor is FROZEN in nearly all of these. An unfrozen enemy patrols, and a patrolling
// enemy turns, so "never spots the player" would really be asserting which way the wander
// happened to point it. Freezing removes that and leaves the sight/hearing/damage model as
// the only variable.
//
// Timing budgets come from the shipped PRC_BaseHostile numbers: sight range 2500 (night
// 3500), cone 70°, peripheral 160°/900uu at 0.4 gain, time_to_spot 1.5s, auto-detect 150uu,
// still-motion 0.6× and sprint 1.5×. Fill per second = distanceFalloff × coneGain ×
// stealth × motion, so a still player at 800uu fills at ~0.41/s and spots in ~3.7s.

import type { ScenarioSpec } from '../types';

export const perceptionScenarios: ScenarioSpec[] = [
	{
		id: 'sight/frontal-still',
		title: 'A still player straight ahead is spotted in a few seconds',
		tags: ['perception', 'sight'],
		seconds: 12,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 800, y: 0, silent: true }],
		check: (t, e) => {
			const janitor = t.agent();
			e.happenedWithin('acquires the player', janitor.firstTargetTime('player'), 8);
			e.gte('detection fills to spotted', janitor.peakDetection('player'), 1);
			// ~3.7s by the model; anything under 2s would mean the still-motion penalty is gone.
			e.gte('the still-motion penalty is applied', janitor.firstTargetTime('player'), 2);
		},
	},
	{
		id: 'sight/moving-spots-faster',
		title: 'A sprinting player is spotted faster than a still one',
		tags: ['perception', 'sight'],
		seconds: 12,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 800, y: -600, silent: true }],
		script: [{ at: 0, move: 'player', to: { x: 800, y: 600 } }],
		check: (t, e) => {
			// Motion 1.0 lifts the multiplier from 0.6 to 1.5 — the same geometry, 2.5x faster.
			e.happenedWithin('a moving player is spotted quickly', t.agent().firstTargetTime('player'), 4);
		},
	},
	{
		id: 'sight/behind-blind-spot',
		title: 'A still, silent player directly behind is never seen',
		tags: ['perception', 'sight'],
		seconds: 20,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: -900, y: 0, silent: true }],
		check: (t, e) => {
			// 180° is outside the 160° peripheral cone, and 900uu is outside auto-detect.
			e.neverHappened('never acquires a target', t.agent().firstTargetTime());
			e.eq('no detection progress at all', t.agent().peakDetection('player'), 0);
		},
	},
	{
		id: 'sight/peripheral-is-slower',
		title: 'A player in the peripheral cone is spotted, but slowly',
		tags: ['perception', 'sight'],
		seconds: 30,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		// 50° off-axis at 400uu: outside the 70° primary cone, inside the 160° peripheral one.
		players: [{ x: 257, y: 306, silent: true }],
		check: (t, e) => {
			const janitor = t.agent();
			e.happenedWithin('peripheral vision still acquires', janitor.firstTargetTime('player'), 25);
			e.gte('but takes far longer than the primary cone', janitor.firstTargetTime('player'), 4);
		},
	},
	{
		id: 'sight/out-of-range',
		title: 'Beyond daytime sight range nothing is seen',
		tags: ['perception', 'sight'],
		seconds: 20,
		bounds: { minX: -4000, minY: -2200, maxX: 4000, maxY: 2200 },
		enemies: [{ def: 'ED_Janitor', x: -1000, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 2000, y: 0, silent: true }],
		check: (t, e) => {
			e.neverHappened('3000uu is outside the 2500uu day range', t.agent().firstTargetTime());
		},
	},
	{
		id: 'sight/night-range-extends',
		title: 'At night the same 3000uu contact is visible',
		tags: ['perception', 'sight', 'daynight'],
		seconds: 45,
		daySection: 'Gameplay.DaySection.Night',
		bounds: { minX: -4000, minY: -2200, maxX: 4000, maxY: 2200 },
		enemies: [{ def: 'ED_Janitor', x: -1000, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 2000, y: 0, silent: true }],
		check: (t, e) => {
			// Night overlay: range 2500 -> 3500 and time_to_spot 1.5 -> 0.9.
			e.happenedWithin('the night overlay opens the range', t.agent().firstTargetTime('player'), 40);
		},
	},
	{
		id: 'sight/auto-detect-radius',
		title: 'Standing on top of an enemy is spotted instantly, even from behind',
		tags: ['perception', 'sight'],
		seconds: 6,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: -120, y: 0, silent: true }],
		check: (t, e) => {
			// auto_detect_radius 150 bypasses the cone entirely.
			e.happenedWithin('proximity spots with no ramp', t.agent().firstTargetTime('player'), 1.5);
		},
	},
	{
		id: 'sight/stealth-slows-spotting',
		title: 'Stealth cuts both the spot rate and the range',
		tags: ['perception', 'sight', 'stealth'],
		seconds: 30,
		enemies: [
			{ as: 'watcher', def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true },
			{ as: 'control', def: 'ED_Janitor', x: 0, y: 1600, yaw: 0, frozen: true },
		],
		players: [
			{ as: 'sneak', x: 800, y: 0, silent: true, stealthed: true },
			{ as: 'loud', x: 800, y: 1600, silent: true },
		],
		check: (t, e) => {
			const sneakSeen = t.agent('watcher').firstTargetTime('sneak');
			const loudSeen = t.agent('control').firstTargetTime('loud');
			e.happenedWithin('the control player is spotted normally', loudSeen, 8);
			e.ok(
				'the stealthed player takes markedly longer',
				sneakSeen === null || (loudSeen !== null && sneakSeen > loudSeen * 2),
				`stealth ${sneakSeen ?? 'never'} vs control ${loudSeen}`,
			);
		},
	},
	{
		id: 'sight/wall-occludes',
		title: 'A wall between the two blocks sight completely',
		tags: ['perception', 'sight', 'nav'],
		seconds: 20,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: -1000, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 1000, y: 0, silent: true }],
		check: (t, e) => {
			e.neverHappened('the pillar blocks the sight trace', t.agent().firstTargetTime());
		},
	},
	{
		id: 'sight/memory-survives-los-break',
		title: 'Breaking line of sight does not drop the target',
		tags: ['perception', 'memory'],
		seconds: 12,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: -1200, y: 0, yaw: 0, frozen: true }],
		// Dead ahead and short of the pillar, so the sighting completes cleanly.
		players: [{ x: -500, y: 0, silent: true }],
		script: [
			// Seen in the open first, then parked behind the pillar.
			{ at: 5, who: 'player', teleport: { x: 1200, y: 0 } },
		],
		check: (t, e) => {
			const janitor = t.agent();
			e.happenedWithin('spots the player in the open', janitor.firstTargetTime('player'), 6);
			// sight.memory_seconds is 30. This only checks 4s of it, because the 8s stalemate
			// give-up clock cuts the window off long before the memory does — see
			// aggro/visible-target-is-not-abandoned.
			e.eq('still holds the target after losing sight', janitor.at(9).target, 'player');
			e.gt('and the sight record is remembered, not forgotten', janitor.at(9).detection.player ?? 0, 0.9);
		},
	},
	{
		id: 'sight/glimpse-decays',
		title: 'A glimpse that never completes decays back to nothing',
		tags: ['perception', 'memory'],
		seconds: 25,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: -1200, y: 0, yaw: 0, frozen: true }],
		players: [{ x: -500, y: 0, silent: true }],
		script: [
			// A second of exposure, well short of the ~3s a full spot needs at this range.
			{ at: 1, who: 'player', teleport: { x: 1200, y: 0 } },
		],
		check: (t, e) => {
			const janitor = t.agent();
			e.neverHappened('a partial glimpse never becomes a target', janitor.firstTargetTime());
			e.lt('and the progress decays away', janitor.final.detection.player ?? 0, 0.05);
		},
	},

	// --- hearing -----------------------------------------------------------

	{
		id: 'hearing/noise-triggers-investigate',
		title: 'A noise in earshot sends the enemy to investigate',
		tags: ['perception', 'hearing'],
		seconds: 20,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2600, y: 2000, silent: true }],
		script: [{ at: 1, noise: { at: { x: 1200, y: 0 }, loudness: 1, range: 2500 } }],
		check: (t, e) => {
			const janitor = t.agent();
			e.happenedWithin('Investigate wins the root selection', janitor.firstRootTime('Investigate'), 3);
			// Where it ends up wandering afterwards is seed-dependent; what matters is that it
			// went to the sound at all.
			const toNoise = janitor.samples.map((s) => Math.hypot(s.x - 1200, s.y));
			e.lt('and it actually walks to the sound', Math.min(...toNoise), 500);
		},
	},
	{
		id: 'hearing/out-of-earshot',
		title: 'A noise outside its range is not heard',
		tags: ['perception', 'hearing'],
		seconds: 12,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2600, y: 2000, silent: true }],
		script: [{ at: 1, noise: { at: { x: 2800, y: 0 }, loudness: 1, range: 1500 } }],
		check: (t, e) => {
			e.excludes('never investigates', t.agent().roots, 'Investigate');
		},
	},
	{
		id: 'hearing/footsteps-through-a-wall',
		title: 'Footsteps behind a wall are heard even though nothing is seen',
		tags: ['perception', 'hearing'],
		seconds: 20,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: -900, y: 0, yaw: 180, frozen: true }],
		players: [{ x: 900, y: -700 }],
		script: [{ at: 0.5, move: 'player', to: { x: 900, y: 700 } }],
		check: (t, e) => {
			const janitor = t.agent();
			e.contains('hearing fires where sight cannot', janitor.roots, 'Investigate');
			e.neverHappened('but hearing never hands over an identity', janitor.firstTargetTime());
		},
	},
	{
		id: 'hearing/crouch-is-quiet',
		title: 'Crouch-walking does not raise an investigation',
		tags: ['perception', 'hearing', 'stealth'],
		seconds: 20,
		arena: 'pillar',
		enemies: [{ def: 'ED_Janitor', x: -2400, y: 0, yaw: 180, frozen: true }],
		players: [{ x: 900, y: -700, crouched: true }],
		script: [{ at: 0.5, move: 'player', to: { x: 900, y: 700 } }],
		check: (t, e) => {
			// 0.35x noise baseline and 45% speed: the emission never reaches this far.
			e.excludes('crouching stays under the radar', t.agent().roots, 'Investigate');
		},
	},

	// --- damage ------------------------------------------------------------

	{
		id: 'damage/hit-from-behind-aggros',
		title: 'Being hit from an unseen angle aggros instantly',
		tags: ['perception', 'damage', 'aggro'],
		seconds: 12,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: -900, y: 0, silent: true }],
		script: [{ at: 2, damage: { to: 'ED_Janitor', from: 'player', amount: 20 } }],
		check: (t, e) => {
			const janitor = t.agent();
			e.happenedWithin('pain spots the attacker with no ramp', janitor.firstTargetTime('player'), 2.3);
			e.gte('and the sighting is a full fix, not a glimpse', janitor.peakDetection('player'), 1);
		},
	},
	{
		id: 'damage/unattributed-damage-investigates',
		title: 'Damage with no instigator raises a local noise, not a target',
		tags: ['perception', 'damage'],
		seconds: 15,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2600, y: 2000, silent: true }],
		script: [{ at: 1, damage: { to: 'ED_Janitor', amount: 15 } }],
		check: (t, e) => {
			const janitor = t.agent();
			e.contains('it investigates its own position', janitor.roots, 'Investigate');
			e.neverHappened('with nobody to blame', janitor.firstTargetTime());
		},
	},
];
