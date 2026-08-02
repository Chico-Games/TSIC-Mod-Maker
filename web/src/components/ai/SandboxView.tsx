// The sandbox: a live world you drag things around in, with the inspector on the right and
// a decision timeline underneath.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { yawOf } from '../../ai/util';
import { footprintHalfExtent } from '../../ai/sim';
import type { Actor, EnemyActor } from '../../ai/sim';
import { daySectionsFor } from '../../ai/pack';
import type { DefJson } from '../../ai/types';
import { SandboxCanvas, DEFAULT_OVERLAYS, type Camera, type Overlays } from './SandboxCanvas';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import type { AiWorldApi, SceneName } from './useAiWorld';
import { useAppStore } from '../../store/appStore';

const SCENES: Array<{ id: SceneName; label: string }> = [
  { id: 'arena', label: 'Open arena' },
  { id: 'corridor', label: 'Blind corner' },
  { id: 'shop', label: 'Shop aisles' },
];

const OVERLAY_LABELS: Array<[keyof Overlays, string]> = [
  ['cones', 'sight cones'],
  ['los', 'sight links'],
  ['ranges', 'attack ranges'],
  ['paths', 'nav paths'],
  ['poi', 'POI + anchor'],
  ['noise', 'noise pulses'],
  ['hitboxes', 'hitboxes'],
  ['labels', 'labels'],
  ['grid', 'grid'],
  ['navGrid', 'nav grid'],
];

