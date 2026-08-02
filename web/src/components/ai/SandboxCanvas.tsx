// Top-down world view: world XY straight to screen, +X right, +Y down, so the on-screen
// facing arrow matches the yaw the sim uses.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { clamp, deg2rad, dirOf, dist, sub, yawOf, type Vec2 } from '../../ai/util';
import type { Actor, EnemyActor, World } from '../../ai/sim';

export interface Overlays {
  cones: boolean;
  los: boolean;
  ranges: boolean;
  paths: boolean;
  poi: boolean;
  noise: boolean;
  hitboxes: boolean;
  labels: boolean;
  grid: boolean;
  navGrid: boolean;
}

export const DEFAULT_OVERLAYS: Overlays = {
  cones: true,
  los: true,
  ranges: true,
  paths: true,
  poi: true,
  noise: true,
  hitboxes: true,
  labels: true,
  grid: true,
  navGrid: false,
};

const C = {
  bg: '#0e1116',
  grid: '#191f28',
  gridMajor: '#232c38',
  wall: '#5b6675',
  furniture: '#6b5433',
  furnitureBroken: '#33291b',
  player: '#4ea3ff',
  enemy: '#ff6b5a',
  enemyPaused: '#7c6f6c',
  selected: '#ffd166',
  primaryCone: 'rgba(255, 107, 90, 0.10)',
  peripheralCone: 'rgba(255, 107, 90, 0.05)',
  autoDetect: 'rgba(255, 214, 102, 0.14)',
  observed: 'rgba(120, 220, 160, 0.10)',
  los: '#67e08a',
  losBlocked: '#4a5361',
  target: '#ff4d4d',
  poi: '#c084fc',
  anchor: '#38bdf8',
  path: 'rgba(255, 209, 102, 0.55)',
  text: '#d7dde5',
  dim: '#7b8594',
};

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Props {
  world: World;
  frame: number;
  overlays: Overlays;
  selected: Actor | null;
  onSelect: (a: Actor | null) => void;
  onMoved: () => void;
  camera: Camera;
  onCamera: (c: Camera) => void;
}

type PickMode = 'move' | 'rotate';
interface Pick {
  actor: Actor;
  mode: PickMode;
}

