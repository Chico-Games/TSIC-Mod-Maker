// Coverage scenarios: the corners the original suite left open, plus regression armour for
// the stalemate rework of 2026-08-02.
//
// The stalemate group is the reason this file exists. The give-up used to test one clock
// (nobody bleeding), which made a long walk down an aisle indistinguishable from a dead end.
// It now tests two — nobody bleeding AND nobody closing — and "closing" has a deliberate
// exception for an agent that has already arrived and is queued behind the attacker cap.
// That is three interacting rules, and every one of them is a way to get it wrong: give up
// too eagerly and enemies wander off mid-fight; never give up and they lock onto a player
// behind glass forever. Both failure modes are covered below.

import type { ScenarioSpec } from '../types';
import type { AgentTrace, Trace } from '../types';

/** Peak number of the named agents holding a token at the same instant. */
function peakTokens(handles: string[], t: Trace): number {
	const agents = handles.map((h) => t.agent(h));
	const samples = agents[0]?.samples.length ?? 0;
	let peak = 0;
	for (let index = 0; index < samples; index += 1) {
		peak = Math.max(peak, agents.filter((a) => a.samples[index]?.hasToken).length);
	}
	return peak;
}

/** Seconds the agent held ANY target, summed over the trace. */
function secondsWithTarget(agent: AgentTrace): number {
	const step = agent.samples.length > 1 ? agent.samples[1].t - agent.samples[0].t : 0;
	return agent.samples.filter((s) => s.target !== null).length * step;
}

