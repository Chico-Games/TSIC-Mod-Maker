// The scenario catalogue. Everything the headless runner and the Scenarios view read.

import type { ScenarioSpec } from '../types';
import { perceptionScenarios } from './perception';
import { engageScenarios } from './engage';
import { aggroScenarios } from './aggro';
import { navScenarios } from './nav';
import { personalityScenarios } from './personality';
import { coverageScenarios } from './coverage';

export const ALL_SCENARIOS: ScenarioSpec[] = [
	...perceptionScenarios,
	...engageScenarios,
	...aggroScenarios,
	...navScenarios,
	...personalityScenarios,
	...coverageScenarios,
];

/** Every tag in use, in first-seen order — the Scenarios view builds its filters from this. */
export function scenarioTags(scenarios: ScenarioSpec[] = ALL_SCENARIOS): string[] {
	const tags: string[] = [];
	for (const scenario of scenarios) {
		for (const tag of scenario.tags) if (!tags.includes(tag)) tags.push(tag);
	}
	return tags.sort();
}

/** Substring match on id, title or tag — the `--filter` argument and the search box. */
export function filterScenarios(pattern: string, scenarios: ScenarioSpec[] = ALL_SCENARIOS): ScenarioSpec[] {
	if (!pattern) return scenarios;
	const needle = pattern.toLowerCase();
	return scenarios.filter(
		(s) =>
			s.id.toLowerCase().includes(needle) ||
			s.title.toLowerCase().includes(needle) ||
			s.tags.some((tag) => tag.toLowerCase().includes(needle)),
	);
}

export function scenarioById(id: string): ScenarioSpec | undefined {
	return ALL_SCENARIOS.find((s) => s.id === id);
}
