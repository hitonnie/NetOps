/**
 * Cosmetic street life around the office: four streets with signalised corner
 * intersections, moving cars and a staff car park. Purely visual — it never
 * touches game state, and it is seeded so it looks the same on every load.
 */
import type { EmployeeState } from '../sim/types';
import { BH, BW, T } from '../world/layout';
import { roundRect, shade } from './sprites';

const SIDEWALK = 0.8 * T;
const EXT = 70 * T; // streets run this far past the building, well beyond the camera limits

/** Street geometry in world px. Each street is two lanes, right-hand traffic. */
export const ROADS = {
  top: { a: -4.8 * T, b: -0.8 * T },
  bottom: { a: (BH + 5.6) * T, b: (BH + 9.6) * T },
  left: { a: -4.8 * T, b: -0.8 * T },
  right: { a: (BW + 0.8) * T, b: (BW + 4.8) * T },
};
const H_MIN = -EXT;
const H_MAX = BW * T + EXT;
const V_MIN = -EXT;
const V_MAX = BH * T + EXT;

/** Staff car park between the building and the bottom street. */
export const LOT = { x0: 14 * T, x1: 44 * T, y0: (BH + 0.9) * T, y1: (BH + 4.8) * T, slotW: 1.5 * T, slotD: 2.4 * T };
const LOT_SLOTS = Math.floor((LOT.x1 - LOT.x0) / LOT.slotW);
export const DRIVEWAY = { x0: LOT.x1 - 3.4 * T, x1: LOT.x1 - 0.4 * T };

// Intersections: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
const BOXES = [
  { x: ROADS.left, y: ROADS.top },
  { x: ROADS.right, y: ROADS.top },
  { x: ROADS.left, y: ROADS.bottom },
  { x: ROADS.right, y: ROADS.bottom },
];

// Signal timing (seconds): green, yellow, all-red, per axis
const G = 7;
const Y = 2;
const AR = 1.5;
const PERIOD = 2 * (G + Y + AR);
type Signal = 'g' | 'y' | 'r';
function signal(box: number, axis: 'h' | 'v', clock: number): Signal {
  const t = (((clock + box * 5.25) % PERIOD) + PERIOD) % PERIOD;
  const tt = axis === 'h' ? t : (t - (G + Y + AR) + PERIOD) % PERIOD;
  return tt < G ? 'g' : tt < G + Y ? 'y' : 'r';
}

type Kind = 'sedan' | 'hatch' | 'van' | 'taxi' | 'bus';
interface Car {
  u: number; // distance travelled along the lane, 0..len
  v: number; // px/s
  vmax: number;
  len: number;
  wid: number;
  color: string;
  kind: Kind;
}
interface Lane {
  axis: 'h' | 'v';
  dir: 1 | -1;
  c: number; // lane centre line (y for horizontal, x for vertical)
  min: number;
  max: number;
  len: number;
  stops: { u: number; box: number }[];
  cars: Car[]; // kept in travel order; cars never overtake
}

const COLORS = ['#e5534b', '#3d8de4', '#f4f3ee', '#2d3540', '#f0a23b', '#5bb36a', '#9b6ad6', '#c3cad3', '#d9454f', '#2fa5a0', '#7a8794', '#ef7fa8'];
const SIZE: Record<Kind, [number, number]> = { sedan: [50, 24], hatch: [42, 23], van: [58, 27], taxi: [50, 24], bus: [104, 30] };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCar(r: () => number, allowBus: boolean): Car {
  const x = r();
  const kind: Kind = allowBus && x < 0.07 ? 'bus' : x < 0.45 ? 'sedan' : x < 0.68 ? 'hatch' : x < 0.84 ? 'van' : 'taxi';
  const [len, wid] = SIZE[kind];
  const vmax = kind === 'bus' ? 62 : 78 + r() * 36;
  const color = kind === 'taxi' ? '#f6c445' : kind === 'bus' ? (r() < 0.5 ? '#e9573f' : '#2f7fd8') : COLORS[Math.floor(r() * COLORS.length)];
  return { u: 0, v: vmax, vmax, len, wid, color, kind };
}

export class Traffic {
  private lanes: Lane[] = [];
  private clock = 0;
  private parked: { color: string; kind: Kind }[] = [];

