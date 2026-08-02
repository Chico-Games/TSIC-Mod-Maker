// The one place the sandbox world is created, ticked and rebuilt.
//
// Definitions are the source of truth: any edit that changes a PRC_/BHV_/SKL_/ED_ record
// rebuilds the world in place, keeping actor positions so you can tune a number and watch
// the same scene react rather than starting over.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { World } from '../../ai/sim';
import type { EnemyActor, EntityActor, Actor } from '../../ai/sim';
import { buildAiPack, aiEnemies, packIssues } from '../../ai/loadPack';
import { ScenarioRun } from '../../ai/testing/harness';
import { DEFAULT_SEED } from '../../ai/testing/suite';
import type { ScenarioSpec } from '../../ai/testing/types';
import type { AiPack, DefJson } from '../../ai/types';

export const FIXED_STEP = 1 / 60;

/** How often React-rendered panels refresh. The sim always runs at 60Hz. */
const PANEL_HZ = 10;

export interface ActorSpec {
  kind: 'enemy' | 'player' | 'furniture';
  defId?: string;
  x: number;
  y: number;
  yaw: number;
}

export type SceneName = 'arena' | 'corridor' | 'shop';

export interface SandboxControls {
  running: boolean;
  speed: number;
  daySection: string | null;
  scene: SceneName;
}

const DEFAULT_BOUNDS = { minX: -3000, minY: -2200, maxX: 3000, maxY: 2200 };

function boxWalls(world: World) {
  const { minX, minY, maxX, maxY } = world.bounds;
  world.addWall({ x: minX, y: minY }, { x: maxX, y: minY });
  world.addWall({ x: maxX, y: minY }, { x: maxX, y: maxY });
  world.addWall({ x: maxX, y: maxY }, { x: minX, y: maxY });
  world.addWall({ x: minX, y: maxY }, { x: minX, y: minY });
}

function buildScene(world: World, scene: SceneName) {
  world.bounds = { ...DEFAULT_BOUNDS };
  boxWalls(world);
  if (scene === 'corridor') {
    // A blind corner: the classic "why did it lose me" repro.
    world.addWall({ x: -600, y: -2200 }, { x: -600, y: -400 });
    world.addWall({ x: -600, y: 400 }, { x: -600, y: 2200 });
    world.addWall({ x: 900, y: -900 }, { x: 900, y: 900 });
  }
  if (scene === 'shop') {
    // Aisles: two long walls with a gap, so a chase has to commit to a side.
    world.addWall({ x: -1200, y: -1600 }, { x: -1200, y: -200 });
    world.addWall({ x: -1200, y: 200 }, { x: -1200, y: 1600 });
    world.addWall({ x: 400, y: -1600 }, { x: 400, y: 400 });
    world.addWall({ x: 1800, y: -400 }, { x: 1800, y: 1600 });
  }
}

export interface AiWorldApi {
  world: World;
  pack: AiPack;
  enemies: DefJson[];
  issues: string[];
  /** Bumped on every sim step so React re-renders the views. */
  frame: number;
  controls: SandboxControls;
  setControls: (patch: Partial<SandboxControls>) => void;
  selected: Actor | null;
  select: (a: Actor | null) => void;
  step: (seconds?: number) => void;
  reset: () => void;
  spawnEnemy: (defId: string, at?: { x: number; y: number }) => EnemyActor | null;
  spawnPlayer: (at?: { x: number; y: number }) => void;
  spawnFurniture: (def: DefJson, at?: { x: number; y: number }, count?: number) => void;
  remove: (a: Actor) => void;
  clearFurniture: () => void;
  invalidatePaths: () => void;
  /** Force the world to rebuild from the current definitions right now. */
  rebuild: () => void;
  /**
   * Replace the sandbox world with a test scenario, driven by the same ScenarioRun the
   * headless suite uses — so what you watch here is the run that produced the verdict, not
   * a re-creation of it. Passing null hands the sandbox back to free play.
   */
  loadScenario: (spec: ScenarioSpec | null, seed?: number) => void;
  /** The scenario currently mounted, if any. */
  scenario: ScenarioSpec | null;
}

