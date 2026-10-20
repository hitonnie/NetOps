/** Canvas renderer for the bird's-eye office view — cartoon style. */
import { daylight, isWeekend, minuteOfDay } from '../core/time';
import type { Device, Link } from '../net/model';
import type { Game } from '../sim/game';
import type { EmployeeState } from '../sim/types';
import { ALWAYS_LIT, BH, buildWalls, BW, DESKS, doorOpenings, ENTRANCE, FURNITURE, type Furn, NOC_SCREEN, RESTROOM, ROOMS, SEATS, SPARE_WALL_PORTS, T, type WallSeg } from '../world/layout';
import { cachedRoute } from './cables';
import { drawBubble, drawPerson, drawWarning, led, LED, roundRect, shade } from './sprites';
import { DRIVEWAY, LOT, ROADS, Traffic } from './traffic';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewState {
  selected: string | null;
  selectedEmp: string | null;
  hover: Hit | null;
  cables: 'auto' | 'all' | 'off';
  overlay: 'none' | 'wifi' | 'health';
  labels: boolean;
  reducedMotion: boolean;
}

export type Hit = { kind: 'dev'; id: string } | { kind: 'emp'; id: string } | { kind: 'room'; id: string };

export const WORLD = { x0: -6 * T, y0: -4 * T, x1: (BW + 6) * T, y1: (BH + 8) * T };

/** People are drawn this much larger than their base sprite. */
export const PERSON_SCALE = 1.62;

/** Devices are drawn larger than their footprint so they read clearly at a glance. */
export const DEVICE_SCALE: Record<string, number> = { pc: 1.18, laptop: 1.35, printer: 1.35, ap: 1.4, switch: 1.28, iot: 1.35, rogue: 1.45, l3switch: 1, firewall: 1, isp: 1, server: 1 };
const dScale = (kind: string) => DEVICE_SCALE[kind] ?? 1;
const RACKED = new Set(['l3switch', 'firewall', 'isp', 'server']);

/** Cartoon palette (shared with the UI theme). */
export const PAL = {
  outside: '#e6f0ea',
  outsideDot: '#d3e4da',
  path: '#efe4cf',
  corridor: '#8ec7bc',
  wall: '#e9f0eb',
  wallTop: '#ffffff',
  wallSide: '#b9cdc1',
  wallEdge: '#93ad9f',
  glass: '#bfe4ef',
  door: '#8d4b2b',
  doorLight: '#a9603a',
  wood: '#d6a868',
  woodDark: '#a8763d',
  white: '#f8f8f5',
  whiteEdge: '#d5d9d6',
  leaf: '#4caf50',
  leafLight: '#7cc96b',
  pot: '#6b4a32',
  device: '#3a434d',
  deviceTop: '#55606c',
};

const FLOOR: Record<string, string> = {
  'carpet-blue': '#73b4a9',
  'carpet-grey': '#7db8ae',
  'carpet-teal': '#68a8a3',
  'carpet-warm': '#7fb9a4',
  wood: '#d9b382',
  tile: '#f3f0e9',
  raised: '#cdd6da',
  concrete: '#c9cec9',
  stone: '#86c0b4',
};

const DEV_SIZE: Record<string, [number, number]> = {
  pc: [34, 22],
  laptop: [20, 14],
  printer: [32, 24],
  ap: [24, 24],
  switch: [30, 46],
  l3switch: [48, 22],
  firewall: [48, 22],
  isp: [48, 22],
  server: [48, 22],
  iot: [18, 12],
  rogue: [20, 14],
};

const WALL_T = 9;
const EXT_WALL_T = 14;

export class OfficeRenderer {
  private staticCanvas: HTMLCanvasElement | null = null;
  private readonly sScale = 2;
  private walls: WallSeg[] = buildWalls();
  private deskByDev = new Map<string, (typeof DESKS)[number]>();
  private traffic = new Traffic();
  private lastSec = -1;

  // ===========================================================================
  // Static layer (floors, walls, furniture)

  private buildStatic(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const w = WORLD.x1 - WORLD.x0;
    const h = WORLD.y1 - WORLD.y0;
    c.width = Math.ceil(w * this.sScale);
    c.height = Math.ceil(h * this.sScale);
    const ctx = c.getContext('2d')!;
    ctx.scale(this.sScale, this.sScale);
    ctx.translate(-WORLD.x0, -WORLD.y0);
    this.drawExterior(ctx);
    this.drawFloors(ctx);
    this.drawChairs(ctx);
    for (const f of FURNITURE) this.drawFurniture(ctx, f);
    this.drawWalls(ctx);
    return c;
  }

  private drawExterior(ctx: CanvasRenderingContext2D): void {
    // walkway from the entrance down to the street
    ctx.fillStyle = PAL.path;
    roundRect(ctx, ENTRANCE.from * T - 4, BH * T, (ENTRANCE.to - ENTRANCE.from) * T + 8, ROADS.bottom.a - 0.8 * T - BH * T + 4, 6);
    ctx.fill();
    // staff car park + driveway to the bottom street
    ctx.fillStyle = '#b8c2c9';
    roundRect(ctx, LOT.x0 - 3, LOT.y0 - 3, LOT.x1 - LOT.x0 + 6, LOT.y1 - LOT.y0 + 6, 12);
    ctx.fill();
    ctx.fillStyle = '#6b747e';
    roundRect(ctx, LOT.x0, LOT.y0, LOT.x1 - LOT.x0, LOT.y1 - LOT.y0, 10);
    ctx.fill();
    ctx.fillRect(DRIVEWAY.x0, LOT.y1 - 10, DRIVEWAY.x1 - DRIVEWAY.x0, ROADS.bottom.a - LOT.y1 + 10);
    ctx.strokeStyle = '#f4f3ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = LOT.x0 + 4; x <= LOT.x1 - 4; x += LOT.slotW) {
      ctx.moveTo(x, LOT.y0 + 0.2 * T);
      ctx.lineTo(x, LOT.y0 + 0.2 * T + LOT.slotD);
    }
    ctx.moveTo(LOT.x0 + 4, LOT.y0 + 0.2 * T + LOT.slotD);
    ctx.lineTo(LOT.x1 - 4, LOT.y0 + 0.2 * T + LOT.slotD);
    ctx.stroke();
    // "P" sign
    ctx.fillStyle = '#2f7fd8';
    roundRect(ctx, LOT.x0 + 8, LOT.y1 - 26, 20, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 15px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('P', LOT.x0 + 18, LOT.y1 - 10.5);
    ctx.textAlign = 'left';
    // soft building shadow
    ctx.save();
    ctx.filter = 'blur(8px)';
    ctx.fillStyle = 'rgba(40,80,65,0.28)';
    ctx.fillRect(10, 14, BW * T, BH * T);
    ctx.restore();
  }