  constructor(seed = 20261017) {
    const r = rng(seed);
    const addLane = (axis: 'h' | 'v', dir: 1 | -1, road: { a: number; b: number }, half: 0 | 1, boxes: number[], n: number, bus: boolean) => {
      const w = road.b - road.a;
      const min = axis === 'h' ? H_MIN : V_MIN;
      const max = axis === 'h' ? H_MAX : V_MAX;
      const len = max - min;
      const stops = boxes.map((box) => {
        const span = axis === 'h' ? BOXES[box].x : BOXES[box].y;
        const entry = dir > 0 ? span.a - min : max - span.b;
        return { u: entry - 1.15 * T, box };
      });
      const cars: Car[] = [];
      for (let i = 0; i < n; i++) {
        const car = makeCar(r, bus);
        car.u = ((i + 0.15 + r() * 0.6) / n) * len;
        // never start inside an intersection
        for (const s of stops) if (car.u + car.len / 2 > s.u && car.u - car.len / 2 < s.u + 1.15 * T + w + 1.15 * T) car.u = s.u + w + 2.6 * T + car.len / 2;
        cars.push(car);
      }
      cars.sort((p, q) => p.u - q.u);
      this.lanes.push({ axis, dir, c: road.a + (half ? 0.75 : 0.25) * w, min, max, len, stops, cars });
    };
    // horizontal streets: westbound in the upper lane, eastbound in the lower lane
    addLane('h', -1, ROADS.top, 0, [1, 0], 8, true);
    addLane('h', 1, ROADS.top, 1, [0, 1], 8, false);
    addLane('h', -1, ROADS.bottom, 0, [3, 2], 8, false);
    addLane('h', 1, ROADS.bottom, 1, [2, 3], 8, true);
    // vertical streets: southbound in the western lane, northbound in the eastern lane
    addLane('v', 1, ROADS.left, 0, [0, 2], 8, false);
    addLane('v', -1, ROADS.left, 1, [2, 0], 8, false);
    addLane('v', 1, ROADS.right, 0, [1, 3], 8, false);
    addLane('v', -1, ROADS.right, 1, [3, 1], 8, true);
    for (let i = 0; i < LOT_SLOTS; i++) {
      const c = makeCar(r, false);
      this.parked.push({ color: c.color, kind: c.kind });
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    for (const lane of this.lanes) {
      const n = lane.cars.length;
      for (let i = 0; i < n; i++) {
        const c = lane.cars[i];
        let free = Infinity;
        if (n > 1) {
          const a = lane.cars[(i + 1) % n];
          free = ((a.u - c.u + lane.len) % lane.len) - (a.len + c.len) / 2 - 9;
        }
        const front = c.u + c.len / 2;
        for (const st of lane.stops) {
          const d = st.u - front;
          if (d < -3 || d > 240) continue;
          const sig = signal(st.box, lane.axis, this.clock);
          if (sig === 'r' || (sig === 'y' && d > 16)) free = Math.min(free, d);
        }
        const target = Math.max(0, Math.min(c.vmax, free * 1.7));
        c.v = target > c.v ? Math.min(target, c.v + 55 * dt) : Math.max(target, c.v - 340 * dt);
      }
      for (const c of lane.cars) c.u = (c.u + c.v * dt) % lane.len;
    }
  }

  // ---------------------------------------------------------------- drawing

  /** Streets, sidewalks, crossings and signals — drawn under everything else. */
  drawStreets(ctx: CanvasRenderingContext2D): void {
    const { top, bottom, left, right } = ROADS;
    const hRoads = [top, bottom];
    const vRoads = [left, right];
    // sidewalks with a curb
    ctx.fillStyle = '#b8c2c9';
    for (const r of hRoads) ctx.fillRect(H_MIN, r.a - SIDEWALK - 2, H_MAX - H_MIN, r.b - r.a + 2 * SIDEWALK + 4);
    for (const r of vRoads) ctx.fillRect(r.a - SIDEWALK - 2, V_MIN, r.b - r.a + 2 * SIDEWALK + 4, V_MAX - V_MIN);
    ctx.fillStyle = '#dde3e7';
    for (const r of hRoads) ctx.fillRect(H_MIN, r.a - SIDEWALK, H_MAX - H_MIN, r.b - r.a + 2 * SIDEWALK);
    for (const r of vRoads) ctx.fillRect(r.a - SIDEWALK, V_MIN, r.b - r.a + 2 * SIDEWALK, V_MAX - V_MIN);
    // paving joints
    ctx.strokeStyle = 'rgba(150,165,175,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -60 * T; x < (BW + 60) * T; x += T) {
      for (const r of hRoads) {
        ctx.moveTo(x, r.a - SIDEWALK);
        ctx.lineTo(x, r.a);
        ctx.moveTo(x, r.b);
        ctx.lineTo(x, r.b + SIDEWALK);
      }
    }
    for (let y = -60 * T; y < (BH + 60) * T; y += T) {
      for (const r of vRoads) {
        ctx.moveTo(r.a - SIDEWALK, y);
        ctx.lineTo(r.a, y);
        ctx.moveTo(r.b, y);
        ctx.lineTo(r.b + SIDEWALK, y);
      }
    }
    ctx.stroke();
    // asphalt
    ctx.fillStyle = '#5f6872';
    for (const r of hRoads) ctx.fillRect(H_MIN, r.a, H_MAX - H_MIN, r.b - r.a);
    for (const r of vRoads) ctx.fillRect(r.a, V_MIN, r.b - r.a, V_MAX - V_MIN);
    // centre lines (double yellow), broken at the intersections
    ctx.strokeStyle = '#f3c34a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const gapH = [H_MIN, left.a - 1.2 * T, left.b + 1.2 * T, right.a - 1.2 * T, right.b + 1.2 * T, H_MAX];
    const gapV = [V_MIN, top.a - 1.2 * T, top.b + 1.2 * T, bottom.a - 1.2 * T, bottom.b + 1.2 * T, V_MAX];
    for (const r of hRoads) {
      const m = (r.a + r.b) / 2;
      for (let k = 0; k < gapH.length; k += 2) {
        for (const o of [-2, 2]) {
          ctx.moveTo(gapH[k], m + o);
          ctx.lineTo(gapH[k + 1], m + o);
        }
      }
    }
    for (const r of vRoads) {
      const m = (r.a + r.b) / 2;
      for (let k = 0; k < gapV.length; k += 2) {
        for (const o of [-2, 2]) {
          ctx.moveTo(m + o, gapV[k]);
          ctx.lineTo(m + o, gapV[k + 1]);
        }
      }
    }
    ctx.stroke();
    // zebra crossings on every approach + stop lines
    ctx.fillStyle = '#f4f3ee';
    for (const b of BOXES) {
      const zw = 0.8 * T;
      for (let y = b.y.a + 4; y < b.y.b - 4; y += 12) {
        ctx.fillRect(b.x.a - zw - 0.2 * T, y, zw, 6);
        ctx.fillRect(b.x.b + 0.2 * T, y, zw, 6);
      }
      for (let x = b.x.a + 4; x < b.x.b - 4; x += 12) {
        ctx.fillRect(x, b.y.a - zw - 0.2 * T, 6, zw);
        ctx.fillRect(x, b.y.b + 0.2 * T, 6, zw);
      }
      const mY = (b.y.a + b.y.b) / 2;
      const mX = (b.x.a + b.x.b) / 2;
      ctx.fillRect(b.x.a - 1.15 * T - 3, mY, 3, b.y.b - mY); // eastbound
      ctx.fillRect(b.x.b + 1.15 * T, b.y.a, 3, mY - b.y.a); // westbound
      ctx.fillRect(b.x.a, b.y.a - 1.15 * T - 3, mX - b.x.a, 3); // southbound
      ctx.fillRect(mX, b.y.b + 1.15 * T, b.x.b - mX, 3); // northbound
    }
    // traffic signals: one head per axis on opposite corners
    BOXES.forEach((b, i) => {
      this.signalHead(ctx, b.x.a - 0.4 * T, b.y.a - 0.4 * T, 'h', signal(i, 'h', this.clock));
      this.signalHead(ctx, b.x.b + 0.4 * T, b.y.b + 0.4 * T, 'h', signal(i, 'h', this.clock));
      this.signalHead(ctx, b.x.b + 0.4 * T, b.y.a - 0.4 * T, 'v', signal(i, 'v', this.clock));
      this.signalHead(ctx, b.x.a - 0.4 * T, b.y.b + 0.4 * T, 'v', signal(i, 'v', this.clock));
    });
    // street lamps along the building-side sidewalks
    for (const p of lampPositions()) {
      ctx.fillStyle = 'rgba(30,40,50,0.25)';
      ctx.beginPath();
      ctx.arc(p.x + 2, p.y + 3, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a5560';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4c2';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private signalHead(ctx: CanvasRenderingContext2D, x: number, y: number, axis: 'h' | 'v', s: Signal): void {
    const long = 21;
    const short = 9;
    const w = axis === 'h' ? long : short;
    const h = axis === 'h' ? short : long;
    ctx.fillStyle = 'rgba(30,40,50,0.25)';
    roundRect(ctx, x - w / 2 + 2, y - h / 2 + 2, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#2d3540';
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 4);
    ctx.fill();
    const cols: [Signal, string, string][] = [
      ['r', '#ff4d4d', '#5a2a2a'],
      ['y', '#ffc94d', '#5a4a24'],
      ['g', '#4dde7a', '#244a30'],
    ];
    cols.forEach(([k, on, off], i) => {
      const o = (i - 1) * 6.5;
      ctx.fillStyle = s === k ? on : off;
      ctx.beginPath();
      ctx.arc(axis === 'h' ? x + o : x, axis === 'h' ? y : y + o, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /** Parked staff cars (one slot per early employee) and moving traffic. */
  drawCars(ctx: CanvasRenderingContext2D, employees: EmployeeState[]): void {
    for (let i = 0; i < LOT_SLOTS; i++) {
      if (!employees[i]?.present) continue;
      const p = this.parked[i];
      const [len, wid] = SIZE[p.kind];
      const x = LOT.x0 + (i + 0.5) * LOT.slotW;
      const y = LOT.y0 + 0.2 * T + LOT.slotD / 2;
      drawCar(ctx, x, y, -Math.PI / 2, { len, wid, color: p.color, kind: p.kind });
    }
    for (const lane of this.lanes) {
      for (const c of lane.cars) {
        const { x, y, a } = carPose(lane, c);
        drawCar(ctx, x, y, a, c);
      }
    }
  }

  /** Headlights, tail-lights and street-lamp glow, drawn after the night tint. */
  drawNightLights(ctx: CanvasRenderingContext2D, dark: number): void {
    if (dark <= 0.05) return;
    ctx.save();
    // light stays outdoors: clip the building out
    ctx.beginPath();
    ctx.rect(-EXT, -EXT, BW * T + 2 * EXT, BH * T + 2 * EXT);
    ctx.rect(-4, -4, BW * T + 8, BH * T + 8);
    ctx.clip('evenodd');
    ctx.globalCompositeOperation = 'lighter';
    for (const p of lampPositions()) {
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 2.4 * T);
      g.addColorStop(0, `rgba(255,220,140,${0.42 * dark})`);
      g.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 2.4 * T, p.y - 2.4 * T, 4.8 * T, 4.8 * T);
    }
    for (const lane of this.lanes) {
      for (const c of lane.cars) {
        const { x, y, a } = carPose(lane, c);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(c.len / 2, 0, c.len / 2 + 70, 0);
        g.addColorStop(0, `rgba(255,244,190,${0.5 * dark})`);
        g.addColorStop(1, 'rgba(255,244,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(c.len / 2 - 2, -c.wid / 2 + 3);
        ctx.lineTo(c.len / 2 + 70, -c.wid / 2 - 14);
        ctx.lineTo(c.len / 2 + 70, c.wid / 2 + 14);
        ctx.lineTo(c.len / 2 - 2, c.wid / 2 - 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(255,60,60,${(c.v < 8 ? 0.75 : 0.45) * dark})`;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(-c.len / 2 - 1, s * (c.wid / 2 - 4), c.v < 8 ? 5 : 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

function carPose(lane: Lane, c: Car): { x: number; y: number; a: number } {
  const s = lane.dir > 0 ? lane.min + c.u : lane.max - c.u;
  if (lane.axis === 'h') return { x: s, y: lane.c, a: lane.dir > 0 ? 0 : Math.PI };
  return { x: lane.c, y: s, a: lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

let lamps: { x: number; y: number }[] | null = null;
function lampPositions(): { x: number; y: number }[] {
  if (lamps) return lamps;
  lamps = [];
  const off = SIDEWALK / 2;
  for (let x = -1; x <= BW + 1; x += 8) {
    lamps.push({ x: x * T + 2 * T, y: ROADS.top.b + off });
    lamps.push({ x: x * T + 2 * T, y: ROADS.bottom.a - off });
  }
  for (let y = 2; y <= BH + 3; y += 8) {
    lamps.push({ x: ROADS.left.b + off, y: y * T });
    lamps.push({ x: ROADS.right.a - off, y: y * T });
  }
  // keep the driveway and the carriageways clear
  const on = (v: number, r: { a: number; b: number }) => v > r.a - 8 && v < r.b + 8;
  lamps = lamps.filter((p) => !(p.y > BH * T && p.x > DRIVEWAY.x0 - 10 && p.x < DRIVEWAY.x1 + 10) && !on(p.x, ROADS.left) && !on(p.x, ROADS.right) && !on(p.y, ROADS.top) && !on(p.y, ROADS.bottom));
  return lamps;
}

/** Cartoon top-down car, nose pointing along +x before rotation. */
function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, c: { len: number; wid: number; color: string; kind: Kind }): void {
  const L = c.len;
  const W = c.wid;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // shadow
  ctx.fillStyle = 'rgba(20,30,40,0.25)';
  roundRect(ctx, -L / 2 + 2, -W / 2 + 3, L, W, W * 0.35);
  ctx.fill();
  // body
  ctx.fillStyle = c.color;
  ctx.strokeStyle = shade(c.color, -60);
  ctx.lineWidth = 1.5;
  roundRect(ctx, -L / 2, -W / 2, L, W, c.kind === 'bus' ? 6 : W * 0.38);
  ctx.fill();
  ctx.stroke();
  if (c.kind === 'bus') {
    // roof, side windows, AC units and a wide windscreen
    ctx.fillStyle = shade(c.color, 26);
    roundRect(ctx, -L / 2 + 5, -W / 2 + 5, L - 16, W - 10, 4);
    ctx.fill();
    ctx.fillStyle = '#bfe3f2';
    roundRect(ctx, L / 2 - 9, -W / 2 + 3, 6, W - 6, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    roundRect(ctx, -L / 4 - 8, -6, 16, 12, 3);
    ctx.fill();
    roundRect(ctx, L / 8 - 8, -6, 16, 12, 3);
    ctx.fill();
  } else {
    const cabFront = c.kind === 'van' ? L * 0.3 : L * 0.18;
    const cabBack = c.kind === 'van' ? -L * 0.42 : -L * 0.28;
    // cabin roof
    ctx.fillStyle = shade(c.color, c.color === '#f4f3ee' ? -18 : 28);
    roundRect(ctx, cabBack, -W / 2 + 3, cabFront - cabBack, W - 6, 6);
    ctx.fill();
    // windscreen + rear window
    ctx.fillStyle = '#bfe3f2';
    roundRect(ctx, cabFront - L * 0.02, -W / 2 + 4, L * 0.11, W - 8, 3);
    ctx.fill();
    if (c.kind !== 'van') {
      ctx.fillStyle = '#9fcbe0';
      roundRect(ctx, cabBack - L * 0.04, -W / 2 + 5, L * 0.07, W - 10, 2);
      ctx.fill();
    }
    if (c.kind === 'taxi') {
      ctx.fillStyle = '#2d3540';
      roundRect(ctx, -6, -5, 10, 10, 2);
      ctx.fill();
      ctx.fillStyle = '#fff6c8';
      roundRect(ctx, -4.5, -3.5, 7, 7, 1.5);
      ctx.fill();
    }
  }
  // lights
  ctx.fillStyle = '#fff6c8';
  roundRect(ctx, L / 2 - 4, -W / 2 + 2.5, 3, 5, 1.2);
  ctx.fill();
  roundRect(ctx, L / 2 - 4, W / 2 - 7.5, 3, 5, 1.2);
  ctx.fill();
  ctx.fillStyle = '#e5484d';
  roundRect(ctx, -L / 2 + 1, -W / 2 + 2.5, 2.5, 5, 1);
  ctx.fill();
  roundRect(ctx, -L / 2 + 1, W / 2 - 7.5, 2.5, 5, 1);
  ctx.fill();
  ctx.restore();
}
