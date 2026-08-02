// Decision timeline — one lane per agent on a shared clock.
//
// Root thrash, a chase collapsing into its fail_cooldown, two enemies fighting over the
// attack token: all of it is obvious as a shape here and nearly invisible in a log.

import { useMemo } from 'react';
import type { Actor, World } from '../../ai/sim';
import type { TimelineEvent } from '../../ai/types';

const WINDOW_SECONDS = 30;

const KIND_COLOR: Record<TimelineEvent['kind'], string> = {
  root: '#4ea3ff',
  state: '#5b6675',
  event: '#c084fc',
  ability: '#ff6b5a',
  target: '#67e08a',
  fail: '#ff9f43',
  sense: '#38bdf8',
};

export function Timeline({
  world,
  frame,
  selected,
  onSelect,
}: {
  world: World;
  frame: number;
  selected: Actor | null;
  onSelect: (a: Actor | null) => void;
}) {
  const now = world.time;
  const from = Math.max(0, now - WINDOW_SECONDS);

  // `frame` is the render trigger; the data itself lives on the mutable world.
  void frame;

  const lanes = useMemo(() => {
    const byAgent = new Map<number, TimelineEvent[]>();
    for (const event of world.timeline) {
      if (event.t < from) continue;
      const list = byAgent.get(event.agentId) ?? [];
      list.push(event);
      byAgent.set(event.agentId, list);
    }
    return world.enemies.map((enemy) => ({
      enemy,
      events: byAgent.get(enemy.id) ?? [],
    }));
  }, [world, from, now]);

  if (!lanes.length) return null;

  const pct = (t: number) => ((t - from) / WINDOW_SECONDS) * 100;

  return (
    <div className="ai-timeline">
      <div className="tl-head">
        <span className="tl-title">Decisions</span>
        <span className="muted tiny">last {WINDOW_SECONDS}s</span>
        <span className="tl-legend">
          {(Object.keys(KIND_COLOR) as Array<TimelineEvent['kind']>).map((k) => (
            <span key={k}>
              <i style={{ background: KIND_COLOR[k] }} />
              {k}
            </span>
          ))}
        </span>
      </div>
      <div className="tl-lanes">
        {lanes.map(({ enemy, events }) => (
          <div
            key={enemy.id}
            className={`tl-lane ${selected === enemy ? 'sel' : ''}`}
            onClick={() => onSelect(enemy)}
          >
            <span className="tl-name">{enemy.label}</span>
            <div className="tl-track">
              {events.map((event, i) => (
                <span
                  key={i}
                  className="tl-mark"
                  style={{ left: `${pct(event.t)}%`, background: KIND_COLOR[event.kind] }}
                  title={`${event.t.toFixed(2)}s — ${event.text}`}
                />
              ))}
              {/* Root spans: the band under the marks, so "what was it doing" reads at a glance. */}
              {rootSpans(events, now).map((span, i) => (
                <span
                  key={`s${i}`}
                  className="tl-span"
                  style={{
                    left: `${pct(span.from)}%`,
                    width: `${Math.max(0.5, pct(span.to) - pct(span.from))}%`,
                  }}
                  title={span.name}
                >
                  <span className="tl-span-label">{span.name}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Turn the `root → X` marks into contiguous bands ending at `now`. */
function rootSpans(events: TimelineEvent[], now: number) {
  const roots = events.filter((e) => e.kind === 'root');
  const spans: Array<{ name: string; from: number; to: number }> = [];
  roots.forEach((event, i) => {
    const name = event.text.replace(/^root → /, '').replace(/ \(alias entry\)$/, '');
    spans.push({ name, from: event.t, to: roots[i + 1]?.t ?? now });
  });
  return spans;
}
