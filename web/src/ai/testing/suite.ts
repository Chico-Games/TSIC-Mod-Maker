// Suite orchestration: run a set of scenarios, classify the outcomes, optionally verify
// determinism and sweep seeds. Shared by the headless CLI and the Scenarios view.

import { runScenario } from './harness';
import { ALL_SCENARIOS, filterScenarios } from './scenarios';
import type { AiPack } from '../types';
import type { ScenarioResult, ScenarioSpec } from './types';

export type Outcome =
	/** Passed, as expected. */
	| 'pass'
	/** Failed. This is the only outcome that should ever make a run red on purpose. */
	| 'fail'
	/** Marked `knownBug` and still failing — documented, not a regression. */
	| 'known'
	/** Marked `knownBug` but now passing: the fix landed, drop the marker. */
	| 'fixed'
	| 'skip';

export interface SuiteEntry {
	result: ScenarioResult;
	outcome: Outcome;
	/** Populated by `--repeat`: the hash of each extra run of the same seed. */
	repeatHashes: string[];
	deterministic: boolean;
}

export interface SuiteReport {
	entries: SuiteEntry[];
	counts: Record<Outcome, number>;
	nondeterministic: SuiteEntry[];
	wallMs: number;
	simSeconds: number;
	steps: number;
	/** True when nothing needs a human: no failures, no unexpected passes, no drift. */
	green: boolean;
}

export interface SuiteOptions {
	filter?: string;
	/** Base seed. Every scenario without its own `seed` runs at this one. */
	seed?: number;
	/** Run each scenario at this many consecutive seeds; any failure fails the scenario. */
	seeds?: number;
	/** Re-run each scenario N extra times at the same seed and compare world hashes. */
	repeat?: number;
	keepTrace?: boolean;
	scenarios?: ScenarioSpec[];
	/** Called after each scenario so a UI can stream progress. */
	onResult?: (entry: SuiteEntry, index: number, total: number) => void;
}

export const DEFAULT_SEED = 20260731;

function classify(result: ScenarioResult): Outcome {
	if (result.skipped) return 'skip';
	if (result.knownBug) return result.passed ? 'fixed' : 'known';
	return result.passed ? 'pass' : 'fail';
}

export function runSuite(pack: AiPack, opts: SuiteOptions = {}): SuiteReport {
	const scenarios = filterScenarios(opts.filter ?? '', opts.scenarios ?? ALL_SCENARIOS);
	const baseSeed = opts.seed ?? DEFAULT_SEED;
	const seedCount = Math.max(1, opts.seeds ?? 1);
	const repeats = Math.max(0, opts.repeat ?? 0);
	const started = Date.now();

	const entries: SuiteEntry[] = [];
	let simSeconds = 0;
	let steps = 0;

	scenarios.forEach((spec, index) => {
		// A seed sweep keeps the FIRST failing run, so the report points at a reproducible
		// seed rather than at whichever one happened to finish last.
		let kept: ScenarioResult | null = null;
		for (let s = 0; s < seedCount; s += 1) {
			const result = runScenario(spec, pack, { seed: baseSeed + s, keepTrace: opts.keepTrace });
			simSeconds += result.simSeconds;
			steps += result.steps;
			if (!kept || (kept.passed && !result.passed)) kept = result;
			if (!result.passed) break;
		}
		const result = kept as ScenarioResult;

		const repeatHashes: string[] = [];
		for (let r = 0; r < repeats && !result.skipped; r += 1) {
			const again = runScenario(spec, pack, { seed: result.seed, keepTrace: false });
			simSeconds += again.simSeconds;
			steps += again.steps;
			repeatHashes.push(again.hash);
		}

		const entry: SuiteEntry = {
			result,
			outcome: classify(result),
			repeatHashes,
			deterministic: repeatHashes.every((h) => h === result.hash),
		};
		entries.push(entry);
		opts.onResult?.(entry, index, scenarios.length);
	});

	const counts: Record<Outcome, number> = { pass: 0, fail: 0, known: 0, fixed: 0, skip: 0 };
	for (const entry of entries) counts[entry.outcome] += 1;
	const nondeterministic = entries.filter((entry) => !entry.deterministic);

	return {
		entries,
		counts,
		nondeterministic,
		wallMs: Date.now() - started,
		simSeconds,
		steps,
		green: counts.fail === 0 && counts.fixed === 0 && nondeterministic.length === 0,
	};
}
