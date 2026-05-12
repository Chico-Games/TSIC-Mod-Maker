/** Mulberry32 PRNG. Deterministic same-seed → same sequence within the web
 *  editor. NOT byte-compatible with Unreal's FRandomStream — runtime
 *  determinism stays Unreal-side; the web editor is for authoring. */

export type RandomStream = { state: number };

export function makeStream(seed: number): RandomStream {
  // Mulberry32 needs a non-zero 32-bit seed.
  const s = (seed | 0) || 1;
  return { state: s >>> 0 };
}

export function pickFloat(s: RandomStream): number {
  s.state = (s.state + 0x6D2B79F5) | 0;
  let t = s.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pickIndex(s: RandomStream, length: number): number {
  if (length <= 0) return -1;
  return Math.floor(pickFloat(s) * length);
}

export function pickInRange(s: RandomStream, min: number, max: number): number {
  return min + pickFloat(s) * (max - min);
}