  private drawFloors(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = PAL.corridor;
    ctx.fillRect(0, 0, BW * T, BH * T);
    for (const r of ROOMS) {
      ctx.fillStyle = FLOOR[r.floor];
      ctx.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
      this.floorPattern(ctx, r.floor, r.x * T, r.y * T, r.w * T, r.h * T);
    }
    ctx.fillStyle = FLOOR.tile;
    ctx.fillRect(RESTROOM.x * T, RESTROOM.y * T, RESTROOM.w * T, RESTROOM.h * T);
    this.floorPattern(ctx, 'bigtile', RESTROOM.x * T, RESTROOM.y * T, RESTROOM.w * T, RESTROOM.h * T);
    // inner shadow along every wall gives depth
    ctx.save();
    ctx.strokeStyle = 'rgba(30,70,60,0.12)';
    ctx.lineWidth = 10;
    for (const s of this.walls) {
      ctx.beginPath();
      ctx.moveTo(s.x1 * T, s.y1 * T + (s.y1 === s.y2 ? 6 : 0));
      ctx.lineTo(s.x2 * T, s.y2 * T + (s.y1 === s.y2 ? 6 : 0));
      ctx.stroke();
    }
    ctx.restore();
  }

  private floorPattern(ctx: CanvasRenderingContext2D, style: string, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (style === 'wood') {
      ctx.strokeStyle = 'rgba(140,90,40,0.18)';
      ctx.lineWidth = 1;
      for (let yy = y; yy < y + h; yy += 12) {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
        ctx.stroke();
        const off = ((yy / 12) % 3) * 40;
        for (let xx = x + off; xx < x + w; xx += 120) {
          ctx.beginPath();
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx, yy + 12);
          ctx.stroke();
        }
      }
    } else if (style === 'tile' || style === 'bigtile') {
      ctx.strokeStyle = 'rgba(120,130,125,0.22)';
      ctx.lineWidth = 1;
      const step = style === 'tile' ? T * 0.75 : T;
      for (let xx = x; xx < x + w; xx += step) {
        ctx.beginPath();
        ctx.moveTo(xx, y);
        ctx.lineTo(xx, y + h);
        ctx.stroke();
      }
      for (let yy = y; yy < y + h; yy += step) {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
        ctx.stroke();
      }
    } else if (style === 'raised') {
      ctx.strokeStyle = 'rgba(70,90,100,0.2)';
      for (let xx = x; xx < x + w; xx += T) {
        ctx.beginPath();
        ctx.moveTo(xx, y);
        ctx.lineTo(xx, y + h);
        ctx.stroke();
      }
      for (let yy = y; yy < y + h; yy += T) {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
        ctx.stroke();
      }
      // perforated cooling tiles in front of the racks
      ctx.fillStyle = 'rgba(70,90,100,0.18)';
      for (let tx = 1; tx < 8; tx++) for (let dot = 0; dot < 9; dot++) ctx.fillRect(tx * T + 4 + (dot % 3) * 7, 6.4 * T + 4 + Math.floor(dot / 3) * 7, 2.5, 2.5);
    } else if (style === 'stone') {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let xx = x; xx < x + w; xx += T * 1.5) for (let yy = y + ((xx / (T * 1.5)) % 2) * T * 0.75; yy < y + h; yy += T * 1.5) ctx.fillRect(xx + 2, yy + 2, T * 1.5 - 4, T * 1.5 - 4);
    } else {
      // soft carpet speckle
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let xx = x; xx < x + w; xx += 6) for (let yy = y + ((xx / 6) % 2) * 3; yy < y + h; yy += 6) ctx.fillRect(xx, yy, 1.5, 1.5);
    }
    ctx.restore();
  }

  private withShadow(ctx: CanvasRenderingContext2D, fn: () => void, blur = 6, dy = 3): void {
    ctx.save();
    ctx.shadowColor = 'rgba(25,60,50,0.32)';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 1.5;
    ctx.shadowOffsetY = dy;
    fn();
    ctx.restore();
  }

  private chair(ctx: CanvasRenderingContext2D, x: number, y: number, backDir: 'N' | 'S' | 'E' | 'W', color = '#f1f2ef'): void {
    const s = 9;
    this.withShadow(ctx, () => {
      ctx.fillStyle = color;
      roundRect(ctx, x - s, y - s, s * 2, s * 2, 5);
      ctx.fill();
    }, 4, 2);
    ctx.fillStyle = shade(color, -38);
    const b = 4.5;
    if (backDir === 'N') roundRect(ctx, x - s, y - s - 1, s * 2, b, 2);
    if (backDir === 'S') roundRect(ctx, x - s, y + s - b + 1, s * 2, b, 2);
    if (backDir === 'W') roundRect(ctx, x - s - 1, y - s, b, s * 2, 2);
    if (backDir === 'E') roundRect(ctx, x + s - b + 1, y - s, b, s * 2, 2);
    ctx.fill();
  }

  private drawChairs(ctx: CanvasRenderingContext2D): void {
    for (const d of DESKS) this.chair(ctx, d.seat.x, d.seat.y, d.facing === 'S' ? 'N' : 'S', d.id === 'MGR-01' ? '#8f6a4f' : '#f1f2ef');
    for (const s of SEATS) {
      if (s.kind === 'meeting' || s.kind === 'kitchen') {
        const north = SEATS.some((o) => o !== s && Math.abs(o.pos.x - s.pos.x) < 2 && o.pos.y > s.pos.y);
        this.chair(ctx, s.pos.x, s.pos.y, s.kind === 'kitchen' ? 'N' : north ? 'N' : 'S', s.kind === 'kitchen' ? '#f7d9a8' : '#f1f2ef');
      }
    }
    this.chair(ctx, 13 * T, 5.45 * T, 'S', '#4b5560');
  }

  private plant(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    this.withShadow(ctx, () => {
      ctx.fillStyle = PAL.pot;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    });
    const leaves = 9;
    for (let k = 0; k < leaves; k++) {
      const a = (k / leaves) * Math.PI * 2;
      ctx.fillStyle = k % 2 ? PAL.leaf : PAL.leafLight;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(a - 0.35) * r * 0.9, cy + Math.sin(a - 0.35) * r * 0.9, cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
      ctx.quadraticCurveTo(cx + Math.cos(a + 0.35) * r * 0.9, cy + Math.sin(a + 0.35) * r * 0.9, cx, cy);
      ctx.fill();
    }
    ctx.fillStyle = '#3d8b40';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFurniture(ctx: CanvasRenderingContext2D, f: Furn): void {
    const x = f.x * T;
    const y = f.y * T;
    const w = f.w * T;
    const h = f.h * T;
    switch (f.kind) {
      case 'table': {
        const col = f.color ?? PAL.wood;
        this.withShadow(ctx, () => {
          ctx.fillStyle = col;
          roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 4);
          ctx.fill();
        });
        ctx.fillStyle = shade(col, -30);
        roundRect(ctx, x + 1, y + h - 5, w - 2, 4, 2);
        ctx.fill();
        ctx.fillStyle = shade(col, 22);
        roundRect(ctx, x + 3, y + 3, w - 6, 3, 1.5);
        ctx.fill();
        // papers on wooden desks
        if (col === PAL.wood || col === '#d6a868') {
          const seed = Math.floor(x * 7 + y * 3);
          ctx.fillStyle = '#ffffff';
          ctx.save();
          ctx.translate(x + w * (0.18 + (seed % 3) * 0.05), y + h * 0.35);
          ctx.rotate(((seed % 7) - 3) * 0.06);
          ctx.fillRect(-4, -3, 8, 10);
          ctx.fillStyle = '#c7ccd0';
          ctx.fillRect(-2.5, -1, 5, 0.8);
          ctx.fillRect(-2.5, 1, 4, 0.8);
          ctx.restore();
          if (seed % 3 === 0) {
            ctx.fillStyle = '#3d8b40';
            ctx.beginPath();
            ctx.arc(x + w - 6, y + 6, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (f.label === 'Mood board') {
          const cols = ['#e07a5f', '#f2cc8f', '#81b29a', '#3d405b', '#f4a261'];
          cols.forEach((c, k) => {
            ctx.fillStyle = c;
            ctx.fillRect(x + 8 + k * 17, y + 9, 13, 13);
          });
        }
        break;
      }
      case 'roundtable':
        this.withShadow(ctx, () => {
          ctx.fillStyle = PAL.white;
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = PAL.whiteEdge;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + w / 2 - 5, y + h / 2 - 3, 7, 6);
        break;
      case 'sofa': {
        const col = f.color ?? '#d9b88c';
        this.withShadow(ctx, () => {
          ctx.fillStyle = shade(col, -18);
          roundRect(ctx, x, y, w, h, 8);
          ctx.fill();
        });
        ctx.fillStyle = col;
        if (w > h) roundRect(ctx, x + 5, y + 6, w - 10, h - 9, 5);
        else roundRect(ctx, x + 6, y + 5, w - 9, h - 10, 5);
        ctx.fill();
        ctx.strokeStyle = shade(col, -25);
        ctx.lineWidth = 1;
        if (w > h) {
          for (let k = 1; k < 3; k++) {
            ctx.beginPath();
            ctx.moveTo(x + (w * k) / 3, y + 7);
            ctx.lineTo(x + (w * k) / 3, y + h - 4);
            ctx.stroke();
          }
        } else {
          for (let k = 1; k < 3; k++) {
            ctx.beginPath();
            ctx.moveTo(x + 7, y + (h * k) / 3);
            ctx.lineTo(x + w - 4, y + (h * k) / 3);
            ctx.stroke();
          }
        }
        break;
      }
      case 'plant':
        this.plant(ctx, x + w / 2, y + h / 2, (w / 2) * 0.95);
        break;
      case 'counter':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#dfe3e1';
          roundRect(ctx, x, y, w, h, 4);
          ctx.fill();
        });
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x + 2, y + 2, w - 4, h - 7, 3);
        ctx.fill();
        // sink and hob
        ctx.fillStyle = '#b8c6cc';
        roundRect(ctx, x + w * 0.62, y + 5, 30, h - 13, 4);
        ctx.fill();
        ctx.fillStyle = '#9aa8ae';
        ctx.beginPath();
        ctx.arc(x + w * 0.62 + 15, y + 10, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a3f45';
        roundRect(ctx, x + w * 0.82, y + 4, 34, h - 11, 3);
        ctx.fill();
        ctx.strokeStyle = '#6d747b';
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.arc(x + w * 0.82 + 9 + k * 16, y + h / 2 - 2, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'coffee':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#3a3f45';
          roundRect(ctx, x, y, w, h, 4);
          ctx.fill();
        });
        ctx.fillStyle = '#8d5b3a';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2 + 2, 4, 0, Math.PI * 2);
        ctx.fill();
        led(ctx, x + w - 5, y + 5, '#ef4444', 1.5);
        break;
      case 'fridge':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#ffffff';
          roundRect(ctx, x, y, w, h, 4);
          ctx.fill();
        });
        ctx.strokeStyle = '#c5ccd0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + h * 0.4);
        ctx.lineTo(x + w - 3, y + h * 0.4);
        ctx.stroke();
        break;
      case 'rack':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#2f3740';
          roundRect(ctx, x, y, w, h, 5);
          ctx.fill();
        }, 8, 4);
        ctx.strokeStyle = '#4c5864';
        ctx.lineWidth = 2;
        roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 4);
        ctx.stroke();
        ctx.fillStyle = '#8fa1ae';
        ctx.font = '700 7px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.label ?? '', x + w / 2, y + h - 5);
        break;
      case 'crac':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#e8edf0';
          roundRect(ctx, x, y, w, h, 4);
          ctx.fill();
        });
        ctx.strokeStyle = '#a9b6bd';
        ctx.lineWidth = 1;
        for (let k = 1; k < 8; k++) {
          ctx.beginPath();
          ctx.moveTo(x + (w * k) / 8, y + 4);
          ctx.lineTo(x + (w * k) / 8, y + h - 4);
          ctx.stroke();
        }
        break;
      case 'shelf':
      case 'cabinet': {
        this.withShadow(ctx, () => {
          ctx.fillStyle = PAL.woodDark;
          roundRect(ctx, x, y, w, h, 3);
          ctx.fill();
        });
        const cols = ['#e07a5f', '#3d6fb6', '#f2cc8f', '#81b29a', '#9b5de5'];
        const n = Math.floor(Math.max(w, h) / 7);
        for (let k = 0; k < n; k++) {
          ctx.fillStyle = cols[k % cols.length];
          if (w > h) ctx.fillRect(x + 3 + k * 7, y + 3, 5, h - 6);
          else ctx.fillRect(x + 3, y + 3 + k * 7, w - 6, 5);
        }
        break;
      }
      case 'bench':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#e3e8ea';
          roundRect(ctx, x, y, w, h, 4);
          ctx.fill();
        });
        ctx.fillStyle = '#5b6573';
        for (let k = 0; k < 3; k++) roundRect(ctx, x + 8, y + 10 + k * (h / 3.4), w - 22, 10, 2);
        ctx.fill();
        ctx.fillStyle = '#7cc0d8';
        for (let k = 0; k < 3; k++) ctx.fillRect(x + 10, y + 12 + k * (h / 3.4), w - 26, 6);
        break;
      case 'whiteboard':
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x, y - 1, w, Math.max(h, 6), 2);
        ctx.fill();
        ctx.strokeStyle = '#b8c0c4';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = '#e07a5f';
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 2);
        ctx.lineTo(x + w * 0.4, y + 2);
        ctx.stroke();
        break;
      case 'tv':
      case 'bigscreen':
        ctx.fillStyle = '#1c2228';
        roundRect(ctx, x, y, w, Math.max(h, 7), 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120,200,230,0.35)';
        ctx.fillRect(x + 3, y + 1.5, w * 0.3, 2);
        break;
      case 'pingpong':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#2f8f6f';
          roundRect(ctx, x, y, w, h, 3);
          ctx.fill();
        });
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w / 2, y + h);
        ctx.stroke();
        break;
      case 'beanbag': {
        const col = f.color ?? '#e07a5f';
        this.withShadow(ctx, () => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2.2, 0.3, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.fillStyle = shade(col, 30);
        ctx.beginPath();
        ctx.ellipse(x + w / 2 - 4, y + h / 2 - 4, w / 5, h / 6, 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'reception':
        this.withShadow(ctx, () => {
          ctx.fillStyle = PAL.woodDark;
          roundRect(ctx, x - 6, y - 2, w + 12, h + 8, 8);
          ctx.fill();
        });
        ctx.fillStyle = PAL.wood;
        roundRect(ctx, x - 3, y + 1, w + 6, h + 2, 6);
        ctx.fill();
        break;
      case 'toilet':
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h * 0.58, w / 2.6, h / 2.8, 0, 0, Math.PI * 2);
          ctx.fill();
          roundRect(ctx, x + w * 0.18, y + h * 0.05, w * 0.64, h * 0.28, 3);
          ctx.fill();
        });
        ctx.strokeStyle = '#cfd6da';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.58, w / 4, h / 4.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      default:
        ctx.fillStyle = '#999';
        ctx.fillRect(x, y, w, h);
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D): void {
    const segRect = (s: WallSeg, t: number) => {
      const x1 = s.x1 * T;
      const y1 = s.y1 * T;
      const x2 = s.x2 * T;
      const y2 = s.y2 * T;
      if (y1 === y2) return { x: x1 - t / 2, y: y1 - t / 2, w: x2 - x1 + t, h: t, horiz: true };
      return { x: x1 - t / 2, y: y1 - t / 2, w: t, h: y2 - y1 + t, horiz: false };
    };
    // glass first (thin), then solid walls on top so joints look clean
    for (const s of this.walls.filter((w) => w.glass)) {
      const r = segRect(s, 6);
      ctx.fillStyle = PAL.glass;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      if (r.horiz) ctx.fillRect(r.x, r.y + 1, r.w, 1.5);
      else ctx.fillRect(r.x + 1, r.y, 1.5, r.h);
      ctx.fillStyle = '#7fb0c0';
      if (r.horiz) ctx.fillRect(r.x, r.y + r.h - 1.5, r.w, 1.5);
      else ctx.fillRect(r.x + r.w - 1.5, r.y, 1.5, r.h);
    }
    const solid = this.walls.filter((w) => !w.glass);
    // shadow pass
    ctx.save();
    ctx.fillStyle = 'rgba(25,60,50,0.25)';
    for (const s of solid) {
      const r = segRect(s, s.exterior ? EXT_WALL_T : WALL_T);
      ctx.fillRect(r.x + 2, r.y + 4, r.w, r.h);
    }
    ctx.restore();
    for (const s of solid) {
      const t = s.exterior ? EXT_WALL_T : WALL_T;
      const r = segRect(s, t);
      ctx.fillStyle = PAL.wall;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // 3D: lit top edge, shaded lower/right edge
      ctx.fillStyle = PAL.wallTop;
      if (r.horiz) ctx.fillRect(r.x, r.y, r.w, 2);
      else ctx.fillRect(r.x, r.y, 2, r.h);
      ctx.fillStyle = PAL.wallSide;
      if (r.horiz) ctx.fillRect(r.x, r.y + r.h - 3, r.w, 3);
      else ctx.fillRect(r.x + r.w - 3, r.y, 3, r.h);
    }
    // outline the building
    ctx.strokeStyle = PAL.wallEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-EXT_WALL_T / 2, -EXT_WALL_T / 2, BW * T + EXT_WALL_T, BH * T + EXT_WALL_T);
    // windows along the exterior
    const win = (x: number, y: number, horiz: boolean) => {
      const len = 2.2 * T;
      ctx.fillStyle = '#c8a07a';
      if (horiz) roundRect(ctx, x - len / 2, y - EXT_WALL_T / 2 + 2, len, EXT_WALL_T - 4, 2);
      else roundRect(ctx, x - EXT_WALL_T / 2 + 2, y - len / 2, EXT_WALL_T - 4, len, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      if (horiz) ctx.fillRect(x - len / 2 + 3, y - EXT_WALL_T / 2 + 4, len - 6, EXT_WALL_T - 8);
      else ctx.fillRect(x - EXT_WALL_T / 2 + 4, y - len / 2 + 3, EXT_WALL_T - 8, len - 6);
    };
    for (const tx of [4, 12.5, 21, 26, 30.5, 38, 44]) win(tx * T, 0, true);
    for (const tx of [2, 20, 27, 36, 44]) win(tx * T, BH * T, true);
    for (const ty of [4, 17, 25.5]) win(0, ty * T, false);
    for (const ty of [4, 17, 27]) win(BW * T, ty * T, false);
    // door mats
    for (const d of doorOpenings()) {
      const horiz = d.y1 === d.y2;
      const t = (d.exterior ? EXT_WALL_T : WALL_T) + 2;
      ctx.fillStyle = PAL.door;
      if (horiz) roundRect(ctx, d.x1 * T + 3, d.y1 * T - t / 2, (d.x2 - d.x1) * T - 6, t, 2);
      else roundRect(ctx, d.x1 * T - t / 2, d.y1 * T + 3, t, (d.y2 - d.y1) * T - 6, 2);
      ctx.fill();
      ctx.fillStyle = PAL.doorLight;
      if (horiz) ctx.fillRect(d.x1 * T + 5, d.y1 * T - t / 2 + 2, (d.x2 - d.x1) * T - 10, 2);
      else ctx.fillRect(d.x1 * T - t / 2 + 2, d.y1 * T + 5, 2, (d.y2 - d.y1) * T - 10);
    }
  }

  // ===========================================================================

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, game: Game, cam: Camera, view: ViewState, timeSec: number): void {
    if (!this.staticCanvas) this.staticCanvas = this.buildStatic();
    const s = game.s;
    ctx.save();
    ctx.fillStyle = PAL.outside;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    ctx.imageSmoothingEnabled = true;
    // light dotted grounds everywhere
    ctx.fillStyle = PAL.outside;
    ctx.fillRect(-20000, -20000, 40000, 40000);
    const dt = this.lastSec < 0 ? 0 : Math.min(0.1, Math.max(0, timeSec - this.lastSec));
    this.lastSec = timeSec;
    if (s.speed > 0 && !view.reducedMotion) this.traffic.update(dt);
    this.traffic.drawStreets(ctx);
    ctx.drawImage(this.staticCanvas, WORLD.x0, WORLD.y0, WORLD.x1 - WORLD.x0, WORLD.y1 - WORLD.y0);
    this.traffic.drawCars(ctx, s.employees);
    const anim = view.reducedMotion ? 0 : timeSec;

    this.drawBigScreen(ctx, game);
    this.drawWallPorts(ctx, cam);
    this.drawCables(ctx, game, view);
    if (view.overlay === 'wifi' || (view.selected && game.dev(view.selected)?.kind === 'ap')) this.drawWifi(ctx, game, view);
    const devs = Object.values(s.net.devices).sort((a, b) => a.pos.y - b.pos.y);
    for (const d of devs) this.drawDevice(ctx, game, d, anim, view);
    const people = s.employees.filter((x) => x.present).sort((a, b) => a.pos.y - b.pos.y);
    for (const p of people) this.drawEmployee(ctx, game, p, anim, view);
    if (view.selected) {
      const d = game.dev(view.selected);
      if (d) this.ring(ctx, d.pos.x, d.pos.y, Math.max(...(DEV_SIZE[d.kind] ?? [16, 16])) * 0.72 * dScale(d.kind) + 8, '#f59e0b', anim);
    }
    if (view.selectedEmp) {
      const p = game.employee(view.selectedEmp);
      if (p?.present) this.ring(ctx, p.pos.x, p.pos.y, 21, '#a855f7', anim);
    }
    this.drawSecurityMarkers(ctx, game, anim);
    if (view.overlay === 'health' && game.hasUpgrade('nms')) this.drawHealth(ctx, game);
    this.drawNight(ctx, game);
    this.traffic.drawNightLights(ctx, 1 - daylight(s.t));
    this.drawRoomLabels(ctx, cam);
    if (view.labels) this.drawDeviceLabels(ctx, game, cam, view);
    this.drawPeopleLabels(ctx, game, cam, view);
    ctx.restore();
  }

  private ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, t: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -t * 18;
    ctx.stroke();
    ctx.restore();
  }

  private drawBigScreen(ctx: CanvasRenderingContext2D, game: Game): void {
    const { x, y, w } = NOC_SCREEN;
    ctx.fillStyle = '#0d1a20';
    roundRect(ctx, x + 2, y + 1, w - 4, 8, 2);
    ctx.fill();
    const hist = game.s.prodHistory.slice(-60);
    ctx.strokeStyle = '#4fe0c0';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    hist.forEach((v, k) => {
      const px = x + 5 + (k / 60) * (w * 0.6);
      const py = y + 8 - (v / 100) * 5.5;
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
    const open = game.openIncidents().length;
    for (let k = 0; k < 5; k++) led(ctx, x + w * 0.72 + k * 7, y + 5, k < open ? LED.bad : LED.ok, 1.6);
  }

  private drawWallPorts(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (cam.zoom < 0.9) return;
    for (const w of SPARE_WALL_PORTS) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#6b7d75';
      ctx.lineWidth = 1;
      roundRect(ctx, w.pos.x - 4, w.pos.y - 4, 8, 8, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2f3a36';
      ctx.fillRect(w.pos.x - 2, w.pos.y - 1.2, 4, 2.4);
      if (cam.zoom > 1.5) {
        ctx.fillStyle = '#2f4a44';
        ctx.font = '800 8px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(w.label, w.pos.x, w.pos.y + 11);
      }
    }
  }

  private linkVisible(l: Link, view: ViewState): 'hi' | 'lo' | null {
    const sel = view.selected;
    const touches = !!sel && (l.a.dev === sel || l.b.dev === sel);
    if (touches) return 'hi';
    if (view.cables === 'off') return null;
    if (view.cables === 'all') return 'lo';
    return l.medium === 'fiber' || l.kind === 'wan' || l.kind === 'server' ? 'lo' : null;
  }

  private drawCables(ctx: CanvasRenderingContext2D, game: Game, view: ViewState): void {
    const net = game.s.net;
    const e = game.engine;
    const blocked = e.c.stpBlocked;
    for (const l of Object.values(net.links)) {
      const vis = this.linkVisible(l, view);
      if (!vis) continue;
      const r = cachedRoute(net, l);
      if (!r || r.pts.length < 2) continue;
      const isBlocked = blocked.has(`${l.a.dev}|${l.a.iface}`) || blocked.has(`${l.b.dev}|${l.b.iface}`);
      const ifa = net.devices[l.a.dev]?.ifaces.find((i) => i.name === l.a.iface);
      const up = ifa ? e.oper(ifa).up : false;
      let color = l.medium === 'fiber' ? '#f29e38' : '#2b7bd6';
      let dash: number[] = [];
      if (l.status === 'degraded') {
        color = '#f97316';
        dash = [5, 3];
      } else if (l.status !== 'ok') {
        color = '#e23d3d';
        dash = [4, 4];
      } else if (isBlocked) {
        color = '#8a9a95';
        dash = [2, 4];
      } else if (!up) color = '#8a9a95';
      ctx.save();
      ctx.globalAlpha = vis === 'hi' ? 1 : view.cables === 'all' ? 0.65 : 0.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // white casing makes cables pop on the teal floor
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = (vis === 'hi' ? 3 : l.medium === 'fiber' ? 2.4 : 1.6) + 2;
      ctx.beginPath();
      ctx.moveTo(r.pts[0].x, r.pts[0].y);
      for (const p of r.pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = vis === 'hi' ? 3 : l.medium === 'fiber' ? 2.4 : 1.6;
      ctx.setLineDash(dash);
      ctx.stroke();
      if (vis === 'hi' && l.status === 'unplugged') {
        const p = r.pts[0];
        ctx.setLineDash([]);
        ctx.fillStyle = '#e23d3d';
        ctx.beginPath();
        ctx.arc(p.x + 10, p.y + 8, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // power cords: every mains-powered device in "All" view, otherwise just the selection
    const powered = view.cables === 'all' ? Object.values(net.devices) : view.selected ? [game.dev(view.selected)].filter(Boolean) : [];
    for (const d of powered) {
      if (!d || d.poeW !== 0 || d.kind === 'isp' || d.kind === 'laptop' || d.kind === 'rogue') continue;
      const ox = d.pos.x + (d.kind === 'pc' ? -18 : 22);
      const oy = d.pos.y + 12;
      ctx.save();
      ctx.strokeStyle = d.powered && !d.powerFault ? '#4a5a55' : '#e23d3d';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(d.pos.x, d.pos.y);
      ctx.quadraticCurveTo(ox, d.pos.y, ox, oy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#4a5a55';
      roundRect(ctx, ox - 4, oy - 3, 8, 6, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawWifi(ctx: CanvasRenderingContext2D, game: Game, view: ViewState): void {
    const txF = { low: 0.6, medium: 0.8, high: 1 } as const;
    const chColor: Record<number, string> = { 1: '43,123,214', 6: '168,85,247', 11: '22,163,74' };
    for (const d of Object.values(game.s.net.devices)) {
      if (d.kind !== 'ap' || !d.ap) continue;
      if (view.overlay !== 'wifi' && view.selected !== d.id) continue;
      if (!game.engine.isUp(d.id) || !d.ap.radioOn) continue;
      const r = d.ap.rangePx * txF[d.ap.txPower];
      const c = chColor[d.ap.channel] ?? '245,158,11';
      const g = ctx.createRadialGradient(d.pos.x, d.pos.y, 4, d.pos.x, d.pos.y, r);
      g.addColorStop(0, `rgba(${c},0.30)`);
      g.addColorStop(1, `rgba(${c},0.03)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(d.pos.x, d.pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${c},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      this.pill(ctx, `ch ${d.ap.channel}`, d.pos.x, d.pos.y - 28, `rgb(${c})`, '#ffffff', 11);
    }
    for (const f of game.s.net.wireless.foreign) {
      ctx.fillStyle = 'rgba(226,61,61,0.10)';
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, 16 * T, 0, Math.PI * 2);
      ctx.fill();
      this.pill(ctx, `${f.ssid} · ch ${f.channel}`, f.pos.x, Math.max(f.pos.y, -1.6 * T) + 10, '#b91c1c', '#ffffff', 9);
    }
  }

  private pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string, size: number): void {
    ctx.save();
    ctx.font = `800 ${size}px Nunito, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = bg;
    roundRect(ctx, x - w / 2, y - size + 1, w, size + 6, (size + 6) / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 2);
    ctx.restore();
  }

  private devState(game: Game, d: Device): 'ok' | 'off' | 'boot' {
    const e = game.engine;
    if (!e.c.devPowered.get(d.id)) return 'off';
    if (!e.isUp(d.id)) return 'boot';
    return 'ok';
  }

  private drawDevice(ctx: CanvasRenderingContext2D, game: Game, d: Device, t: number, view: ViewState): void {
    const e = game.engine;
    const st = this.devState(game, d);
    const x = d.pos.x;
    const y = d.pos.y;
    const hovered = view.hover?.kind === 'dev' && view.hover.id === d.id;
    const sc = dScale(d.kind);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.translate(-x, -y);
    switch (d.kind) {
      case 'pc': {
        let desk = this.deskByDev.get(d.id);
        if (!desk && !this.deskByDev.has(d.id)) {
          desk = DESKS.find((k) => Math.abs(k.pcPos.x - x) < 2 && Math.abs(k.pcPos.y - y) < 2);
          if (desk) this.deskByDev.set(d.id, desk);
        }
        const dir = desk?.facing === 'N' ? -1 : 1;
        const my = y + dir * 3;
        let screen = '#5fb8ff';
        if (st === 'off') screen = '#1c242b';
        else if (st === 'boot') screen = '#9aa8b2';
        else {
          const i = d.ifaces[0];
          if (!e.oper(i).up || !i.ip || i.ip.startsWith('169.254') || d.host?.ipConflict) screen = '#ffc94d';
        }
        if (d.pc?.reimageUntil) screen = '#c084fc';
        // keyboard (towards the user)
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x - 9, my - dir * 9 - 2.5, 18, 5, 1.5);
        ctx.fill();
        ctx.fillStyle = '#c9cfd3';
        ctx.fillRect(x - 7, my - dir * 9 - 0.5, 14, 1);
        // monitor
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#2a323b';
          roundRect(ctx, x - 15, my - 3.5, 30, 7, 2.5);
          ctx.fill();
        }, 4, 2);
        ctx.fillStyle = screen;
        roundRect(ctx, x - 13, my - dir * 1.5 - 1.5, 26, 3, 1);
        ctx.fill();
        // tower beside the desk
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#3a434d';
          roundRect(ctx, x + 17, my - 5, 9, 12, 2);
          ctx.fill();
        }, 4, 2);
        led(ctx, x + 21.5, my - 2, st === 'off' ? LED.off : st === 'boot' ? LED.warn : LED.blue, 1.2);
        if (d.id === 'noc-pc') {
          for (const ox of [-33, 33]) {
            ctx.fillStyle = '#2a323b';
            roundRect(ctx, x + ox - 13, my - 3.5, 26, 7, 2.5);
            ctx.fill();
            ctx.fillStyle = '#4fe0c0';
            roundRect(ctx, x + ox - 11, my - dir * 1.5 - 1.5, 22, 3, 1);
            ctx.fill();
          }
        }
        if (screen === '#ffc94d' && st === 'ok') this.miniAlert(ctx, x, my - 14, t);
        break;
      }
      case 'laptop': {
        const emp = d.ownerId ? game.employee(d.ownerId) : null;
        const carried = emp?.present && (emp.state === 'meeting' || emp.state === 'walking') && Math.hypot(emp.pos.x - x, emp.pos.y - y) < 4;
        if (carried && emp!.state === 'walking') break;
        const lx = carried ? x + Math.cos(emp!.facing) * 16 : x;
        const ly = carried ? y + Math.sin(emp!.facing) * 16 : y;
        ctx.translate(lx, ly);
        const up = e.oper(d.ifaces[0]).up && d.ifaces[0].ip && !d.ifaces[0].ip.startsWith('169.254');
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#d5dade';
          roundRect(ctx, -10, -7, 20, 14, 2.5);
          ctx.fill();
        }, 4, 2);
        ctx.fillStyle = '#3a434d';
        roundRect(ctx, -10, -7, 20, 5.5, 2);
        ctx.fill();
        ctx.fillStyle = st === 'off' ? '#1c242b' : up ? '#5fb8ff' : '#ffc94d';
        ctx.fillRect(-8, -5.8, 16, 3);
        ctx.fillStyle = '#b5bcc2';
        ctx.fillRect(-7, 0, 14, 4);
        break;
      }
      case 'printer': {
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#4a5058';
          roundRect(ctx, x - 16, y - 12, 32, 24, 5);
          ctx.fill();
        }, 6, 3);
        ctx.fillStyle = '#6b737d';
        roundRect(ctx, x - 13, y - 9, 26, 10, 3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x - 9, y + 3, 18, 10, 1.5);
        ctx.fill();
        ctx.fillStyle = '#c9cfd3';
        ctx.fillRect(x - 6, y + 6, 12, 1);
        ctx.fillRect(x - 6, y + 8.5, 9, 1);
        const ok = st === 'ok' && d.printer?.status === 'ready';
        led(ctx, x + 11, y - 7, st === 'off' ? LED.off : ok ? LED.ok : LED.warn, 1.8, true);
        break;
      }
      case 'ap': {
        const wired = e.oper(d.ifaces[0]).up;
        this.withShadow(ctx, () => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, Math.PI * 2);
          ctx.fill();
        }, 6, 3);
        ctx.strokeStyle = '#9fd3c7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
        const c = st === 'off' ? LED.off : st === 'boot' ? LED.warn : !d.ap?.radioOn ? LED.warn : wired ? LED.ok : LED.warn;
        led(ctx, x, y, c, 3, st === 'ok');
        if (st === 'ok' && d.ap?.radioOn) {
          ctx.strokeStyle = 'rgba(43,123,214,0.55)';
          ctx.lineWidth = 1.6;
          const ph = (t * 1.3) % 1;
          for (let k = 0; k < 2; k++) {
            ctx.globalAlpha = 1 - ((ph + k * 0.5) % 1);
            ctx.beginPath();
            ctx.arc(x, y, 13 + ((ph + k * 0.5) % 1) * 9, -Math.PI * 0.8, -Math.PI * 0.2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'switch':
        this.drawCabinet(ctx, game, d, t);
        break;
      case 'l3switch':
      case 'firewall':
      case 'isp':
      case 'server':
        this.drawSlab(ctx, game, d, t);
        break;
      case 'iot': {
        if (d.model.includes('signage')) {
          this.withShadow(ctx, () => {
            ctx.fillStyle = '#1c242b';
            roundRect(ctx, x - 20, y - 5, 40, 10, 2);
            ctx.fill();
          });
          ctx.fillStyle = st === 'ok' ? '#f472b6' : '#2a323b';
          ctx.fillRect(x - 17, y - 3, 34, 6);
        } else if (d.model.includes('camera')) {
          this.withShadow(ctx, () => {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.fillStyle = '#1c242b';
          ctx.beginPath();
          ctx.arc(x, y, 3.4, 0, Math.PI * 2);
          ctx.fill();
          led(ctx, x + 5, y - 5, st === 'ok' ? LED.bad : LED.off, 1.2);
        } else {
          this.withShadow(ctx, () => {
            ctx.fillStyle = '#1c242b';
            roundRect(ctx, x - 18, y - 3.5, 36, 7, 3);
            ctx.fill();
          });
          led(ctx, x + 14, y, st === 'ok' ? LED.ok : LED.off, 1.2);
        }
        break;
      }
      case 'rogue': {
        this.withShadow(ctx, () => {
          ctx.fillStyle = d.model.includes('Raspberry') ? '#16a34a' : '#1f2937';
          roundRect(ctx, x - 10, y - 7, 20, 14, 3);
          ctx.fill();
        });
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        roundRect(ctx, x - 10, y - 7, 20, 14, 3);
        ctx.stroke();
        const blink = Math.floor(t * 3) % 2 === 0;
        led(ctx, x + 6, y - 3, blink ? LED.act : LED.ok, 1.4);
        if (d.rogue?.bridge) for (let k = 0; k < 4; k++) led(ctx, x - 6 + k * 3.6, y + 3.5, LED.ok, 0.8);
        if (d.model.includes('TP-Link')) {
          ctx.strokeStyle = '#1f2937';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 7, y - 7);
          ctx.lineTo(x - 11, y - 14);
          ctx.moveTo(x + 7, y - 7);
          ctx.lineTo(x + 11, y - 14);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
    if (hovered) {
      const [w0, h0] = DEV_SIZE[d.kind] ?? [16, 16];
      const w = w0 * sc;
      const h = h0 * sc;
      ctx.save();
      ctx.strokeStyle = 'rgba(245,158,11,0.95)';
      ctx.lineWidth = 2.5;
      roundRect(ctx, x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8, 7);
      ctx.stroke();
      ctx.restore();
    }
  }

  private miniAlert(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    const bob = Math.sin(t * 4) * 1;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = '#ffc94d';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(6, 4.5);
    ctx.lineTo(-6, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5a3d00';
    ctx.font = '900 7px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, 3.5);
    ctx.restore();
  }

  private portLedColor(game: Game, d: Device, i: Device['ifaces'][number], t: number): string {
    const o = game.engine.oper(i);
    if (!game.engine.isUp(d.id)) return LED.off;
    if (o.status === 'err-disabled') return LED.warn;
    if (game.engine.c.stpBlocked.has(i.id)) return LED.warn;
    if (o.up) return Math.floor(t * 6 + i.mac.charCodeAt(16)) % 5 === 0 ? LED.act : LED.ok;
    return LED.off;
  }

  private drawCabinet(ctx: CanvasRenderingContext2D, game: Game, d: Device, t: number): void {
    const x = d.pos.x;
    const y = d.pos.y;
    this.withShadow(ctx, () => {
      ctx.fillStyle = '#323b45';
      roundRect(ctx, x - 15, y - 23, 30, 46, 5);
      ctx.fill();
    }, 7, 4);
    ctx.fillStyle = '#46515d';
    roundRect(ctx, x - 12, y - 20, 24, 40, 3);
    ctx.fill();
    const ports = d.ifaces.filter((i) => i.type === 'copper');
    ports.forEach((i, k) => {
      const col = k % 4;
      const row = Math.floor(k / 4);
      led(ctx, x - 7.5 + col * 5, y - 15 + row * 4.8, this.portLedColor(game, d, i, t), 1.4);
    });
    const sfp = d.ifaces.filter((i) => i.type === 'sfp').slice(0, 4);
    sfp.forEach((i, k) => led(ctx, x - 7.5 + k * 5, y + 16, this.portLedColor(game, d, i, t), 1.7));
    const sys = !game.engine.c.devPowered.get(d.id) ? LED.off : game.engine.isUp(d.id) ? LED.ok : LED.warn;
    led(ctx, x + 9, y - 21, sys, 1.6, true);
  }

  private drawSlab(ctx: CanvasRenderingContext2D, game: Game, d: Device, t: number): void {
    const x = d.pos.x;
    const y = d.pos.y;
    const w = 46;
    const h = 20;
    const accent = d.kind === 'firewall' ? '#e04848' : d.kind === 'isp' ? '#3b82f6' : d.kind === 'l3switch' ? '#16a39a' : '#8a96a3';
    ctx.fillStyle = '#1c232a';
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 3);
    ctx.fill();
    ctx.fillStyle = '#2c353f';
    roundRect(ctx, x - w / 2 + 1, y - h / 2 + 1, w - 2, 4, 2);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, x - w / 2, y - h / 2, 4, h, 2);
    ctx.fill();
    const st = this.devState(game, d);
    if (d.kind === 'l3switch') {
      const ports = d.ifaces.filter((i) => i.type !== 'svi');
      ports.slice(0, 24).forEach((i, k) => led(ctx, x - 17 + (k % 12) * 3.2, y - 3 + Math.floor(k / 12) * 4, this.portLedColor(game, d, i, t), 1.05));
      ports.slice(24, 32).forEach((i, k) => led(ctx, x - 17 + k * 4.2, y + 6, this.portLedColor(game, d, i, t), 1.15));
    } else if (d.kind === 'server') {
      for (let k = 0; k < 8; k++) {
        ctx.fillStyle = '#39434e';
        ctx.fillRect(x - 17 + k * 4.2, y - 5, 3.2, 12);
        led(ctx, x - 15.4 + k * 4.2, y + 4, st === 'ok' ? (Math.floor(t * 4 + k) % 7 === 0 ? LED.act : LED.ok) : LED.off, 0.85);
      }
    } else {
      d.ifaces.slice(0, 4).forEach((i, k) => led(ctx, x - 12 + k * 6.5, y + 2, this.portLedColor(game, d, i, t), 1.5));
    }
    led(ctx, x + 18, y - 4, st === 'off' ? LED.off : st === 'boot' ? LED.warn : LED.ok, 1.6);
    if (d.kind === 'firewall' && game.engine.fwCpu > 80 && st === 'ok') led(ctx, x + 18, y + 3, Math.floor(t * 5) % 2 ? LED.bad : LED.warn, 1.6);
  }

  private drawEmployee(ctx: CanvasRenderingContext2D, game: Game, p: EmployeeState, t: number, view: ViewState): void {
    const walking = p.state === 'walking';
    const seated = p.state === 'working' || p.state === 'meeting' || (p.state === 'break' && !!p.seat);
    const phase = t * 9 + p.speed;
    let dir = p.facing;
    if (p.state === 'working') {
      const desk = game.employeeAt(p.id).desk;
      dir = desk.facing === 'S' ? Math.PI / 2 : -Math.PI / 2;
    }
    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    ctx.scale(PERSON_SCALE, PERSON_SCALE);
    drawPerson(ctx, 0, 0, dir, p.app, walking, phase, seated);
    ctx.restore();
    const icon = p.bubble && p.bubble.until > game.s.t ? p.bubble.icon : p.state === 'working' && p.health < 0.75 && p.blockedSince !== null ? (p.health < 0.35 ? 'no-net' : 'slow') : null;
    if (icon) {
      ctx.save();
      ctx.translate(p.pos.x, p.pos.y);
      ctx.scale(1.35, 1.35);
      drawBubble(ctx, 2, -5, icon, t);
      ctx.restore();
    }
    const hovered = view.hover?.kind === 'emp' && view.hover.id === p.id;
    if (hovered) {
      ctx.strokeStyle = 'rgba(168,85,247,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 19, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawSecurityMarkers(ctx: CanvasRenderingContext2D, game: Game, t: number): void {
    for (const inc of game.openIncidents()) {
      if (!inc.security) continue;
      const d = inc.data as Record<string, string>;
      let target: Device | undefined;
      if (game.hasUpgrade('ids') && d.dev) target = game.dev(d.dev);
      target = target ?? game.dev('fw-edge');
      if (!target) continue;
      drawWarning(ctx, target.pos.x + 22, target.pos.y - 24, 13, t);
    }
  }

  private drawHealth(ctx: CanvasRenderingContext2D, game: Game): void {
    const e = game.engine;
    for (const d of Object.values(game.s.net.devices)) {
      if (!['switch', 'l3switch', 'firewall', 'ap', 'server', 'printer'].includes(d.kind)) continue;
      const ok = e.isUp(d.id) && (d.kind !== 'switch' || e.oper(d.ifaces.find((i) => i.name === 'Vlan99')!).up);
      ctx.strokeStyle = ok ? 'rgba(34,197,94,0.95)' : 'rgba(226,61,61,0.95)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(d.pos.x, d.pos.y, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const l of Object.values(game.s.net.links)) {
      if (l.kind !== 'uplink' && l.kind !== 'wan') continue;
      const r = cachedRoute(game.s.net, l);
      if (!r) continue;
      const u = e.utilization(l.id);
      ctx.strokeStyle = u > 0.85 ? '#e23d3d' : u > 0.6 ? '#f59e0b' : '#22c55e';
      ctx.lineWidth = 3 + Math.min(6, u * 6);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(r.pts[0].x, r.pts[0].y);
      for (const p of r.pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawNight(ctx: CanvasRenderingContext2D, game: Game): void {
    const day = daylight(game.s.t);
    if (day >= 0.999) return;
    const mod = minuteOfDay(game.s.t);
    const lightsOn = (!isWeekend(game.s.t) && mod >= 390 && mod <= 1170) || game.s.employees.some((x) => x.present);
    const outside = 0.55 * (1 - day);
    ctx.fillStyle = `rgba(20,30,70,${outside})`;
    const F = 20000;
    ctx.fillRect(-F, -F, 2 * F, F);
    ctx.fillRect(-F, BH * T, 2 * F, F);
    ctx.fillRect(-F, 0, F, BH * T);
    ctx.fillRect(BW * T, 0, F, BH * T);
    const inside = (lightsOn ? 0.1 : 0.5) * (1 - day);
    ctx.fillStyle = `rgba(20,30,70,${inside})`;
    ctx.fillRect(0, 0, BW * T, BH * T);
    if (!lightsOn) {
      ctx.fillStyle = `rgba(255,240,200,${0.2 * (1 - day)})`;
      ctx.fillRect(ALWAYS_LIT.x, ALWAYS_LIT.y, ALWAYS_LIT.w, ALWAYS_LIT.h);
    }
    // warm glow from the windows at night
    ctx.fillStyle = `rgba(255,214,140,${(lightsOn ? 0.18 : 0.06) * (1 - day)})`;
    for (let k = 2; k < BW; k += 9) {
      ctx.beginPath();
      ctx.arc(k * T, (BH + 1.2) * T, 1.8 * T, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRoomLabels(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (cam.zoom < 0.45) return;
    ctx.save();
    const size = Math.max(11, 13 / Math.max(0.9, cam.zoom));
    ctx.font = `800 ${size}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    for (const r of ROOMS) {
      const x = r.x * T + 9;
      const y = r.y * T + 11 + size;
      const text = r.name.toUpperCase();
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      roundRect(ctx, x - 5, y - size - 1, w + 10, size + 7, (size + 7) / 2);
      ctx.fill();
      ctx.fillStyle = '#1f5ba8';
      ctx.fillText(text, x, y + 1);
    }
    ctx.restore();
  }

  private drawDeviceLabels(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, view: ViewState): void {
    ctx.save();
    ctx.textAlign = 'center';
    for (const d of Object.values(game.s.net.devices)) {
      const important = ['switch', 'l3switch', 'firewall', 'isp', 'server', 'ap', 'printer'].includes(d.kind) || d.id === 'noc-pc';
      const show = view.selected === d.id || (view.hover?.kind === 'dev' && view.hover.id === d.id) || (important && cam.zoom >= 0.85) || cam.zoom >= 2.5;
      if (!show) continue;
      const name = d.kind === 'rogue' ? 'Unknown device' : d.name;
      if (RACKED.has(d.kind)) {
        // rack slabs sit edge to edge: label each one on its own face, shrunk to fit
        ctx.font = '800 9.5px Nunito, system-ui, sans-serif';
        const fs = Math.min(9.5, (9.5 * 44) / ctx.measureText(name).width);
        ctx.font = `800 ${fs}px Nunito, system-ui, sans-serif`;
        const w = ctx.measureText(name).width;
        const y = d.pos.y + 5;
        ctx.fillStyle = 'rgba(28,45,72,0.92)';
        roundRect(ctx, d.pos.x - w / 2 - 3, y - fs / 2 - 2, w + 6, fs + 4, (fs + 4) / 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, d.pos.x, y + 0.5);
        ctx.textBaseline = 'alphabetic';
        continue;
      }
      const [, hh] = DEV_SIZE[d.kind] ?? [16, 16];
      const y = d.pos.y + (hh * dScale(d.kind)) / 2 + 14;
      ctx.font = '800 10px Nunito, system-ui, sans-serif';
      const w = ctx.measureText(name).width;
      ctx.fillStyle = d.kind === 'rogue' ? '#facc15' : 'rgba(28,45,72,0.9)';
      roundRect(ctx, d.pos.x - w / 2 - 6, y - 11, w + 12, 15, 7.5);
      ctx.fill();
      ctx.fillStyle = d.kind === 'rogue' ? '#1f2937' : '#ffffff';
      ctx.fillText(name, d.pos.x, y + 0.5);
    }
    ctx.restore();
  }

  private drawPeopleLabels(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, view: ViewState): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 10px Nunito, system-ui, sans-serif';
    for (const p of game.s.employees) {
      if (!p.present) continue;
      const show = view.selectedEmp === p.id || (view.hover?.kind === 'emp' && view.hover.id === p.id) || cam.zoom >= 2.7;
      if (!show) continue;
      const name = game.employeeAt(p.id).r.name;
      const w = ctx.measureText(name).width;
      ctx.fillStyle = 'rgba(124,58,237,0.9)';
      roundRect(ctx, p.pos.x - w / 2 - 6, p.pos.y + 17, w + 12, 15, 7.5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(name, p.pos.x, p.pos.y + 28.5);
    }
    ctx.restore();
  }

  // ===========================================================================

  hitTest(game: Game, wx: number, wy: number): Hit | null {
    for (const p of [...game.s.employees].reverse()) {
      if (!p.present) continue;
      if (Math.hypot(p.pos.x - wx, p.pos.y - wy) < 15) return { kind: 'emp', id: p.id };
    }
    let best: { id: string; area: number } | null = null;
    for (const d of Object.values(game.s.net.devices)) {
      let [w, h] = DEV_SIZE[d.kind] ?? [16, 16];
      let cx = d.pos.x;
      let cy = d.pos.y;
      if (d.kind === 'pc') {
        w = 50;
        h = 24;
        cx += 5;
      }
      if (d.kind === 'iot' && d.model.includes('signage')) w = 42;
      if (d.kind === 'iot' && d.model.includes('video')) w = 38;
      w *= dScale(d.kind);
      h *= dScale(d.kind);
      if (d.kind === 'laptop') {
        const emp = d.ownerId ? game.employee(d.ownerId) : null;
        if (emp?.present && emp.state === 'meeting') {
          cx += Math.cos(emp.facing) * 16;
          cy += Math.sin(emp.facing) * 16;
        }
      }
      if (Math.abs(wx - cx) <= w / 2 + 3 && Math.abs(wy - cy) <= h / 2 + 3) {
        const area = w * h;
        if (!best || area < best.area) best = { id: d.id, area };
      }
    }
    if (best) return { kind: 'dev', id: best.id };
    for (const r of ROOMS) {
      if (wx >= r.x * T && wx <= (r.x + r.w) * T && wy >= r.y * T && wy <= (r.y + r.h) * T) return { kind: 'room', id: r.id };
    }
    return null;
  }

  invalidateStatic(): void {
    this.staticCanvas = null;
  }
}
