// Headless deterministic AI scenario suite.
//
//   npx tsx ai-test.mjs                     # every scenario, against the real default mod
//   npx tsx ai-test.mjs --filter perception # substring match on id, title or tag
//   npx tsx ai-test.mjs --repeat 2          # verify each scenario replays identically
//   npx tsx ai-test.mjs --seeds 5           # sweep 5 consecutive seeds per scenario
//   npx tsx ai-test.mjs --pack <folder>     # point at another mod folder
//   npx tsx ai-test.mjs --json out.json     # machine-readable report
//   npx tsx ai-test.mjs --list              # print the catalogue and exit
//
// Exit code is 0 only when nothing needs a human: no failures, no known-bug scenarios that
// have quietly started passing, and no determinism drift.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The submodule is the single source of truth; the bundled starter project has drifted. */
const PACK_CANDIDATES = [
	resolve(HERE, '../../../Unreal Projects/TSIC/Mods/com.chicogames.default'),
	resolve(HERE, '../vendor/default-project'),
	resolve(HERE, 'public/starter-project'),
];

const AI_FOLDERS = {
	enemies: 'enemy_definitions',
	perception: 'perception_definitions',
	behaviors: 'behavior_definitions',
	skills: 'skill_definitions',
	furniture: 'damageable_furniture_definitions',
};

// --- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const options = {
	filter: arg('filter', ''),
	seed: Number(arg('seed', 20260731)),
	seeds: Number(arg('seeds', 1)),
	repeat: Number(arg('repeat', 0)),
	pack: arg('pack'),
	json: arg('json'),
	list: flag('list'),
	verbose: flag('verbose'),
	quiet: flag('quiet'),
};

// --- pack loading ----------------------------------------------------------

async function readFolder(root, name) {
	const out = {};
	let files;
	try {
		files = await readdir(join(root, name));
	} catch {
		return out;
	}
	for (const file of files) {
		if (!file.endsWith('.json') || file.startsWith('_')) continue;
		try {
			const json = JSON.parse(await readFile(join(root, name, file), 'utf8'));
			out[json.id ?? file.replace(/\.json$/, '')] = json;
		} catch (err) {
			console.warn(`  ! ${name}/${file}: ${err.message}`);
		}
	}
	return out;
}

async function findPack() {
	const candidates = options.pack ? [resolve(options.pack)] : PACK_CANDIDATES;
	for (const root of candidates) {
		try {
			const enemies = await readdir(join(root, 'enemy_definitions'));
			if (enemies.length) return root;
		} catch {
			// keep looking
		}
	}
	throw new Error(`no mod folder with enemy_definitions found. Tried:\n  ${candidates.join('\n  ')}`);
}

// --- report ----------------------------------------------------------------

const C = {
	reset: '[0m', dim: '[2m', bold: '[1m',
	green: '[32m', red: '[31m', yellow: '[33m', cyan: '[36m', grey: '[90m',
};
const paint = (colour, text) => (process.stdout.isTTY ? `${colour}${text}${C.reset}` : text);

const BADGE = {
	pass: paint(C.green, 'PASS'),
	fail: paint(C.red, 'FAIL'),
	known: paint(C.yellow, 'KNOWN'),
	fixed: paint(C.cyan, 'FIXED'),
	skip: paint(C.grey, 'SKIP'),
};

async function main() {
	const { runSuite } = await import('./src/ai/testing/suite.ts');
	const { ALL_SCENARIOS, filterScenarios } = await import('./src/ai/testing/scenarios/index.ts');

	if (options.list) {
		for (const spec of filterScenarios(options.filter, ALL_SCENARIOS)) {
			console.log(`${spec.id.padEnd(48)} ${spec.tags.join(',').padEnd(28)} ${spec.seconds}s  ${spec.title}`);
		}
		return 0;
	}

	const root = await findPack();
	const pack = {};
	for (const [slot, folder] of Object.entries(AI_FOLDERS)) pack[slot] = await readFolder(root, folder);

	const v2 = Object.values(pack.enemies).filter((d) => d.properties?.ai_stack === 'v2');
	console.log(`pack ${paint(C.dim, root)}`);
	console.log(
		`     ${v2.length} v2 enemies, ${Object.keys(pack.behaviors).length} behaviours, ` +
			`${Object.keys(pack.skills).length} skills, ${Object.keys(pack.perception).length} profiles, ` +
			`${Object.keys(pack.furniture).length} furniture\n`,
	);

	const report = runSuite(pack, {
		filter: options.filter,
		seed: options.seed,
		seeds: options.seeds,
		repeat: options.repeat,
		keepTrace: false,
		onResult: (entry) => {
			if (options.quiet && entry.outcome === 'pass') return;
			const { result } = entry;
			const failed = result.checks.filter((c) => !c.ok);
			console.log(
				`${BADGE[entry.outcome]} ${result.id.padEnd(46)} ` +
					paint(C.dim, `${String(result.wallMs).padStart(4)}ms  ${result.hash}`),
			);
			if (result.error) console.log(`       ${paint(C.red, result.error)}`);
			for (const check of failed) {
				console.log(`       ${paint(C.red, '×')} ${check.name} ${paint(C.dim, `— ${check.detail}`)}`);
			}
			if (options.verbose) {
				for (const check of result.checks.filter((c) => c.ok)) {
					console.log(`       ${paint(C.green, '✓')} ${check.name} ${paint(C.dim, `— ${check.detail}`)}`);
				}
			}
			if (entry.outcome === 'known') {
				console.log(`       ${paint(C.yellow, 'known bug:')} ${paint(C.dim, result.knownBug)}`);
			}
			if (entry.outcome === 'fixed') {
				console.log(`       ${paint(C.cyan, 'this passes now — drop the knownBug marker')}`);
			}
			if (!entry.deterministic) {
				console.log(
					`       ${paint(C.red, 'NON-DETERMINISTIC')} ${result.hash} vs [${entry.repeatHashes.join(', ')}]`,
				);
			}
		},
	});

	const { counts } = report;
	const throughput = report.simSeconds / (report.wallMs / 1000);
	console.log('');
	console.log(
		`${counts.pass} passed, ${counts.fail} failed, ${counts.known} known, ` +
			`${counts.fixed} newly fixed, ${counts.skip} skipped`,
	);
	console.log(
		paint(
			C.dim,
			`${report.simSeconds.toFixed(0)} sim-seconds in ${(report.wallMs / 1000).toFixed(2)}s wall ` +
				`(${throughput.toFixed(0)}x realtime, ${report.steps.toLocaleString()} ticks)`,
		),
	);
	if (options.repeat > 0) {
		console.log(
			report.nondeterministic.length === 0
				? paint(C.green, `determinism verified over ${options.repeat} extra run(s) each`)
				: paint(C.red, `${report.nondeterministic.length} scenario(s) did not replay identically`),
		);
	}

	if (options.json) {
		await writeFile(
			options.json,
			JSON.stringify(
				{
					pack: root,
					seed: options.seed,
					counts,
					wallMs: report.wallMs,
					simSeconds: report.simSeconds,
					entries: report.entries.map((entry) => ({
						id: entry.result.id,
						title: entry.result.title,
						tags: entry.result.tags,
						outcome: entry.outcome,
						seed: entry.result.seed,
						hash: entry.result.hash,
						deterministic: entry.deterministic,
						error: entry.result.error,
						knownBug: entry.result.knownBug,
						checks: entry.result.checks,
					})),
				},
				null,
				2,
			),
			'utf8',
		);
		console.log(paint(C.dim, `wrote ${options.json}`));
	}

	return report.green ? 0 : 1;
}

process.exit(await main());