export function SandboxCanvas({
  world,
  frame,
  overlays,
  selected,
  onSelect,
  onMoved,
  camera,
  onCamera,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dragRef = useRef<
    | null
    | (Pick & { grabOffset: Vec2 })
    | { mode: 'pan'; from: Vec2; camera: Camera }
  >(null);
  const hoverRef = useRef<Pick | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const toScreen = useCallback(
    (p: Vec2): Vec2 => ({
      x: (p.x - cameraRef.current.x) * cameraRef.current.zoom + sizeRef.current.w / 2,
      y: (p.y - cameraRef.current.y) * cameraRef.current.zoom + sizeRef.current.h / 2,
    }),
    [],
  );
  const toWorld = useCallback(
    (p: Vec2): Vec2 => ({
      x: (p.x - sizeRef.current.w / 2) / cameraRef.current.zoom + cameraRef.current.x,
      y: (p.y - sizeRef.current.h / 2) / cameraRef.current.zoom + cameraRef.current.y,
    }),
    [],
  );

  const handleRadius = useCallback(
    (a: Actor) => Math.max(a.radius * cameraRef.current.zoom + 26, 34),
    [],
  );
  const handlePos = useCallback(
    (a: Actor): Vec2 => {
      const s = toScreen(a.pos);
      const d = dirOf(a.yaw);
      const r = handleRadius(a);
      return { x: s.x + d.x * r, y: s.y + d.y * r };
    },
    [toScreen, handleRadius],
  );

  const pick = useCallback(
    (point: Vec2): Pick | null => {
      const all: Actor[] = [...world.enemies, ...world.players, ...world.entities];
      // Rotation handles win over bodies so a zoomed-out view stays usable.
      for (const actor of all) {
        if (actor.isEntity) continue;
        if (dist(point, handlePos(actor)) <= 11) return { actor, mode: 'rotate' };
      }
      for (const actor of all) {
        const s = toScreen(actor.pos);
        const r = Math.max(actor.radius * cameraRef.current.zoom, 9);
        if (dist(point, s) <= r + 4) return { actor, mode: 'move' };
      }
      return null;
    },
    [world, handlePos, toScreen],
  );

  // --- sizing ---
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: rect.width, h: rect.height };
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // --- input ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const local = (e: PointerEvent | WheelEvent): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      const point = local(e);
      const hit = pick(point);
      canvas.setPointerCapture(e.pointerId);
      if (hit) {
        dragRef.current = { ...hit, grabOffset: sub(hit.actor.pos, toWorld(point)) };
        onSelect(hit.actor);
        return;
      }
      dragRef.current = { mode: 'pan', from: point, camera: { ...cameraRef.current } };
      onSelect(null);
    };

    const onMove = (e: PointerEvent) => {
      const point = local(e);
      const drag = dragRef.current;
      if (!drag) {
        hoverRef.current = pick(point);
        canvas.style.cursor = hoverRef.current
          ? hoverRef.current.mode === 'rotate'
            ? 'grab'
            : 'move'
          : 'default';
        return;
      }
      if (drag.mode === 'pan') {
        const dx = (point.x - drag.from.x) / cameraRef.current.zoom;
        const dy = (point.y - drag.from.y) / cameraRef.current.zoom;
        onCamera({ ...drag.camera, x: drag.camera.x - dx, y: drag.camera.y - dy });
        return;
      }
      const actor = drag.actor;
      const w = toWorld(point);
      if (drag.mode === 'move') {
        const want = { x: w.x + drag.grabOffset.x, y: w.y + drag.grabOffset.y };
        actor.pos = world.slideAgainstBlockers(actor.pos, want, actor.radius);
        if (actor.isEntity) world.navDirty = true;
        onMoved();
      } else {
        // Rotation handle: face the cursor.
        actor.yaw = yawOf(sub(w, actor.pos));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const before = toWorld(local(e));
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const zoom = clamp(cameraRef.current.zoom * factor, 0.02, 1.2);
      const next = { ...cameraRef.current, zoom };
      cameraRef.current = next;
      const after = toWorld(local(e));
      onCamera({ ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y });
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [pick, toWorld, onSelect, onCamera, onMoved, world]);

  // --- draw ---
  //
  // Its own rAF loop, reading the mutable world directly. React re-renders this component
  // only ~10x a second (see PANEL_HZ), which would make the view stutter badly if drawing
  // were tied to the render.
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  function draw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { w: viewW, h: viewH } = sizeRef.current;
    if (!viewW || !viewH) return;
    const overlays = overlaysRef.current;
    const selected = selectedRef.current;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, viewW, viewH);

    const z = cameraRef.current.zoom;

    if (overlays.grid) {
      const step = 500;
      const tl = toWorld({ x: 0, y: 0 });
      const br = toWorld({ x: viewW, y: viewH });
      ctx.lineWidth = 1;
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = toScreen({ x, y: 0 });
        ctx.strokeStyle = x % 2500 === 0 ? C.gridMajor : C.grid;
        ctx.beginPath();
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, viewH);
        ctx.stroke();
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        const s = toScreen({ x: 0, y });
        ctx.strokeStyle = y % 2500 === 0 ? C.gridMajor : C.grid;
        ctx.beginPath();
        ctx.moveTo(0, s.y);
        ctx.lineTo(viewW, s.y);
        ctx.stroke();
      }
    }

    if (overlays.navGrid) {
      if (world.navDirty) world.buildNavGrid();
      const cell = 100 * z;
      for (let row = 0; row < world.navRows; row += 1) {
        for (let col = 0; col < world.navCols; col += 1) {
          const i = row * world.navCols + col;
          const blocked = world.navBlocked[i];
          const furniture = world.navFurniture[i];
          if (!blocked && !furniture) continue;
          const s = toScreen(world.cellCentre(col, row));
          ctx.fillStyle = blocked ? 'rgba(120,130,145,0.25)' : 'rgba(200,150,60,0.18)';
          ctx.fillRect(s.x - cell / 2, s.y - cell / 2, cell, cell);
        }
      }
    }

    // Bounds.
    {
      const tl = toScreen({ x: world.bounds.minX, y: world.bounds.minY });
      const br = toScreen({ x: world.bounds.maxX, y: world.bounds.maxY });
      ctx.strokeStyle = C.gridMajor;
      ctx.lineWidth = 2;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    if (overlays.cones) {
      for (const enemy of world.enemies) {
        const sight = enemy.perception.profile.sight;
        const centre = toScreen(enemy.pos);
        const yaw = deg2rad(enemy.yaw);
        const wedge = (range: number, halfAngle: number, fill: string) => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.moveTo(centre.x, centre.y);
          ctx.arc(centre.x, centre.y, range * z, yaw - deg2rad(halfAngle), yaw + deg2rad(halfAngle));
          ctx.closePath();
          ctx.fill();
        };
        wedge(sight.peripheral_range, sight.peripheral_cone_angle / 2, C.peripheralCone);
        wedge(sight.range, sight.cone_angle / 2, C.primaryCone);
        ctx.fillStyle = C.autoDetect;
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, sight.auto_detect_radius * z, 0, Math.PI * 2);
        ctx.fill();
      }
      // The player's own view cone — only meaningful when something runs the observed sense.
      if (world.enemies.some((e) => e.perception.profile.observed?.enabled)) {
        for (const player of world.players) {
          const centre = toScreen(player.pos);
          const yaw = deg2rad(player.yaw);
          ctx.fillStyle = C.observed;
          ctx.beginPath();
          ctx.moveTo(centre.x, centre.y);
          ctx.arc(centre.x, centre.y, 8000 * z, yaw - deg2rad(50), yaw + deg2rad(50));
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Walls.
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = Math.max(3, 20 * z);
    ctx.lineCap = 'round';
    for (const wall of world.walls) {
      const a = toScreen(wall.a);
      const b = toScreen(wall.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // Furniture.
    for (const entity of world.entities) {
      const s = toScreen(entity.pos);
      const half = entity.halfExtent * z;
      ctx.fillStyle = entity.dead ? C.furnitureBroken : C.furniture;
      ctx.fillRect(s.x - half, s.y - half, half * 2, half * 2);
      ctx.strokeStyle = entity === selected ? C.selected : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = entity === selected ? 2 : 1;
      ctx.strokeRect(s.x - half, s.y - half, half * 2, half * 2);
      if (overlays.labels && !entity.dead) {
        ctx.fillStyle = C.dim;
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${entity.label} ${Math.round(entity.health)}`, s.x, s.y - half - 4);
      }
    }

    if (overlays.paths) {
      for (const enemy of world.enemies) {
        if (selected && selected !== enemy) continue;
        const path = livePath(enemy);
        if (!path?.points.length) continue;
        ctx.strokeStyle = C.path;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        const first = toScreen(enemy.pos);
        ctx.moveTo(first.x, first.y);
        for (const point of path.points) {
          const s = toScreen(point);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (path.blockedBy) {
          const s = toScreen(path.blockedBy.pos);
          ctx.strokeStyle = '#ff9f43';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    if (overlays.noise && world.lastNoise) {
      const age = world.time - world.lastNoise.at;
      if (age <= 1.2) {
        const s = toScreen(world.lastNoise.location);
        ctx.strokeStyle = `rgba(160, 200, 255, ${0.5 * (1 - age / 1.2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, world.lastNoise.range * z * (age / 1.2), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (overlays.poi) {
      for (const enemy of world.enemies) {
        if (selected && selected !== enemy) continue;
        const poi = toScreen(enemy.perception.pointOfInterest);
        ctx.strokeStyle = C.poi;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(poi.x, poi.y, 8, 0, Math.PI * 2);
        ctx.moveTo(poi.x - 12, poi.y);
        ctx.lineTo(poi.x + 12, poi.y);
        ctx.moveTo(poi.x, poi.y - 12);
        ctx.lineTo(poi.x, poi.y + 12);
        ctx.stroke();

        const anchor = toScreen(enemy.perception.patrolAnchor);
        ctx.strokeStyle = C.anchor;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (overlays.los) {
      for (const enemy of world.enemies) {
        if (selected && selected !== enemy) continue;
        const from = toScreen(enemy.pos);
        for (const record of enemy.perception.sightRecords) {
          const state = enemy.perception.recordState(record);
          const to = toScreen(record.actor.pos);
          const lkp = toScreen(record.lastKnownLocation);
          if (state === 'Spotted') {
            ctx.strokeStyle = C.los;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
          } else if (state === 'Glimpsed') {
            ctx.strokeStyle = `rgba(255, 214, 102, ${0.25 + record.strength * 0.6})`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
          } else {
            ctx.strokeStyle = C.losBlocked;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 6]);
          }
          const end = state === 'Remembered' ? lkp : to;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (state === 'Remembered') {
            ctx.strokeStyle = 'rgba(103, 224, 138, 0.5)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(lkp.x, lkp.y, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (!record.spotted && record.strength > 0.01) {
            ctx.strokeStyle = '#ffd166';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(to.x, to.y, 18, -Math.PI / 2, -Math.PI / 2 + record.strength * Math.PI * 2);
            ctx.stroke();
          }
        }
        if (enemy.perception.target) {
          const to = toScreen(enemy.perception.target.pos);
          ctx.strokeStyle = C.target;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
      }
    }

    if (overlays.ranges && selected?.isEnemy) {
      const enemy = selected as EnemyActor;
      const centre = toScreen(enemy.pos);
      for (const row of enemy.machine.attackTrace) {
        if (!row.maxRange || row.maxRange <= 0) continue;
        ctx.strokeStyle = row.eligible ? 'rgba(103, 224, 138, 0.55)' : 'rgba(120, 130, 145, 0.30)';
        ctx.lineWidth = row.eligible ? 2 : 1;
        ctx.setLineDash(row.eligible ? [] : [4, 6]);
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, row.maxRange * z, 0, Math.PI * 2);
        ctx.stroke();
        if (row.minRange && row.minRange > 0) {
          ctx.beginPath();
          ctx.arc(centre.x, centre.y, row.minRange * z, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      const envelope = enemy.machine.context['Attack.MaxRange'];
      if (envelope > 0) {
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.7)';
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, envelope * z, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (overlays.hitboxes) {
      for (const marker of world.hitMarkers) {
        const age = (world.time - marker.at) / 0.4;
        const s = toScreen(marker.pos);
        if (marker.reach) {
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(deg2rad(marker.yaw ?? 0));
          ctx.fillStyle = `rgba(255, 80, 80, ${0.35 * (1 - age)})`;
          ctx.fillRect(
            -(marker.reach * z) / 2,
            -(marker.halfWidth ?? 50) * z,
            marker.reach * z,
            (marker.halfWidth ?? 50) * 2 * z,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = marker.dead
            ? `rgba(140, 140, 140, ${0.5 * (1 - age)})`
            : `rgba(255, 120, 80, ${0.6 * (1 - age)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 14 * (1 + age), 0, Math.PI * 2);
          ctx.fill();
          if (marker.label) {
            ctx.fillStyle = `rgba(220,220,220,${1 - age})`;
            ctx.font = '10px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(marker.label, s.x, s.y - 18);
          }
        }
      }
    }

    ctx.fillStyle = '#ffd166';
    for (const projectile of world.projectiles) {
      const s = toScreen(projectile.pos);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const drawPawn = (actor: Actor, color: string) => {
      const s = toScreen(actor.pos);
      const r = Math.max(actor.radius * z, 8);
      if (actor.isPlayer && world.time < (actor.grabbedUntil ?? -1)) {
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (actor === selected) {
        ctx.strokeStyle = C.selected;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      const d = dirOf(actor.yaw);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + d.x * r, s.y + d.y * r);
      ctx.stroke();

      // Rotation handle.
      const h = handlePos(actor);
      const active = hoverRef.current?.actor === actor && hoverRef.current?.mode === 'rotate';
      ctx.strokeStyle = active ? C.selected : 'rgba(215, 221, 229, 0.45)';
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      const left = { x: -d.y, y: d.x };
      ctx.fillStyle = active ? C.selected : 'rgba(215, 221, 229, 0.75)';
      ctx.beginPath();
      ctx.moveTo(h.x + d.x * 9, h.y + d.y * 9);
      ctx.lineTo(h.x + left.x * 6 - d.x * 4, h.y + left.y * 6 - d.y * 4);
      ctx.lineTo(h.x - left.x * 6 - d.x * 4, h.y - left.y * 6 - d.y * 4);
      ctx.closePath();
      ctx.fill();

      if (overlays.labels) {
        ctx.fillStyle = C.text;
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(actor.label, s.x, s.y - r - 8);
      }
      if (actor.isPlayer) {
        const flags = [actor.stealthed && 'STEALTH', (actor as any).crouched && 'crouch']
          .filter(Boolean)
          .join(' ');
        if (flags) {
          ctx.fillStyle = C.dim;
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(flags, s.x, s.y + r + 14);
        }
      }
      return { s, r };
    };

    for (const player of world.players) drawPawn(player, C.player);

    for (const enemy of world.enemies) {
      const color = enemy.dead ? '#3a2b2b' : enemy.paused ? C.enemyPaused : C.enemy;
      const { s, r } = drawPawn(enemy, color);

      if (enemy.healthPct < 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(s.x - 18, s.y + r + 5, 36, 4);
        ctx.fillStyle = enemy.healthPct < 0.5 ? '#ff6b5a' : '#67e08a';
        ctx.fillRect(s.x - 18, s.y + r + 5, 36 * enemy.healthPct, 4);
      }
      if (overlays.labels) {
        const root = enemy.machine.activeRootName || '—';
        const path = enemy.machine.rootFrame.activePath;
        const leaf = path.length
          ? enemy.machine.rootFrame.compiled.states[path[path.length - 1]].name
          : '';
        ctx.fillStyle = enemy.paused ? '#ffd166' : C.dim;
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        const label = leaf && leaf !== root ? `${root}/${leaf}` : root;
        ctx.fillText(
          enemy.paused ? `⏸ ${label}` : label,
          s.x,
          s.y + r + (enemy.healthPct < 1 ? 20 : 16),
        );
      }
      if (enemy.casting) {
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 3;
        const progress = clamp(
          1 - (enemy.casting.endsAt - world.time) / Math.max(enemy.casting.ability.montageSeconds, 0.1),
          0,
          1,
        );
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 7, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
      }
      if (world.coordinator.hasToken(enemy)) {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(s.x + r + 6, s.y - r - 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Scale bar.
    const px = 1000 * z;
    const bx = 16;
    const by = viewH - 20;
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px, by);
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + px, by - 4);
    ctx.lineTo(bx + px, by + 4);
    ctx.stroke();
    ctx.fillStyle = C.dim;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('1000 uu', bx + px + 6, by + 3);
  }

  // `frame` is no longer what drives drawing — the rAF loop above does. It stays on the
  // props so the parent's re-render cadence is still explicit at the call site.
  void frame;

  return <canvas ref={canvasRef} className="ai-canvas" />;
}

/** Dig the live move_to/wander path out of the machine's action memory. */
export function livePath(enemy: EnemyActor) {
  const frames: any[] = [];
  const walk = (frame: any) => {
    if (!frame) return;
    frames.push(frame);
    for (const memory of frame.memory.values()) if (memory.frame) walk(memory.frame);
  };
  walk(enemy.machine.rootFrame);
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    for (const memory of frames[i].memory.values()) {
      if (memory.path?.points?.length) return memory.path;
    }
  }
  return null;
}
