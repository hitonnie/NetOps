/**
 * Small seeded PRNG (mulberry32). The state is a single uint32 so it can be
 * stored in the save game, which keeps incident generation reproducible.
 */
export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: seed >>> 0 || 0x9e3779b9 };
}

export function next(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(r: RngState, min: number, max: number): number {
  return min + next(r) * (max - min);
}

export function int(r: RngState, min: number, maxInclusive: number): number {
  return Math.floor(range(r, min, maxInclusive + 1));
}

export function chance(r: RngState, p: number): boolean {
  return next(r) < p;
}

export function pick<T>(r: RngState, arr: readonly T[]): T {
  return arr[Math.floor(next(r) * arr.length)];
}

export function shuffle<T>(r: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Approximate normal distribution (Box–Muller). */
export function normal(r: RngState, mean: number, sd: number): number {
  const u = Math.max(1e-9, next(r));
  const v = next(r);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function weighted<T>(r: RngState, items: readonly { item: T; weight: number }[]): T | undefined {
  const total = items.reduce((a, b) => a + Math.max(0, b.weight), 0);
  if (total <= 0) return undefined;
  let x = next(r) * total;
  for (const it of items) {
    x -= Math.max(0, it.weight);
    if (x <= 0) return it.item;
  }
  return items[items.length - 1].item;
}

/** Deterministic string hash (FNV-1a) used for stable per-flow choices. */
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
