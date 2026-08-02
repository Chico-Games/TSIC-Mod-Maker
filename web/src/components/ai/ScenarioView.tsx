// The Scenarios view: run the whole deterministic AI suite against the definitions loaded
// in this project, then click any result to watch that exact run in the Sandbox.
//
// The suite here is the same code the headless `npx tsx ai-test.mjs` runs, against the same
// scenario catalogue, so a verdict in the browser and a verdict in CI cannot disagree. What
// the browser adds is the ability to load a failing run into the live world and step through
// it with the inspector, the behaviour graph and the decision timeline attached.

import { useCallback, useMemo, useState } from 'react';
import type { AiWorldApi } from './useAiWorld';
import { runSuite, DEFAULT_SEED, type Outcome, type SuiteEntry } from '../../ai/testing/suite';
import { ALL_SCENARIOS, filterScenarios, scenarioTags } from '../../ai/testing/scenarios';
import type { ScenarioSpec } from '../../ai/testing/types';

const OUTCOME_LABEL: Record<Outcome, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  known: 'KNOWN',
  fixed: 'FIXED',
  skip: 'SKIP',
};

const OUTCOME_HINT: Record<Outcome, string> = {
  pass: 'Behaves as specified.',
  fail: 'A regression — this used to be, or should be, correct.',
  known: 'A documented defect. Still broken, but nobody is surprised.',
  fixed: 'Marked as a known bug but now passing — drop the knownBug marker.',
  skip: 'Skipped.',
};

export function ScenarioView({ api }: { api: AiWorldApi }) {
  const [entries, setEntries] = useState<SuiteEntry[] | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState('');
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [openId, setOpenId] = useState<string | null>(null);
  const [wallMs, setWallMs] = useState(0);
  const [simSeconds, setSimSeconds] = useState(0);

  const tags = useMemo(() => scenarioTags(), []);
  const visible = useMemo(() => filterScenarios(filter), [filter]);

  const run = useCallback(() => {
    setRunning(true);
    // Yield a frame so the button repaints before the suite blocks the main thread. The whole
    // catalogue is a few seconds of wall time, which is short enough not to need a worker.
    setTimeout(() => {
      const report = runSuite(api.pack, { filter, seed, keepTrace: false });
      setEntries(report.entries);
      setWallMs(report.wallMs);
      setSimSeconds(report.simSeconds);
      setRunning(false);
    }, 16);
  }, [api.pack, filter, seed]);

  const watch = useCallback(
    (spec: ScenarioSpec) => {
      api.loadScenario(spec, seed);
      api.setControls({ running: true, speed: 1 });
    },
    [api, seed],
  );

  const shown = entries
    ? entries.filter((e) => visible.some((s) => s.id === e.result.id))
    : null;
  const counts = shown
    ? shown.reduce<Record<string, number>>((acc, e) => {
        acc[e.outcome] = (acc[e.outcome] ?? 0) + 1;
        return acc;
      }, {})
    : null;

  return (
    <div className="ai-scenarios">
      <div className="ai-scenarios-bar">
        <button className="primary" onClick={run} disabled={running}>
          {running ? 'Running…' : `▶ Run ${visible.length} scenario${visible.length === 1 ? '' : 's'}`}
        </button>
        <input
          type="search"
          placeholder="filter by id, title or tag"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label title="Every scenario is deterministic at a given seed. Change it to shake out expectations that only hold for one set of wander rolls.">
          seed{' '}
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || DEFAULT_SEED)}
            style={{ width: '9ch' }}
          />
        </label>
        {api.scenario && (
          <button onClick={() => api.loadScenario(null)} title="Hand the Sandbox back to free play">
            ⏏ unload “{api.scenario.id}”
          </button>
        )}
        {counts && (
          <span className="ai-scenarios-summary">
            {(['fail', 'fixed', 'known', 'pass', 'skip'] as Outcome[])
              .filter((o) => counts[o])
              .map((o) => (
                <span key={o} className={`chip ${o}`} title={OUTCOME_HINT[o]}>
                  {counts[o]} {OUTCOME_LABEL[o]}
                </span>
              ))}
            <span className="dim">
              {simSeconds.toFixed(0)} sim-seconds in {(wallMs / 1000).toFixed(2)}s (
              {(simSeconds / Math.max(wallMs / 1000, 0.001)).toFixed(0)}× realtime)
            </span>
          </span>
        )}
      </div>

      <div className="ai-scenarios-tags">
        {tags.map((tag) => (
          <button
            key={tag}
            className={`tag ${filter === tag ? 'active' : ''}`}
            onClick={() => setFilter(filter === tag ? '' : tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="ai-scenarios-list">
        {visible.map((spec) => {
          const entry = shown?.find((e) => e.result.id === spec.id) ?? null;
          const outcome = entry?.outcome;
          const open = openId === spec.id;
          const failed = entry?.result.checks.filter((c) => !c.ok) ?? [];
          return (
            <div key={spec.id} className={`ai-scenario ${outcome ?? 'idle'} ${open ? 'open' : ''}`}>
              <div className="ai-scenario-head" onClick={() => setOpenId(open ? null : spec.id)}>
                <span className={`badge ${outcome ?? 'idle'}`} title={outcome ? OUTCOME_HINT[outcome] : 'Not run yet'}>
                  {outcome ? OUTCOME_LABEL[outcome] : '—'}
                </span>
                <span className="ai-scenario-id">{spec.id}</span>
                <span className="ai-scenario-title">{spec.title}</span>
                <span className="dim">{spec.seconds}s</span>
                {entry && !entry.deterministic && (
                  <span className="chip fail" title={`hashes: ${entry.result.hash}, ${entry.repeatHashes.join(', ')}`}>
                    NON-DETERMINISTIC
                  </span>
                )}
                <button
                  className={api.scenario?.id === spec.id ? 'primary' : ''}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    watch(spec);
                  }}
                  title="Load this scenario into the Sandbox and play it"
                >
                  👁 watch
                </button>
              </div>

              {open && (
                <div className="ai-scenario-body">
                  <div className="ai-scenario-meta">
                    <span>tags: {spec.tags.join(', ')}</span>
                    {entry && <span>seed {entry.result.seed}</span>}
                    {entry && <span>world hash {entry.result.hash}</span>}
                    {entry && <span>{entry.result.wallMs}ms</span>}
                  </div>

                  {spec.knownBug && (
                    <p className="ai-scenario-known">
                      <strong>Known bug.</strong> {spec.knownBug}
                    </p>
                  )}

                  {entry?.result.error && <p className="ai-scenario-error">{entry.result.error}</p>}

                  {entry ? (
                    <ul className="ai-scenario-checks">
                      {entry.result.checks.map((check, i) => (
                        <li key={i} className={check.ok ? 'ok' : 'bad'}>
                          <span>{check.ok ? '✓' : '×'}</span>
                          <span>{check.name}</span>
                          <span className="dim">{check.detail}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dim">Not run yet.</p>
                  )}

                  {failed.length > 0 && (
                    <p className="dim">
                      Hit <strong>watch</strong>, then switch to the Sandbox, Behaviour or Perception tab to see
                      why. The run is stepped by the same script at the same seed, so it fails the same way.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!entries && (
        <p className="dim ai-scenarios-empty">
          {ALL_SCENARIOS.length} scenarios, every one deterministic at a given seed. They run against the
          definitions loaded in this project — so a number you change in the Definitions tab shows up here on
          the next run.
        </p>
      )}
    </div>
  );
}
