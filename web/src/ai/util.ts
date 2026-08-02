// Shared maths for the AI sandbox. Everything works in Unreal units (uu) and degrees,
// like the game: +X forward, +Y right, yaw measured from +X.

export interface Vec2 {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-6 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Yaw in degrees for a direction vector. */
export const yawOf = (v: Vec2) => rad2deg(Math.atan2(v.y, v.x));
export const dirOf = (yawDeg: number): Vec2 => ({
  x: Math.cos(deg2rad(yawDeg)),
  y: Math.sin(deg2rad(yawDeg)),
});

/** Signed shortest delta from a to b, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Rotate `from` toward `to` by at most `maxStep` degrees. */
export function rotateToward(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Unsigned angle, degrees, between two direction vectors. */
export function angleBetween(a: Vec2, b: Vec2): number {
  return rad2deg(Math.acos(clamp(dot(norm(a), norm(b)), -1, 1)));
}

/** Segment/segment intersection — the LoS trace against a wall. */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Shortest distance from point p to segment ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return dist(p, a);
  const t = clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Deterministic PRNG so a scenario replays identically. */
export function makeRng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Derive a well-separated child seed from a parent seed and a stream index.
 *
 * Every agent gets its OWN random stream rather than sharing the world's, because a shared
 * stream couples agents that have nothing to do with each other: adding a second enemy to a
 * scenario shifts the first one's wander rolls and the scenario silently stops testing what
 * it was written to test. The splitmix32 finaliser is here (rather than `seed + index`)
 * because the xorshift above correlates badly for adjacent seeds.
 */
export function mixSeed(seed: number, stream: number): number {
  let h = (seed ^ (stream * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0 || 1;
}

/** FNV-1a over a string — used to seed off a scenario id and to digest world state. */
export function hashString(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const fmt = (n: number | null | undefined, dp = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(dp);

export const vecText = (v: Vec2 | null | undefined) =>
  v ? `${v.x.toFixed(0)}, ${v.y.toFixed(0)}` : '—';