export function SandboxView({ api }: { api: AiWorldApi }) {
  const { world, pack, enemies, controls, setControls } = api;
  const setAiSubTab = useAppStore((s) => s.setAiSubTab);

  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 0.16 });
  const [spawnId, setSpawnId] = useState(enemies[0]?.id ?? '');
  const [furnitureFilter, setFurnitureFilter] = useState('');
  const [furnitureId, setFurnitureId] = useState('');
  const heldKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!spawnId && enemies[0]) setSpawnId(enemies[0].id);
  }, [enemies, spawnId]);

  const daySections = useMemo(() => {
    const out = new Set<string>();
    for (const def of enemies) {
      for (const s of daySectionsFor(pack.perception, def.properties?.perception)) out.add(s);
    }
    return [...out];
  }, [enemies, pack.perception]);

  const furniture = useMemo(() => {
    const rows = Object.values(pack.furniture)
      .filter((d) => d.properties?.starting_health !== undefined)
      .map((def) => ({
        def,
        id: def.id,
        name: String(def.properties?.display_name ?? def.id),
        health: def.properties?.starting_health as number,
        armour: (def.properties?.furniture_armour as number) ?? 0,
        halfExtent: footprintHalfExtent(def) ?? 60,
        breakable: Boolean(def.properties?.destructible_collection),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return rows;
  }, [pack.furniture]);

  const filteredFurniture = useMemo(() => {
    const needle = furnitureFilter.trim().toLowerCase();
    return needle
      ? furniture.filter((r) => r.id.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
      : furniture;
  }, [furniture, furnitureFilter]);

  useEffect(() => {
    if (!filteredFurniture.some((r) => r.id === furnitureId)) {
      setFurnitureId(filteredFurniture[0]?.id ?? '');
    }
  }, [filteredFurniture, furnitureId]);

  const selectedFurniture = furniture.find((r) => r.id === furnitureId) ?? null;

  const activePlayer = api.selected?.isPlayer ? api.selected : world.players[0] ?? null;

  // Keyboard: WASD drives the selected player so you can walk into a cone yourself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const key = e.key.toLowerCase();
      heldKeys.current.add(key);
      if (e.code === 'Space') {
        e.preventDefault();
        setControls({ running: !controls.running });
      }
      if (key === '.') {
        setControls({ running: false });
        api.step();
      }
      const player = activePlayer as any;
      if (!player) return;
      if (key === 'c') player.crouched = !player.crouched;
      if (key === 'v') player.stealthed = !player.stealthed;
      if (key === 'f') world.playerAttack(player);
      if (key === 'n') world.reportNoise(player.pos, 1, 3000, world.time);
    };
    const onUp = (e: KeyboardEvent) => heldKeys.current.delete(e.key.toLowerCase());
    const onBlur = () => heldKeys.current.clear();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [api, controls.running, setControls, activePlayer, world]);

  // Drive movement from held keys every frame.
  useEffect(() => {
    for (const p of world.players) p.moveInput = { x: 0, y: 0 };
    const player = activePlayer as any;
    if (!player) return;
    const held = heldKeys.current;
    const input = { x: 0, y: 0 };
    if (held.has('w') || held.has('arrowup')) input.y -= 1;
    if (held.has('s') || held.has('arrowdown')) input.y += 1;
    if (held.has('a') || held.has('arrowleft')) input.x -= 1;
    if (held.has('d') || held.has('arrowright')) input.x += 1;
    player.moveInput = input;
    if (input.x || input.y) player.yaw = yawOf(input);
  }, [api.frame, activePlayer, world]);

  const centreOfView = useCallback(() => ({ x: camera.x, y: camera.y }), [camera]);

  const jumpToBehavior = useCallback(() => setAiSubTab('behavior'), [setAiSubTab]);

  return (
    <div className="ai-sandbox">
      <aside className="ai-left">
        <section>
          <h4>Scene</h4>
          <select value={controls.scene} onChange={(e) => setControls({ scene: e.target.value as SceneName })}>
            {SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={controls.daySection ?? ''}
            onChange={(e) => setControls({ daySection: e.target.value || null })}
          >
            <option value="">Day (base profile)</option>
            {daySections.map((s) => (
              <option key={s} value={s}>
                {s.split('.').pop()}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h4>Spawn</h4>
          <select value={spawnId} onChange={(e) => setSpawnId(e.target.value)}>
            {enemies.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.properties?.display_name ?? d.id)}
              </option>
            ))}
          </select>
          <div className="row">
            <button className="primary" onClick={() => api.spawnEnemy(spawnId, centreOfView())}>
              + Enemy
            </button>
            <button onClick={() => api.spawnPlayer(centreOfView())}>+ Player</button>
          </div>
        </section>

        <section>
          <h4>Blocking furniture</h4>
          <input
            type="search"
            placeholder="filter FD_… by name"
            value={furnitureFilter}
            onChange={(e) => setFurnitureFilter(e.target.value)}
          />
          <select
            size={7}
            value={furnitureId}
            onChange={(e) => setFurnitureId(e.target.value)}
            className="furniture-list"
          >
            {filteredFurniture.slice(0, 400).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.health}hp a{r.armour} {Math.round(r.halfExtent * 2)}uu
                {r.breakable ? '' : ' [unbreakable]'}
              </option>
            ))}
          </select>
          {selectedFurniture && (
            <div className="furniture-info">
              <div>{selectedFurniture.id}</div>
              <div className={selectedFurniture.breakable ? 'ok' : 'warn'}>
                {selectedFurniture.breakable
                  ? 'breakable — can_break_furniture passes, breach nav routes through it'
                  : 'no destructible collection — can_break_furniture FAILS, the AI must route around'}
              </div>
            </div>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={!selectedFurniture}
              onClick={() => selectedFurniture && api.spawnFurniture(selectedFurniture.def, centreOfView())}
            >
              + Place
            </button>
            <button
              disabled={!selectedFurniture}
              onClick={() => selectedFurniture && api.spawnFurniture(selectedFurniture.def, centreOfView(), 8)}
            >
              + Wall of 8
            </button>
            <button onClick={api.clearFurniture}>Clear</button>
          </div>
        </section>

        <section>
          <h4>
            Actors
            <button
              className="mini"
              title="Pause / resume every AI"
              onClick={() => {
                const anyLive = world.enemies.some((e) => !e.paused);
                for (const e of world.enemies) e.paused = anyLive;
              }}
            >
              ⏸ all
            </button>
          </h4>
          <div className="actor-list">
            {[...world.enemies, ...world.players].map((actor) => (
              <div
                key={actor.id}
                className={`actor-row ${actor === api.selected ? 'sel' : ''}`}
                onClick={() => api.select(actor)}
              >
                <span className={`dot ${actor.isPlayer ? 'dot-player' : 'dot-enemy'}`} />
                <span className="actor-name">{actor.label}</span>
                {actor.isEnemy && (
                  <button
                    className={`mini ${(actor as EnemyActor).paused ? 'on' : ''}`}
                    title="Pause this AI"
                    onClick={(e) => {
                      e.stopPropagation();
                      (actor as EnemyActor).paused = !(actor as EnemyActor).paused;
                    }}
                  >
                    {(actor as EnemyActor).paused ? '⏸' : '▶'}
                  </button>
                )}
                <button
                  className="mini"
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    api.remove(actor as Actor);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4>Overlays</h4>
          <div className="toggles">
            {OVERLAY_LABELS.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={overlays[key]}
                  onChange={(e) => setOverlays({ ...overlays, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section className="help">
          <h4>Keys</h4>
          <dl>
            <dt>drag body</dt>
            <dd>move an actor</dd>
            <dt>drag arrow</dt>
            <dd>rotate it</dd>
            <dt>WASD</dt>
            <dd>walk the selected player</dd>
            <dt>C / V</dt>
            <dd>crouch / stealth</dd>
            <dt>F</dt>
            <dd>player swings</dd>
            <dt>N</dt>
            <dd>make a noise here</dd>
            <dt>Space / .</dt>
            <dd>pause / single step</dd>
          </dl>
        </section>
      </aside>

      <div className="ai-stage">
        <div className="ai-toolbar">
          <button className="primary" onClick={() => setControls({ running: !controls.running })}>
            {controls.running ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            onClick={() => {
              setControls({ running: false });
              api.step();
            }}
          >
            ⏭ Step
          </button>
          <label className="speed">
            speed
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={controls.speed}
              onChange={(e) => setControls({ speed: Number(e.target.value) })}
            />
            <span>{controls.speed.toFixed(2)}×</span>
          </label>
          <button onClick={api.reset}>↺ Reset scene</button>
          <span className="clock">t = {world.time.toFixed(1)}s</span>
          <span className="ai-legend">
            <i className="sw sw-spotted" /> Spotted
            <i className="sw sw-glimpsed" /> Glimpsed
            <i className="sw sw-remembered" /> Remembered
            <i className="sw sw-target" /> Target
            <i className="sw sw-poi" /> POI
            <i className="sw sw-anchor" /> Anchor
          </span>
        </div>

        <SandboxCanvas
          world={world}
          frame={api.frame}
          overlays={overlays}
          selected={api.selected}
          onSelect={api.select}
          onMoved={api.invalidatePaths}
          camera={camera}
          onCamera={setCamera}
        />

        <Timeline world={world} frame={api.frame} selected={api.selected} onSelect={api.select} />
      </div>

      <aside className="ai-right">
        <Inspector world={world} selected={api.selected} onJumpToBehavior={jumpToBehavior} />
      </aside>
    </div>
  );
}