export const coverageScenarios: ScenarioSpec[] = [
	// =====================================================================
	// Stalemate — the two-clock give-up
	// =====================================================================
	{
		id: 'stalemate/queued-attacker-keeps-its-target',
		title: 'The third enemy in a pack does not wander off while waiting its turn',
		tags: ['aggro', 'stalemate', 'coordinator'],
		seconds: 30,
		// Only two attack tokens exist, so the third agent crowds the player, draws no blood
		// and gains no ground. Under a bloodshed-only give-up it forgets the player after 8s
		// and strolls away mid-fight — with the player standing right in front of it.
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -300, y: -300, yaw: 0 },
			{ as: 'b', def: 'ED_Janitor', x: -300, y: 300, yaw: 0 },
			{ as: 'c', def: 'ED_Janitor', x: -450, y: 0, yaw: 0 },
		],
		players: [{ x: 400, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const queued = t.agent('c');
			e.eq('the queued agent still has the player at 20s', queued.targetAt(20), 'player');
			e.ok(
				'and never let go in between',
				queued.heldTargetFor('player', 18),
				`held for ${secondsWithTarget(queued).toFixed(1)}s`,
			);
			e.lte('at most two hold a token at once', peakTokens(['a', 'b', 'c'], t), 2);
		},
	},
	{
		id: 'stalemate/sealed-player-is-still-abandoned',
		title: 'A player behind walls the enemy can never reach is eventually dropped',
		tags: ['aggro', 'stalemate', 'nav'],
		seconds: 30,
		// The other half of the rework: making the give-up harder to trigger must not make it
		// impossible. Nothing closes, nothing bleeds, and the enemy is nowhere near contact —
		// this is what the stalemate rule is FOR.
		enemies: [{ def: 'ED_Janitor', x: -1200, y: 0, yaw: 0 }],
		players: [{ x: 1400, y: 0, silent: true }],
		walls: [
			[900, -2200, 900, -80],
			[900, 80, 900, 2200],
			[900, -2200, 2400, -2200],
			[900, 2200, 2400, 2200],
			[2400, -2200, 2400, 2200],
		],
		furniture: [{ as: 'plug', x: 900, y: 0, halfExtent: 90, breakable: false, blocksSight: false }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('the unreachable target is dropped', agent.targetAt(26), null);
		},
	},
	{
		id: 'stalemate/a-slow-approach-is-never-a-stalemate',
		title: 'A twenty-second walk across a room keeps its target the whole way',
		tags: ['aggro', 'stalemate', 'chase'],
		seconds: 35,
		// The HeavyStaff is the slowest enemy in the roster, so this crossing takes far longer
		// than give_up_seconds. Progress is the only thing keeping the engagement alive.
		enemies: [{ def: 'ED_HeavyStaff', x: -2600, y: -1800, yaw: 0 }],
		players: [{ x: 2600, y: 1800, silent: true, health: 100000 }],
		bounds: { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 },
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			e.ok(
				'never lets go during the crossing',
				agent.heldTargetFor('player', 25),
				`target at 10/20/30s: ${agent.targetAt(10)}/${agent.targetAt(20)}/${agent.targetAt(30)}`,
			);
			e.gt('and actually covered ground', agent.distanceTravelled, 1500);
		},
	},
	{
		id: 'stalemate/resume-window-blocks-reacquisition',
		title: 'After giving up, the same player is ignored for resume_seconds',
		tags: ['aggro', 'stalemate'],
		seconds: 30,
		// resume_seconds is 20. Having walked away, seeing the same player again is not new
		// information — otherwise the agent re-acquires on its very next update and the
		// give-up accomplishes nothing.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 700, y: 0, silent: true }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			const gaveUp = agent.samples.find((s) => s.t > 5 && s.target === null)?.t ?? null;
			e.happenedWithin('gives up on the frozen stand-off', gaveUp, 16);
			if (gaveUp !== null) {
				e.eq(
					'and does not re-acquire inside the resume window',
					agent.targetAt(Math.min(gaveUp + 12, 29)),
					null,
				);
			}
		},
	},
	{
		id: 'stalemate/damage-reopens-a-give-up-window',
		title: 'Hitting an enemy that walked away brings it straight back',
		tags: ['aggro', 'stalemate', 'damage'],
		seconds: 35,
		// The give-up is conditional on being left alone. NotifyDamage erases the window for
		// that attacker specifically, so a hit inside resume_seconds re-aggros immediately.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 700, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 20, damage: { to: 'ED_Janitor', from: 'player', amount: 20 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('back on the player right after the hit', agent.targetAt(21), 'player');
		},
	},

	// =====================================================================
	// Coordinator
	// =====================================================================
	{
		id: 'coord/token-cost-two-fills-the-pool',
		title: 'One HeavyStaff consumes both attacker slots',
		tags: ['combat', 'coordinator', 'content'],
		seconds: 30,
		// ED_HeavyStaff ships token_cost 2 against MaxSimultaneousAttackers 2, which is the
		// whole point: a HeavyStaff fights you alone.
		enemies: [
			{ as: 'a', def: 'ED_HeavyStaff', x: -400, y: -250, yaw: 0 },
			{ as: 'b', def: 'ED_HeavyStaff', x: -400, y: 250, yaw: 0 },
		],
		players: [{ x: 500, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			e.eq('only ever one HeavyStaff holds a token', peakTokens(['a', 'b'], t), 1);
		},
	},
	{
		id: 'coord/four-enemies-still-cap-at-two',
		title: 'The cap holds however many enemies pile on',
		tags: ['combat', 'coordinator'],
		seconds: 30,
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -400, y: -400, yaw: 0 },
			{ as: 'b', def: 'ED_Janitor', x: -400, y: 400, yaw: 0 },
			{ as: 'c', def: 'ED_Janitor', x: -600, y: -200, yaw: 0 },
			{ as: 'd', def: 'ED_Janitor', x: -600, y: 200, yaw: 0 },
		],
		players: [{ x: 500, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			e.lte('never more than two attackers', peakTokens(['a', 'b', 'c', 'd'], t), 2);
			e.gte('but the pool is actually being used', peakTokens(['a', 'b', 'c', 'd'], t), 2);
		},
	},
	{
		id: 'coord/queued-agents-still-crowd-the-player',
		title: 'Tokenless attackers close in rather than hanging back',
		tags: ['combat', 'coordinator', 'chase'],
		seconds: 30,
		// A refused token must not stop the approach: SKL_Engage's CloseIn keeps running, so
		// the extras stack up around the player waiting for a slot.
		enemies: [
			{ as: 'a', def: 'ED_Janitor', x: -700, y: -400, yaw: 0 },
			{ as: 'b', def: 'ED_Janitor', x: -700, y: 400, yaw: 0 },
			{ as: 'c', def: 'ED_Janitor', x: -900, y: 0, yaw: 0 },
		],
		players: [{ x: 500, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			e.lt('the queued third agent still reaches the player', t.agent('c').minDistTo('player'), 260);
		},
	},

	// =====================================================================
	// Targeting
	// =====================================================================
	{
		id: 'targeting/dead-target-is-dropped',
		title: 'Killing the held target clears it rather than leaving a corpse latched',
		tags: ['aggro', 'targeting'],
		seconds: 20,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [{ x: 500, y: 0, silent: true }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 6, kill: 'player' },
		],
		check: (t, e) => {
			e.eq('target cleared after the kill', t.agent().targetAt(10), null);
		},
	},
	{
		id: 'targeting/steal-needs-more-than-the-incumbent',
		title: 'A second attacker must out-damage the first by half again to take the aggro',
		tags: ['aggro', 'targeting'],
		seconds: 25,
		// The steal threshold is max(switch_damage, incumbentRecent x 1.5), and `recentDamage`
		// decays on a 2s half-life — so the two hits have to land close together or the
		// incumbent's contribution has already halved and a MATCHING hit wins on decay alone
		// rather than on the ratio. 0.2s apart keeps the ratio the only thing under test.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [
			{ as: 'first', x: 400, y: -200, silent: true },
			{ as: 'second', x: 400, y: 200, silent: true },
		],
		script: [
			{ at: 1, damage: { to: 'ED_Janitor', from: 'first', amount: 60 } },
			{ at: 1.2, damage: { to: 'ED_Janitor', from: 'second', amount: 70 } },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('the incumbent keeps the aggro against an equal hit', agent.targetAt(5), 'first');
		},
	},
	{
		id: 'targeting/a-much-harder-hit-does-steal',
		title: 'A hit well over the ratio pulls the aggro across',
		tags: ['aggro', 'targeting'],
		seconds: 25,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [
			{ as: 'first', x: 400, y: -200, silent: true },
			{ as: 'second', x: 400, y: 200, silent: true },
		],
		script: [
			{ at: 1, damage: { to: 'ED_Janitor', from: 'first', amount: 30 } },
			{ at: 3, damage: { to: 'ED_Janitor', from: 'second', amount: 200 } },
		],
		check: (t, e) => {
			e.eq('the harder hitter takes the aggro', t.agent().targetAt(5), 'second');
		},
	},
	{
		id: 'targeting/sight-record-cap-keeps-the-target',
		title: 'A crowd never evicts the held target from the sight list',
		tags: ['perception', 'targeting', 'robustness'],
		seconds: 25,
		// The sight list holds four records. Eviction picks the stalest NON-target record
		// precisely so a busy room cannot make an enemy forget who it is fighting — but the
		// protection is on the HELD target, so the crowd has to arrive after acquisition.
		// (Five visible strangers at t=0 is a different question, and the answer there is
		// "whichever the priority rules pick", not "the one you alerted it to".)
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [
			{ as: 'held', x: 500, y: 0, silent: true },
			{ as: 'p2', x: 2900, y: 2100, silent: true },
			{ as: 'p3', x: 2900, y: -2100, silent: true },
			{ as: 'p4', x: -2900, y: 2100, silent: true },
			{ as: 'p5', x: -2900, y: -2100, silent: true },
		],
		script: [
			{ at: 0, alert: { target: 'held' } },
			{ at: 3, who: 'p2', teleport: { x: 600, y: 150 } },
			{ at: 3, who: 'p3', teleport: { x: 600, y: -150 } },
			{ at: 3, who: 'p4', teleport: { x: 700, y: 300 } },
			{ at: 3, who: 'p5', teleport: { x: 700, y: -300 } },
		],
		check: (t, e) => {
			// Sampled before the stalemate clock can end this engagement on its own: a frozen
			// agent gains no ground, so past ~8s the give-up legitimately drops the target and
			// the question stops being about the record cap.
			e.eq('still holds the original target in a crowd', t.agent().targetAt(6), 'held');
		},
	},

	// =====================================================================
	// Abilities
	// =====================================================================
	{
		id: 'abilities/cooldown-paces-the-swings',
		title: 'A cooldown ability cannot fire back to back',
		tags: ['combat', 'abilities'],
		seconds: 40,
		// The Janitor's melee carries a 1.75s cooldown on top of a 2.6s montage, so swings can
		// never land closer together than the montage itself.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 300, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const attacks = t.agent().attacks;
			let tightest = Infinity;
			for (let index = 1; index < attacks.length; index += 1) {
				tightest = Math.min(tightest, attacks[index].t - attacks[index - 1].t);
			}
			e.ok(
				'swings are spaced by at least the montage length',
				attacks.length < 2 || tightest >= 2,
				`${attacks.length} swings, tightest gap ${Number.isFinite(tightest) ? tightest.toFixed(2) : 'n/a'}s`,
			);
		},
	},
	{
		id: 'abilities/dead-abilities-are-recognisable',
		title: 'Every no-op montage an enemy spends is recorded as a dead attack',
		tags: ['combat', 'abilities', 'content'],
		seconds: 40,
		// Not an assertion about whether the Janitor SHOULD have dead acid attacks — that is
		// engage/no-op-abilities-outrank-the-working-one's job. This one guards the harness:
		// if the dead-attack bookkeeping breaks, several content findings go quiet at once.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 300, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const attacks = t.agent().attacks;
			e.gt('the Janitor attacked at all', attacks.length, 0);
			e.ok(
				'and every swing carries a live/dead verdict',
				attacks.every((a) => typeof a.dead === 'boolean'),
				`${attacks.filter((a) => a.dead).length}/${attacks.length} were no-ops`,
			);
		},
	},

	// =====================================================================
	// Navigation
	// =====================================================================
	{
		id: 'nav/breach-and-blocking-policies-differ',
		title: 'The same furniture is smashed while chasing and routed around while patrolling',
		tags: ['nav', 'furniture'],
		// Demolition is slow: ~200hp at ~12 a swing through 3s montages. The old 45s budget
		// was shorter than the job, exactly like nav/blocker-smash-narrow's was.
		seconds: 100,
		// Nav policy rides the ROOT: aggro roots breach, everything else treats furniture as
		// blocking. Two agents, identical geometry, one aggroed and one not.
		enemies: [
			{ as: 'chaser', def: 'ED_BoneHead', x: -700, y: 0, yaw: 0 },
			{ as: 'idler', def: 'ED_BoneHead', x: -700, y: 1400, yaw: 0, paused: false },
		],
		players: [{ x: 900, y: 0, silent: true, health: 100000 }],
		furniture: [{ as: 'blocker', x: 100, y: 0, halfExtent: 70 }],
		walls: [
			[100, -2200, 100, -70],
			[100, 70, 100, 2200],
		],
		script: [{ at: 0, alert: { enemy: 'chaser', target: 'player', radius: 200 } }],
		// FIXED 2026-08-02. Two causes, both this port's: the smash could never land (ability
		// range is the surface-to-surface GAP, not centre distance), and the chaser gave up
		// from across the room because an unreachable goal FAILED the move outright instead of
		// walking as far as it could — the C++ sets SetAllowPartialPath(true), so the pawn
		// reaches the blocker and only then escalates to PathBlocked.
		check: (t, e) => {
			e.gt('the chaser damages the blocker in its way', t.agent('chaser').damageDealtTo('blocker'), 0);
		},
	},
	{
		id: 'nav/pinned-on-an-unbreakable-does-not-live-lock',
		title: 'An enemy pinned against furniture it cannot break stops pushing',
		tags: ['nav', 'furniture', 'robustness'],
		seconds: 40,
		// The move node escalates a physical stall to PathBlocked, and PathBlocked over
		// something non-damageable is deliberately not reported. With no actionable blocker
		// the move must FAIL into the authored escalation rather than shove the wall forever.
		enemies: [{ def: 'ED_Janitor', x: -600, y: 0, yaw: 0 }],
		players: [{ x: 900, y: 0, silent: true }],
		furniture: [{ as: 'wall', x: 100, y: 0, halfExtent: 120, breakable: false, blocksSight: false }],
		walls: [
			[100, -2200, 100, -120],
			[100, 120, 100, 2200],
		],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('never damages the unbreakable blocker', agent.damageDealtTo('wall'), 0);
			e.gt('and keeps thinking rather than wedging', agent.roots.length, 0);
		},
	},
	{
		id: 'nav/wander-survives-a-hopeless-ring',
		title: 'Wander with nowhere to go keeps trying instead of failing the root',
		tags: ['nav', 'idle', 'robustness'],
		seconds: 40,
		// wander NEVER fails in the C++: a bad pick idles briefly and retries, and after two
		// consecutive misses the ring falls back to the agent's own position. Boxing the agent
		// into a tiny cell makes every ring pick unreachable.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2800, y: 2000, silent: true }],
		walls: [
			[-250, -250, 250, -250],
			[250, -250, 250, 250],
			[250, 250, -250, 250],
			[-250, 250, -250, -250],
		],
		check: (t, e) => {
			const agent = t.agent();
			e.ok(
				'the idle root is never abandoned',
				agent.roots.length > 0,
				`roots seen: ${agent.roots.join(',') || 'none'}`,
			);
			e.eq('and no target is invented', agent.targetAt(30), null);
		},
	},

	// =====================================================================
	// Multi-agent robustness
	// =====================================================================
	{
		id: 'pack/contagion-chains-outward',
		title: 'An alert relayed by an alerted ally reaches a third enemy',
		tags: ['aggro', 'targeting', 'pack'],
		seconds: 30,
		// Contagion is per-acquisition, not per-broadcast: the ally that gets alerted makes its
		// own fresh acquisition, which alerts ITS neighbours. Spacing the three at 1200uu with
		// a 1500uu radius means only the chain can reach the far one.
		enemies: [
			{ as: 'near', def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true },
			{ as: 'middle', def: 'ED_Janitor', x: -1200, y: 0, yaw: 0, frozen: true },
			{ as: 'far', def: 'ED_Janitor', x: -2400, y: 0, yaw: 0, frozen: true },
		],
		players: [{ x: 600, y: 0, silent: true }],
		script: [{ at: 1, alert: { enemy: 'near', target: 'player', radius: 1500 } }],
		check: (t, e) => {
			e.happenedWithin('the middle enemy is alerted', t.agent('middle').firstTargetTime('player'), 8);
			e.happenedWithin('and the chain reaches the far one', t.agent('far').firstTargetTime('player'), 20);
		},
	},
	{
		id: 'robustness/enemy-between-two-players',
		title: 'One enemy with two live players holds exactly one of them',
		tags: ['aggro', 'targeting', 'robustness'],
		seconds: 30,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
		players: [
			{ as: 'left', x: 500, y: -350, silent: true },
			{ as: 'right', x: 500, y: 350, silent: true },
		],
		check: (t, e) => {
			// The invariant worth asserting is the give-up window, not the switch itself: a
			// stalemate give-up drops one player and re-acquires the other in the SAME
			// UpdateTarget pass (the drop falls straight through to the acquire loop), which
			// is correct — it walked away from one and noticed another. What must never happen
			// is coming back to the abandoned player inside resume_seconds.
			const samples = t.agent().samples;
			const abandonedAt = new Map<string, number>();
			let previous: string | null = null;
			let tooSoon = 0;
			for (const sample of samples) {
				if (previous && sample.target !== previous) abandonedAt.set(previous, sample.t);
				const returned = sample.target ? abandonedAt.get(sample.target) : undefined;
				if (returned !== undefined && sample.t - returned < 20) tooSoon += 1;
				previous = sample.target;
			}
			e.eq('never returns to an abandoned player inside resume_seconds', tooSoon, 0);
			e.lte('and holds at most the two players over the whole run', t.agent().targetsHeld.length, 2);
		},
	},
	{
		id: 'robustness/target-removed-mid-fight',
		title: 'A target that despawns mid-swing does not strand the agent',
		tags: ['aggro', 'robustness'],
		seconds: 25,
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 400, y: 0, silent: true, health: 100000 }],
		script: [
			{ at: 0, alert: { target: 'player' } },
			{ at: 10, remove: 'player' },
		],
		check: (t, e) => {
			const agent = t.agent();
			e.eq('the target is cleared', agent.targetAt(15), null);
			e.gt('and the machine keeps selecting roots', agent.roots.length, 1);
		},
	},
	// =====================================================================
	// Behaviour machine — general robustness
	//
	// NOT armour for the same-tick self-retry guard, though they were written reaching for it.
	// Verified by experiment: unbounding the deferral leaves both of these PASSING, because
	// this port never reaches the deferral path — its moves effectively cannot fail on Enter
	// now that findPath returns a partial route. The guard is real (it fixed BoneHead losing
	// its target every live run) but it is **verifiable only in-game**, by
	// AiApproachParityTest: `transition budget exhausted` went from 2 distinct cycles per run
	// to zero. Do not trust these two to catch a regression in it.
	// =====================================================================
	{
		id: 'machine/self-retry-does-not-kill-the-frame',
		title: 'A routine engagement never fails its root to an authored self-retry',
		tags: ['machine', 'robustness', 'combat'],
		seconds: 45,
		// What this DOES check: a plain fight produces no root failures and no target thrash.
		// A root failure mid-engagement is how the self-retry live-lock surfaced in-game, so
		// this would catch a gross regression — it just cannot reproduce the live-lock itself.
		enemies: [{ def: 'ED_BoneHead', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 1200, y: 0, silent: true, health: 100000 }],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const rootFailures = t.events.filter((v) => v.kind === 'fail' && v.text.startsWith('root FAILED'));
			e.eq('no root failed during an ordinary fight', rootFailures.length, 0);
			e.ok(
				'and it stayed in the fight',
				t.agent().heldTargetFor('player', 30),
				`roots: ${t.agent().roots.join(',')}`,
			);
		},
	},
	{
		id: 'machine/persistent-failure-still-escalates',
		title: 'An agent that genuinely cannot proceed still hands the root over',
		tags: ['machine', 'robustness', 'nav'],
		seconds: 40,
		// What this DOES check: an agent with nowhere to go still cycles roots and lets its
		// target go, rather than wedging. The related guard bound — deferring a same-tick retry
		// must not become "retry forever", which in-game turned a frame-killing spin into an
		// agent that never moved at all — is NOT exercised here; see the note above.
		enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0 }],
		players: [{ x: 2600, y: 2000, silent: true }],
		// Boxed in with no way out and no breakable blocker to report.
		walls: [
			[-260, -260, 260, -260],
			[260, -260, 260, 260],
			[260, 260, -260, 260],
			[-260, 260, -260, -260],
		],
		script: [{ at: 0, alert: { target: 'player' } }],
		check: (t, e) => {
			const agent = t.agent();
			e.gt('it keeps selecting roots rather than wedging', agent.roots.length, 1);
			e.eq('and does not still believe it is chasing at the end', agent.targetAt(38), null);
		},
	},
];
