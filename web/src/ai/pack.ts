// Definition-pack resolution — mirrors UScpPerceptionDefinition::Resolve and
// FScpBehaviorGraphCompiler, so the sim reads exactly what the game reads.

import type {
	CompiledAction, CompiledTransition, CompiledBehavior, CompiledCondition, CompiledRootEntry, CompiledSkill,
	CompiledState, DefJson, ResolvedProfile,
} from './types';

const PERCEPTION_DEFAULTS = {
	update_interval: { near: 0.1, mid: 0.25, far: 0.75 },
	sight: {
		cone_angle: 70,
		range: 2500,
		peripheral_cone_angle: 160,
		peripheral_range: 900,
		peripheral_gain: 0.4,
		auto_detect_radius: 150,
		time_to_spot: 1.5,
		time_to_forget_glimpse: 4,
		memory_seconds: 30,
		ghost_track_seconds: 5,
		stealth: { spot_multiplier: 0.35, range_multiplier: 0.6 },
		motion: { still: 0.6, sprint: 1.5 },
	},
	hearing: { acuity: 1, occlusion_attenuation: 0.5, noise_lifetime: 8 },
	damage: { total_halflife: 7, recent_window: 2 },
	observed: { enabled: false, range: 8000, fov_margin: 5 },
	stalemate: { give_up_seconds: 0, resume_seconds: 20, search_near_spawn: true },
	targeting: {
		target_priority: ['strongest_attacker', 'closest_spotted'],
		switch_damage: 25,
		alert_allies_radius: 1500,
		patrol_return_distance: 6000,
	},
};

const PRIORITY_RULES = new Set([
	'strongest_attacker',
	'closest_spotted',
	'closest_visible',
	'first_spotted',
]);

function deepMerge(base: any, over: any): any {
	if (over === null || over === undefined) return structuredClone(base);
	if (Array.isArray(base) || Array.isArray(over) || typeof over !== 'object') {
		return structuredClone(over);
	}
	const out = structuredClone(base);
	for (const [k, v] of Object.entries(over)) {
		out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
	}
	return out;
}

/**
 * Flatten a PRC_ chain: defaults <- extends chain (root first) <- the definition itself.
 * `abstract` profiles are only ever bases.
 */
export function resolvePerception(
	packPerception: Record<string, DefJson>,
	id: string,
	daySection: string | null = null,
): ResolvedProfile {
	const chain: DefJson[] = [];
	let cursor: string | undefined = id;
	const guard = new Set<string>();
	while (cursor && packPerception[cursor] && !guard.has(cursor)) {
		guard.add(cursor);
		chain.unshift(packPerception[cursor]);
		cursor = packPerception[cursor].properties?.extends;
	}

	let merged: any = structuredClone(PERCEPTION_DEFAULTS);
	const daySectionOverrides: Record<string, any> = {};
	for (const def of chain) {
		const props = structuredClone(def.properties || {});
		delete props.extends;
		delete props.abstract;
		if (props.day_section_overrides) {
			Object.assign(daySectionOverrides, props.day_section_overrides);
			delete props.day_section_overrides;
		}
		merged = deepMerge(merged, props);
	}

	// Exactly one day-section override merges in — the component holds one resolved profile.
	if (daySection && daySectionOverrides[daySection]) {
		merged = deepMerge(merged, daySectionOverrides[daySection]);
	}

	const rules = (merged.targeting.target_priority || []).filter((r: string) => PRIORITY_RULES.has(r));
	merged.compiledPriority = rules;
	merged.daySectionOverrides = daySectionOverrides;
	merged.sourceChain = chain.map((d: DefJson) => d.id);
	merged.activeDaySection = daySection;
	return merged as ResolvedProfile;
}

/** Day sections a PRC_ chain actually overrides — drives the day/night selector. */
export function daySectionsFor(packPerception: Record<string, DefJson>, id: string): string[] {
	const resolved = resolvePerception(packPerception, id, null);
	return Object.keys(resolved.daySectionOverrides || {});
}

// ---------------------------------------------------------------------------
// Behavior compile
// ---------------------------------------------------------------------------

/**
 * Compile a BHV_ definition into root entries + a flat state table.
 *
 * Mirrors the two rules that decide runtime behaviour and are easy to get wrong:
 *  - Repeating a root NAME creates an ALIAS entry: same state, different when-list. It does
 *    not re-author the state and does not restart it.
 *  - A root's PRIORITY is the list position of its FIRST entry, so aliases inherit it.
 *    Lower index = higher priority; a higher-priority root preempts a hold window.
 */