export function useAiWorld(): AiWorldApi {
  const definitions = useDefinitionsStore((s) => s.definitions);

  const pack = useMemo(() => buildAiPack(definitions), [definitions]);
  const enemies = useMemo(() => aiEnemies(pack), [pack]);
  const issues = useMemo(() => packIssues(pack), [pack]);

  const [controls, setControlsState] = useState<SandboxControls>({
    running: true,
    speed: 1,
    daySection: null,
    scene: 'arena',
  });
  const [frame, setFrame] = useState(0);
  const [selected, setSelected] = useState<Actor | null>(null);

  const worldRef = useRef<World | null>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  // When a scenario is mounted the world belongs to its ScenarioRun, and every step must go
  // through the run so the script fires at the right times. Free play leaves this null.
  const runRef = useRef<ScenarioRun | null>(null);
  const [scenario, setScenario] = useState<ScenarioSpec | null>(null);

  /** Rebuild the world from `pack`, restoring whatever was placed before. */
  const construct = useCallback(
    (specs: ActorSpec[] | null, scene: SceneName, daySection: string | null) => {
      const world = new World(pack);
      buildScene(world, scene);
      world.sceneName = scene;
      if (daySection) world.daySection = daySection;

      const defaultEnemy: ActorSpec[] = enemies[0]
        ? [{ kind: 'enemy', defId: enemies[0].id, x: 900, y: -400, yaw: 180 }]
        : [];

      // A rebuild keeps whatever was placed. The one exception is the very first rebuild
      // after a project finishes loading: the world was constructed with an empty pack, so
      // the scene has a player and nothing to look at. Seed the default enemy then.
      const placed: ActorSpec[] = specs
        ? specs.some((s) => s.kind === 'enemy')
          ? specs
          : [...specs, ...defaultEnemy]
        : [{ kind: 'player', x: -1400, y: 0, yaw: 0 }, ...defaultEnemy];

      for (const spec of placed) {
        try {
          if (spec.kind === 'player') {
            world.addPlayer({ x: spec.x, y: spec.y, yaw: spec.yaw });
          } else if (spec.kind === 'enemy' && spec.defId && pack.enemies[spec.defId]) {
            world.addEnemy(pack.enemies[spec.defId], { x: spec.x, y: spec.y, yaw: spec.yaw });
          } else if (spec.kind === 'furniture' && spec.defId && pack.furniture[spec.defId]) {
            world.addEntity({ def: pack.furniture[spec.defId], x: spec.x, y: spec.y });
          }
        } catch {
          // A definition that fails to compile shouldn't take the whole scene with it;
          // packIssues() already surfaces the reason in the UI.
        }
      }
      if (daySection) world.setDaySection(daySection);
      return world;
    },
    [pack, enemies],
  );

  const snapshot = useCallback((): ActorSpec[] | null => {
    const world = worldRef.current;
    if (!world) return null;
    return [
      ...world.players.map((p): ActorSpec => ({ kind: 'player', x: p.pos.x, y: p.pos.y, yaw: p.yaw })),
      ...world.enemies.map((e): ActorSpec => ({
        kind: 'enemy',
        defId: e.enemyDef.id,
        x: e.pos.x,
        y: e.pos.y,
        yaw: e.yaw,
      })),
      ...world.entities.map((f): ActorSpec => ({
        kind: 'furniture',
        defId: f.defId ?? undefined,
        x: f.pos.x,
        y: f.pos.y,
        yaw: f.yaw,
      })),
    ];
  }, []);

  if (!worldRef.current) {
    worldRef.current = construct(null, controls.scene, controls.daySection);
  }

  // Definitions changed (or the scene did): rebuild, keeping the layout.
  const rebuild = useCallback(() => {
    // A mounted scenario owns its world — rebuilding it from the free-play scene would throw
    // away the walls, the script and the seed the verdict was produced with.
    if (runRef.current) return;
    const specs = snapshot();
    worldRef.current = construct(specs, controlsRef.current.scene, controlsRef.current.daySection);
    setSelected(null);
    setFrame((f) => f + 1);
  }, [construct, snapshot]);

  useEffect(() => {
    rebuild();
    // `pack` identity changes whenever any definition record is replaced, which is exactly
    // when the sim's numbers are stale.
  }, [pack, controls.scene, rebuild]);

  useEffect(() => {
    worldRef.current?.setDaySection(controls.daySection);
    setFrame((f) => f + 1);
  }, [controls.daySection]);

  /** One fixed step of whatever is mounted: a scenario run, or the free-play world. */
  const advance = useCallback(() => {
    const run = runRef.current;
    if (run) {
      // Scenarios have a defined length; past it the world would keep ticking with the
      // script exhausted, which is not what the verdict measured.
      if (!run.finished) run.step(FIXED_STEP);
      return;
    }
    worldRef.current?.step(FIXED_STEP);
  }, []);

  // Fixed-step loop.
  //
  // The sim runs at 60Hz but React only hears about it at PANEL_HZ. The inspector and the
  // behaviour graph are big trees; reconciling them every frame pegs the main thread hard
  // enough to lock the tab. The canvas doesn't go through React at all — it runs its own
  // draw loop straight off the mutable world — so the view stays smooth regardless.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let sincePanel = 0;
    const tick = (nowMs: number) => {
      const real = Math.min((nowMs - last) / 1000, 0.25);
      last = nowMs;
      const world = worldRef.current;
      if (world && controlsRef.current.running) {
        accumulator += real * controlsRef.current.speed;
        let guard = 0;
        while (accumulator >= FIXED_STEP && guard++ < 12) {
          advance();
          accumulator -= FIXED_STEP;
        }
      }
      sincePanel += real;
      if (sincePanel >= 1 / PANEL_HZ) {
        sincePanel = 0;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setControls = useCallback((patch: Partial<SandboxControls>) => {
    setControlsState((c) => ({ ...c, ...patch }));
  }, []);

  const loadScenario = useCallback((spec: ScenarioSpec | null, seed = DEFAULT_SEED) => {
    if (!spec) {
      runRef.current = null;
      setScenario(null);
      worldRef.current = construct(null, controlsRef.current.scene, controlsRef.current.daySection);
      setSelected(null);
      setFrame((f) => f + 1);
      return;
    }
    try {
      const run = new ScenarioRun(spec, pack, spec.seed ?? seed);
      runRef.current = run;
      worldRef.current = run.world;
      setScenario(spec);
      setSelected(run.enemies.values().next().value ?? null);
    } catch (err) {
      // A scenario naming a definition this project doesn't have shouldn't blank the tab.
      runRef.current = null;
      setScenario(null);
      console.error(`scenario "${spec.id}" failed to build`, err);
    }
    setFrame((f) => f + 1);
  }, [construct, pack]);

  const invalidatePaths = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    for (const enemy of world.enemies) {
      const walk = (f: any) => {
        if (!f) return;
        for (const memory of f.memory.values()) {
          if (memory.path) memory.pathDirty = true;
          if (memory.frame) walk(memory.frame);
        }
      };
      walk(enemy.machine.rootFrame);
    }
  }, []);

  const api: AiWorldApi = {
    world: worldRef.current!,
    pack,
    enemies,
    issues,
    frame,
    controls,
    setControls,
    selected,
    select: setSelected,
    step: (seconds = FIXED_STEP) => {
      if (!worldRef.current) return;
      const steps = Math.max(1, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps; i += 1) advance();
      setFrame((f) => f + 1);
    },
    reset: () => {
      // Resetting a mounted scenario replays it from t=0 at the same seed.
      if (scenario) {
        loadScenario(scenario);
        return;
      }
      worldRef.current = construct(null, controlsRef.current.scene, controlsRef.current.daySection);
      setSelected(null);
      setFrame((f) => f + 1);
    },
    spawnEnemy: (defId, at) => {
      const world = worldRef.current;
      const def = pack.enemies[defId];
      if (!world || !def) return null;
      const enemy = world.addEnemy(def, {
        x: at?.x ?? (world.rng() - 0.5) * 1200,
        y: at?.y ?? (world.rng() - 0.5) * 1200,
        yaw: world.rng() * 360,
      });
      setSelected(enemy);
      setFrame((f) => f + 1);
      return enemy;
    },
    spawnPlayer: (at) => {
      const world = worldRef.current;
      if (!world) return;
      const player = world.addPlayer({ x: at?.x ?? 0, y: at?.y ?? 400, yaw: 0 });
      setSelected(player);
      setFrame((f) => f + 1);
    },
    spawnFurniture: (def, at, count = 1) => {
      const world = worldRef.current;
      if (!world) return;
      const probe = world.addEntity({ def, x: 1e6, y: 1e6 });
      const step = Math.max(probe.halfExtent * 1.8, 90);
      world.remove(probe);
      const cx = at?.x ?? 0;
      const cy = at?.y ?? 0;
      for (let i = 0; i < count; i += 1) {
        const offset = count === 1 ? 0 : (i - (count - 1) / 2) * step;
        world.addEntity({ def, x: cx, y: cy + offset });
      }
      invalidatePaths();
      setFrame((f) => f + 1);
    },
    remove: (actor) => {
      worldRef.current?.remove(actor);
      setSelected((s) => (s === actor ? null : s));
      invalidatePaths();
      setFrame((f) => f + 1);
    },
    clearFurniture: () => {
      const world = worldRef.current;
      if (!world) return;
      for (const entity of world.entities.slice()) world.remove(entity as EntityActor);
      invalidatePaths();
      setFrame((f) => f + 1);
    },
    invalidatePaths,
    rebuild,
    loadScenario,
    scenario,
  };

  // Console handle for scripted repros and the smoke harnesses:
  //   __aiLab.world, __aiLab.run(5), __aiLab.dump('Bone')
  if (typeof window !== 'undefined') {
    (window as any).__aiLab = {
      get world() {
        return worldRef.current;
      },
      api,
      run(seconds: number) {
        const world = worldRef.current;
        if (!world) return 0;
        const steps = Math.round(seconds / FIXED_STEP);
        for (let i = 0; i < steps; i += 1) advance();
        return world.time;
      },
      loadScenario,
      dump(name?: string) {
        const world = worldRef.current;
        const enemy = name
          ? world?.enemies.find((e) => e.label.toLowerCase().includes(name.toLowerCase()))
          : world?.enemies[0];
        if (!world || !enemy) return null;
        const f = enemy.machine.rootFrame;
        return {
          t: +world.time.toFixed(2),
          root: enemy.machine.activeRootName,
          path: f.activePath.map((i) => f.compiled.states[i].name),
          target: enemy.perception.target?.label ?? null,
          attack: enemy.machine.context['Attack.Tag'],
          attacks: enemy.machine.attackTrace.map((r) => `${r.label}: ${r.reason}`),
          sight: enemy.perception.sightRecords.map((r) => ({
            who: r.actor?.label,
            state: enemy.perception.recordState(r),
            progress: +r.strength.toFixed(2),
          })),
          pos: [Math.round(enemy.pos.x), Math.round(enemy.pos.y)],
        };
      },
    };
  }

  return api;
}
