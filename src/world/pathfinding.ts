/** A* over the office tile grid with wall-edge blocking, plus path smoothing. */
import type { Point } from '../net/model';
import { type NavGrid, T } from './layout';

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414],
];

function canStep(g: NavGrid, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) return false;
  if (g.blocked[ny * g.w + nx]) return false;
  const edgeOk = (ax: number, ay: number, ddx: number, ddy: number) => {
    if (ddx === 1) return !(g.edges[ay * g.w + ax] & 1);
    if (ddx === -1) return !(g.edges[ay * g.w + (ax - 1)] & 1);
    if (ddy === 1) return !(g.edges[ay * g.w + ax] & 2);
    if (ddy === -1) return !(g.edges[(ay - 1) * g.w + ax] & 2);
    return true;
  };
  if (dx !== 0 && dy !== 0) {
    // diagonal: both orthogonal moves must be legal (no corner cutting)
    return canStep(g, x, y, dx, 0) && canStep(g, x, y, 0, dy) && canStep(g, x + dx, y, 0, dy) && canStep(g, x, y + dy, dx, 0);
  }
  return edgeOk(x, y, dx, dy);
}

function nearestFree(g: NavGrid, x: number, y: number): [number, number] {
  if (x >= 0 && y >= 0 && x < g.w && y < g.h && !g.blocked[y * g.w + x]) return [x, y];
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        if (!g.blocked[ny * g.w + nx]) return [nx, ny];
      }
  }
  return [Math.max(0, Math.min(g.w - 1, x)), Math.max(0, Math.min(g.h - 1, y))];
}

const cache = new Map<string, Point[]>();

export function findPath(g: NavGrid, from: Point, to: Point): Point[] {
  const [sx, sy] = nearestFree(g, Math.floor(from.x / T), Math.floor(from.y / T));
  const [tx, ty] = nearestFree(g, Math.floor(to.x / T), Math.floor(to.y / T));
  const key = `${sx},${sy}>${tx},${ty}`;
  const hit = cache.get(key);
  if (hit) return [...hit.map((p) => ({ ...p })), { ...to }];
  const W = g.w;
  const N = g.w * g.h;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = sy * W + sx;
  const goal = ty * W + tx;
  gScore[start] = 0;
  // binary heap of [f, idx]
  const heap: number[][] = [[0, start]];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const h = (i: number) => {
    const x = i % W;
    const y = (i / W) | 0;
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  let found = false;
  while (heap.length) {
    const [, cur] = pop();
    if (cur === goal) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const x = cur % W;
    const y = (cur / W) | 0;
    for (const [dx, dy, cost] of DIRS) {
      if (!canStep(g, x, y, dx, dy)) continue;
      const n = (y + dy) * W + (x + dx);
      if (closed[n]) continue;
      const ng = gScore[cur] + cost;
      if (ng < gScore[n]) {
        gScore[n] = ng;
        came[n] = cur;
        push(ng + h(n), n);
      }
    }
  }
  if (!found) return [{ ...to }];
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: (c % W) * T + T / 2, y: ((c / W) | 0) * T + T / 2 }));
  const smooth = smoothPath(g, pts);
  if (cache.size > 4000) cache.clear();
  cache.set(key, smooth);
  return [...smooth.map((p) => ({ ...p })), { ...to }];
}

/** Line-of-sight check: sample along the segment, verify each tile transition is a legal step. */
function lineClear(g: NavGrid, a: Point, b: Point): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(dist / 6);
  let px = Math.floor(a.x / T);
  let py = Math.floor(a.y / T);
  for (let k = 1; k <= steps; k++) {
    const x = a.x + ((b.x - a.x) * k) / steps;
    const y = a.y + ((b.y - a.y) * k) / steps;
    // keep a little clearance from blocked tiles
    for (const [ox, oy] of [
      [5, 5],
      [-5, 5],
      [5, -5],
      [-5, -5],
    ]) {
      const cx = Math.floor((x + ox) / T);
      const cy = Math.floor((y + oy) / T);
      if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h || g.blocked[cy * g.w + cx]) return false;
    }
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    if (tx !== px || ty !== py) {
      const dx = Math.sign(tx - px);
      const dy = Math.sign(ty - py);
      if (!canStep(g, px, py, dx, dy)) return false;
      px = tx;
      py = ty;
    }
  }
  return true;
}

function smoothPath(g: NavGrid, pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const out: Point[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineClear(g, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