export function compileBehavior(def: DefJson, skills: Record<string, DefJson>): CompiledBehavior {
	const props = def.properties || {};
	const states: CompiledState[] = [];
	const rootStateByName = new Map<string, number>();
	const errors: string[] = [];

	function compileState(json: any, ownerLabel: string | null): number {
		const index = states.length;
		const state: CompiledState = {
			index,
			name: json.name || `state${index}`,
			label: ownerLabel ? `${ownerLabel}/${json.name || index}` : json.name || `state${index}`,
			actions: (json.actions || []).map(compileAction) as CompiledAction[],
			minCommitSeconds: Number(json.min_commit_seconds || 0),
			children: [],
			initialChild: -1,
			transitions: [],
		};
		states.push(state);

		const childIndices = new Map<string, number>();
		for (const childJson of json.states || []) {
			const childIndex = compileState(childJson, state.label);
			childIndices.set(childJson.name, childIndex);
			state.children.push(childIndex);
			if (childJson.initial) state.initialChild = childIndex;
		}
		if (state.children.length && state.initialChild < 0) state.initialChild = state.children[0];

		// Sibling transitions resolve after every sibling exists.
		for (const childJson of json.states || []) {
			const childIndex = childIndices.get(childJson.name) as number;
			states[childIndex].transitions = (childJson.transitions || []).map((t: any): CompiledTransition => ({
				trigger: t.on,
				event: t.event || null,
				toIndex: t.to === undefined ? -1 : childIndices.has(t.to) ? (childIndices.get(t.to) as number) : -1,
				toName: t.to || null,
				result: t.result || null,
				conditions: (t.conditions || []).map(compileCondition),
				priority: Number(t.priority || 0),
			}));
			for (const t of states[childIndex].transitions) {
				if (t.toName && t.toIndex < 0) {
					errors.push(`${def.id}: transition to unknown state "${t.toName}" in ${state.label}`);
				}
			}
			states[childIndex].transitions.sort((a, b) => b.priority - a.priority);
		}
		return index;
	}

	const rootEntries: CompiledRootEntry[] = [];
	for (const rootJson of props.roots || []) {
		const name = rootJson.name || `root${rootEntries.length}`;
		const entry: CompiledRootEntry = {
			name,
			when: (rootJson.when || []).map(compileCondition),
			holdSeconds: Number(rootJson.hold_seconds || 0),
			failCooldown: rootJson.fail_cooldown === undefined ? 6 : Number(rootJson.fail_cooldown),
			navPolicy: rootJson.nav_policy === 'breach' ? 'breach' : 'blocking',
			entryIndex: rootEntries.length,
			stateIndex: -1,
			isAlias: false,
			priority: rootEntries.length,
		};

		if (rootStateByName.has(name)) {
			entry.stateIndex = rootStateByName.get(name) as number;
			entry.isAlias = true;
			const first = rootEntries.find((e) => e.stateIndex === entry.stateIndex) as CompiledRootEntry;
			entry.priority = first.priority;
			if (!rootJson.nav_policy) entry.navPolicy = first.navPolicy;
		} else {
			entry.stateIndex = compileState(rootJson, null);
			entry.isAlias = false;
			entry.priority = rootEntries.length;
			rootStateByName.set(name, entry.stateIndex);
		}
		rootEntries.push(entry);
	}

	// Skills compile into the same state table; run_skill pushes a frame onto its root state.
	const skillTable: Record<string, CompiledSkill> = {};
	for (const [id, skillDef] of Object.entries(skills || {})) {
		const sp = skillDef.properties || {};
		const rootIndex = compileState({ name: id, states: sp.states || [] }, null);
		skillTable[id] = { id, rootIndex, inputs: sp.inputs || {} };
	}

	return {
		id: def.id,
		rootEvalInterval: Number(props.root_eval_interval ?? 0.2),
		rootEntries,
		states,
		skills: skillTable,
		errors,
	};
}

function compileCondition(json: any): CompiledCondition {
	return {
		kind: json.if,
		// The engine accepts both spellings; `negate` on has_attack_token, `invert` elsewhere.
		negate: Boolean(json.negate || json.invert),
		params: json,
	};
}

function compileAction(json: any): CompiledAction {
	return { kind: json.do, params: json };
}

/** Enemies that carry an AI2 stack and a behavior we can run. */
export function playableEnemies(pack: { enemies: Record<string, DefJson> }): DefJson[] {
	return Object.values(pack.enemies || {})
		.filter((e) => e.properties?.ai_stack === 'v2' && e.properties?.behavior)
		.sort((a, b) => (a.properties.display_name || a.id).localeCompare(b.properties.display_name || b.id));
}

export function movementProfiles(enemyDef: DefJson): Record<string, { maxSpeed: number; accel: number; rotationRate: number }> {
	const out: Record<string, { maxSpeed: number; accel: number; rotationRate: number }> = {};
	for (const p of enemyDef.properties?.movement_profiles || []) {
		out[p.name] = { maxSpeed: p.max_speed, accel: p.accel, rotationRate: p.rotation_rate };
	}
	if (!out.walk) out.walk = { maxSpeed: 110, accel: 800, rotationRate: 180 };
	return out;
}
