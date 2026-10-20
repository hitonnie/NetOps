import type { Point, ZoneId } from '../net/model';

/** World units are pixels at zoom 1. One tile = 24px ≈ 0.6m. */
export const T = 24;
export const BW = 48; // building width in tiles
export const BH = 30; // building height in tiles

export type FloorStyle = 'carpet-blue' | 'carpet-grey' | 'carpet-teal' | 'carpet-warm' | 'wood' | 'tile' | 'raised' | 'concrete' | 'stone';

export interface Door {
  side: 'N' | 'S' | 'E' | 'W';
  from: number; // absolute tile coordinate along the wall
  to: number;
}

export interface Room {
  id: ZoneId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: FloorStyle;
  walls: boolean;
  glass?: boolean;
  doors: Door[];
}

export interface Desk {
  id: string;
  zone: ZoneId;
  x: number; // tile coords (top-left of the desk)
  y: number;
  w: number;
  facing: 'N' | 'S';
  seat: Point; // world px
  pcPos: Point; // world px
  port: string; // wall port label
  switchId: string;
  switchPort: number; // access port index on the zone switch
}

export type FurnKind =
  | 'table'
  | 'roundtable'
  | 'chair'
  | 'sofa'
  | 'plant'
  | 'counter'
  | 'rack'
  | 'shelf'
  | 'bench'
  | 'whiteboard'
  | 'tv'
  | 'pingpong'
  | 'fridge'
  | 'coffee'
  | 'crac'
  | 'beanbag'
  | 'cabinet'
  | 'reception'
  | 'bigscreen'
  | 'toilet';

export interface Furn {
  kind: FurnKind;
  x: number;
  y: number;
  w: number;
  h: number;
  blocks: boolean;
  color?: string;
  label?: string;
}

export interface Seat {
  id: string;
  zone: ZoneId;
  pos: Point;
  kind: 'meeting' | 'kitchen' | 'lounge' | 'visitor';
}

export const tileCenter = (tx: number, ty: number): Point => ({ x: tx * T + T / 2, y: ty * T + T / 2 });
const at = (tx: number, ty: number): Point => ({ x: tx * T, y: ty * T });

/*
 * Compact floor plan (48 x 30 tiles):
 *
 *  +--------+---------+------------------+--------------+
 *  | SERVER |  NOC    |  ENGINEERING     |  DESIGN      |  y 0-10
 *  +--------+---------+------------------+--------------+
 *  |                  corridor                          |  y 10-13
 *  +--------+--+------+------+-----------+--------------+
 *  |FINANCE |H | QA   | MGR  |  ATLAS    |  BOREALIS    |  y 13-21
 *  +--------+  +------+------+-----------+--------------+
 *  | RECEPTION       corridor                           |  y 21-24
 *  |         +----+---------------+---------------------+
 *  |  (entry)| WC |   KITCHEN     |   LOUNGE            |  y 24-30
 *  +---------+----+---------------+---------------------+
 */
export const ROOMS: Room[] = [
  { id: 'server', name: 'Server Room', x: 0, y: 0, w: 8, h: 10, floor: 'raised', walls: true, doors: [{ side: 'E', from: 6, to: 8 }] },
  { id: 'noc', name: 'NOC', x: 8, y: 0, w: 9, h: 10, floor: 'carpet-teal', walls: true, doors: [{ side: 'W', from: 6, to: 8 }, { side: 'S', from: 11, to: 14 }] },
  { id: 'eng', name: 'Engineering', x: 17, y: 0, w: 17, h: 10, floor: 'carpet-blue', walls: true, doors: [{ side: 'S', from: 23, to: 28 }] },
  { id: 'design', name: 'Design Studio', x: 34, y: 0, w: 14, h: 10, floor: 'carpet-warm', walls: true, doors: [{ side: 'S', from: 39, to: 43 }] },
  { id: 'finance', name: 'Finance', x: 0, y: 13, w: 9, h: 8, floor: 'carpet-grey', walls: true, doors: [{ side: 'N', from: 5, to: 7 }] },
  { id: 'qa', name: 'QA', x: 11, y: 13, w: 9, h: 8, floor: 'carpet-teal', walls: true, doors: [{ side: 'N', from: 14, to: 17 }] },
  { id: 'mgr', name: 'Manager', x: 20, y: 13, w: 7, h: 8, floor: 'wood', walls: true, doors: [{ side: 'N', from: 22, to: 24 }] },
  { id: 'atlas', name: 'Meeting · Atlas', x: 27, y: 13, w: 10, h: 8, floor: 'carpet-grey', walls: true, glass: true, doors: [{ side: 'N', from: 31, to: 33 }] },
  { id: 'borealis', name: 'Meeting · Borealis', x: 37, y: 13, w: 11, h: 8, floor: 'carpet-grey', walls: true, glass: true, doors: [{ side: 'N', from: 41, to: 43 }] },
  { id: 'reception', name: 'Reception', x: 0, y: 21, w: 11, h: 9, floor: 'stone', walls: false, doors: [] },
  { id: 'kitchen', name: 'Kitchen', x: 16, y: 24, w: 16, h: 6, floor: 'tile', walls: true, doors: [{ side: 'N', from: 22, to: 26 }] },
  { id: 'lounge', name: 'Lounge', x: 32, y: 24, w: 16, h: 6, floor: 'wood', walls: false, doors: [] },
];

/** Restrooms are a non-zone service room. */
export const RESTROOM = { x: 11, y: 24, w: 5, h: 6, door: { side: 'N' as const, from: 13, to: 15 } };

/** Building entrance (south wall), in tiles. */
export const ENTRANCE = { from: 4, to: 7 };
export const SPAWN: Point = { x: 5.5 * T, y: (BH + 4) * T };
export const ENTRY_INSIDE: Point = tileCenter(5, 28);

export const POI = {
  coffee: at(18.5, 27.5),
  water: at(30, 27.5),
  fridge: at(24, 27.5),
  restroom: at(13.5, 27),
  restroomDoor: at(13.5, 24.5),
  nocVisit: at(10.6, 8.2),
  nocVisit2: at(15.2, 8.2),
  lobby: at(5, 27),
  pingpong: at(39.5, 28.2),
};

// ---------------------------------------------------------------------------
// Desks

function pod(zone: ZoneId, x: number, y: number, prefix: string, start: number, switchId: string, portStart: number): Desk[] {
  const out: Desk[] = [];
  const spots = [
    { dx: 0, dy: 0, facing: 'S' as const },
    { dx: 2, dy: 0, facing: 'S' as const },
    { dx: 0, dy: 1, facing: 'N' as const },
    { dx: 2, dy: 1, facing: 'N' as const },
  ];
  spots.forEach((s, i) => {
    const dx = x + s.dx;
    const dy = y + s.dy;
    const seat = s.facing === 'S' ? { x: (dx + 1) * T, y: (dy - 0.45) * T } : { x: (dx + 1) * T, y: (dy + 1.45) * T };
    const pcPos = s.facing === 'S' ? { x: (dx + 1) * T, y: (dy + 0.55) * T } : { x: (dx + 1) * T, y: (dy + 0.45) * T };
    const n = start + i;
    const id = `${prefix}-${String(n).padStart(2, '0')}`;
    out.push({ id, zone, x: dx, y: dy, w: 2, facing: s.facing, seat, pcPos, port: id, switchId, switchPort: portStart + i });
  });
  return out;
}

export const DESKS: Desk[] = [
  // Engineering — SW-ENG ports 1..12
  ...pod('eng', 18, 3, 'ENG', 1, 'sw-eng', 1),
  ...pod('eng', 23, 3, 'ENG', 5, 'sw-eng', 5),
  ...pod('eng', 28, 3, 'ENG', 9, 'sw-eng', 9),
  // Design — SW-DQA ports 1..8
  ...pod('design', 36, 3, 'DSN', 1, 'sw-dqa', 1),
  ...pod('design', 41, 3, 'DSN', 5, 'sw-dqa', 5),
  // QA — SW-DQA ports 9..12
  ...pod('qa', 12, 16, 'QA', 1, 'sw-dqa', 9),
  // Finance — SW-OFFICE ports 1..4
  ...pod('finance', 2, 16, 'FIN', 1, 'sw-office', 1),
  // Manager — SW-OFFICE port 5
  { id: 'MGR-01', zone: 'mgr', x: 21, y: 15, w: 3, facing: 'S', seat: at(22.5, 14.55), pcPos: at(22.5, 15.55), port: 'MGR-01', switchId: 'sw-office', switchPort: 5 },
  // Reception — SW-OFFICE port 6
  { id: 'RCP-01', zone: 'reception', x: 4, y: 23, w: 3, facing: 'S', seat: at(5.5, 22.55), pcPos: at(5.5, 23.55), port: 'RCP-01', switchId: 'sw-office', switchPort: 6 },
];

// ---------------------------------------------------------------------------
// Furniture

const desksAsFurn: Furn[] = DESKS.filter((d) => d.id !== 'RCP-01').map((d) => ({ kind: 'table', x: d.x, y: d.y, w: d.w, h: 1, blocks: true, color: '#d6a868' }));

export const FURNITURE: Furn[] = [
  ...desksAsFurn,
  // Server room
  { kind: 'rack', x: 0.9, y: 1.2, w: 2.2, h: 4.6, blocks: true, label: 'RACK A' },
  { kind: 'rack', x: 3.3, y: 1.2, w: 2.2, h: 4.6, blocks: true, label: 'RACK B' },
  { kind: 'rack', x: 5.7, y: 1.2, w: 2.2, h: 4.6, blocks: true, label: 'RACK C' },
  { kind: 'crac', x: 0.7, y: 8.2, w: 3.2, h: 1.3, blocks: true },
  // NOC
  { kind: 'table', x: 9.8, y: 3.4, w: 6.4, h: 1.4, blocks: true, color: '#8a9aa0', label: 'NOC desk' },
  { kind: 'bigscreen', x: 9.6, y: 0.2, w: 6.8, h: 0.4, blocks: false },
  { kind: 'plant', x: 15.6, y: 0.6, w: 1.1, h: 1.1, blocks: true },
  // Engineering
  { kind: 'whiteboard', x: 29, y: 9.45, w: 4.5, h: 0.35, blocks: false },
  { kind: 'sofa', x: 30, y: 7.2, w: 3, h: 1.1, blocks: true, color: '#e8b04a' },
  { kind: 'plant', x: 33, y: 0.3, w: 1, h: 1, blocks: true },
  { kind: 'plant', x: 17.2, y: 0.3, w: 1, h: 1, blocks: true },
  // Design
  { kind: 'table', x: 36.5, y: 7.4, w: 4, h: 1.6, blocks: true, color: '#f3e3c6', label: 'Mood board' },
  { kind: 'plant', x: 46.9, y: 0.3, w: 1, h: 1, blocks: true },
  // Finance
  { kind: 'cabinet', x: 0.2, y: 17, w: 0.8, h: 3, blocks: true, label: 'Files' },
  { kind: 'plant', x: 0.3, y: 13.3, w: 1, h: 1, blocks: true },
  // QA
  { kind: 'bench', x: 17.2, y: 14.6, w: 2.4, h: 4, blocks: true, label: 'Test bench' },
  // Manager
  { kind: 'shelf', x: 24.5, y: 13.2, w: 2.3, h: 0.6, blocks: true },
  { kind: 'roundtable', x: 24.2, y: 17.4, w: 2.2, h: 2.2, blocks: true },
  { kind: 'sofa', x: 20.4, y: 19.5, w: 3, h: 1.2, blocks: true, color: '#c97c5d' },
  { kind: 'plant', x: 20.2, y: 13.3, w: 1, h: 1, blocks: true },
  // Meeting rooms
  { kind: 'table', x: 29, y: 16, w: 6, h: 2.4, blocks: true, color: '#f4f4f2', label: 'Atlas' },
  { kind: 'tv', x: 30, y: 20.5, w: 4, h: 0.35, blocks: false },
  { kind: 'plant', x: 27.3, y: 19.7, w: 1, h: 1, blocks: true },
  { kind: 'table', x: 40, y: 16, w: 5, h: 2.4, blocks: true, color: '#f4f4f2', label: 'Borealis' },
  { kind: 'tv', x: 40.5, y: 20.5, w: 4, h: 0.35, blocks: false },
  { kind: 'plant', x: 46.8, y: 19.7, w: 1, h: 1, blocks: true },
  // Reception
  { kind: 'reception', x: 4, y: 23, w: 3, h: 1, blocks: true },
  { kind: 'sofa', x: 0.35, y: 25.2, w: 1.2, h: 3, blocks: true, color: '#d9b88c' },
  { kind: 'plant', x: 0.3, y: 28.8, w: 1, h: 1, blocks: true },
  { kind: 'plant', x: 9.8, y: 28.8, w: 1, h: 1, blocks: true },
  // Restroom
  { kind: 'toilet', x: 11.4, y: 28.2, w: 1.4, h: 1.6, blocks: true },
  { kind: 'toilet', x: 14.2, y: 28.2, w: 1.4, h: 1.6, blocks: true },
  // Kitchen
  { kind: 'counter', x: 17, y: 28.6, w: 14, h: 1.3, blocks: true },
  { kind: 'coffee', x: 17.6, y: 28.7, w: 1, h: 1, blocks: true },
  { kind: 'fridge', x: 23.4, y: 28.5, w: 1.2, h: 1.4, blocks: true },
  { kind: 'roundtable', x: 19.5, y: 25.3, w: 2, h: 2, blocks: true },
  { kind: 'roundtable', x: 26.5, y: 25.3, w: 2, h: 2, blocks: true },
  // Lounge
  { kind: 'sofa', x: 32.6, y: 24.8, w: 1.2, h: 3.4, blocks: true, color: '#7cb3a3' },
  { kind: 'table', x: 34.4, y: 25.6, w: 1.6, h: 1.6, blocks: true, color: '#c9a06a' },
  { kind: 'pingpong', x: 37.6, y: 24.9, w: 4, h: 2.4, blocks: true },
  { kind: 'beanbag', x: 43.2, y: 24.8, w: 1.4, h: 1.4, blocks: true, color: '#e07a5f' },
  { kind: 'beanbag', x: 45.6, y: 25.6, w: 1.4, h: 1.4, blocks: true, color: '#f2cc8f' },
  { kind: 'beanbag', x: 43.6, y: 27.6, w: 1.4, h: 1.4, blocks: true, color: '#81b29a' },
  { kind: 'plant', x: 46.9, y: 28.8, w: 1, h: 1, blocks: true },
];

export const SEATS: Seat[] = (() => {
  const s: Seat[] = [];
  // Atlas: 6x2.4 table at (29,16)
  for (let i = 0; i < 4; i++) {
    s.push({ id: `atl-n${i}`, zone: 'atlas', pos: at(29.8 + i * 1.5, 15.45), kind: 'meeting' });
    s.push({ id: `atl-s${i}`, zone: 'atlas', pos: at(29.8 + i * 1.5, 18.95), kind: 'meeting' });
  }
  // Borealis: 5x2.4 table at (40,16)
  for (let i = 0; i < 3; i++) {
    s.push({ id: `bor-n${i}`, zone: 'borealis', pos: at(40.8 + i * 1.7, 15.45), kind: 'meeting' });
    s.push({ id: `bor-s${i}`, zone: 'borealis', pos: at(40.8 + i * 1.7, 18.95), kind: 'meeting' });
  }
  // Kitchen tables
  for (const [cx, cy] of [
    [20.5, 26.3],
    [27.5, 26.3],
  ]) {
    s.push({ id: `kit-${cx}-a`, zone: 'kitchen', pos: at(cx - 1.55, cy), kind: 'kitchen' });
    s.push({ id: `kit-${cx}-b`, zone: 'kitchen', pos: at(cx + 1.55, cy), kind: 'kitchen' });
    s.push({ id: `kit-${cx}-c`, zone: 'kitchen', pos: at(cx, cy - 1.5), kind: 'kitchen' });
  }
  // Lounge
  s.push({ id: 'lng-sofa1', zone: 'lounge', pos: at(34.2, 25.3), kind: 'lounge' });
  s.push({ id: 'lng-sofa2', zone: 'lounge', pos: at(34.2, 27.7), kind: 'lounge' });
  s.push({ id: 'lng-pp1', zone: 'lounge', pos: at(37.1, 26.1), kind: 'lounge' });
  s.push({ id: 'lng-pp2', zone: 'lounge', pos: at(42.1, 26.1), kind: 'lounge' });
  s.push({ id: 'lng-bb1', zone: 'lounge', pos: at(43.9, 25.5), kind: 'lounge' });
  s.push({ id: 'lng-bb2', zone: 'lounge', pos: at(46.3, 26.3), kind: 'lounge' });
  s.push({ id: 'lng-bb3', zone: 'lounge', pos: at(44.3, 28.3), kind: 'lounge' });
  // Reception visitors
  s.push({ id: 'rcp-v1', zone: 'reception', pos: at(1.9, 26), kind: 'visitor' });
  s.push({ id: 'rcp-v2', zone: 'reception', pos: at(1.9, 27.5), kind: 'visitor' });
  // Manager round table
  s.push({ id: 'mgr-t1', zone: 'mgr', pos: at(23.6, 18.5), kind: 'meeting' });
  s.push({ id: 'mgr-t2', zone: 'mgr', pos: at(26.6, 18.5), kind: 'meeting' });
  return s;
})();

/** Player's own chair at the NOC desk. */
export const NOC_SEAT: Point = at(13, 5.45);

// ---------------------------------------------------------------------------
// Network equipment placement (world px). Rack slabs are 2 tiles wide.

export const EQUIP_POS: Record<string, Point> = {
  // Rack C (closest to the NOC): ISP handoff, firewall, core
  'isp-gw': at(6.8, 2.3),
  'fw-edge': at(6.8, 3.6),
  'core-sw1': at(6.8, 4.9),
  // Racks A & B: servers
  'srv-dc01': at(2.0, 2.3),
  'srv-file': at(2.0, 3.6),
  'srv-git': at(2.0, 4.9),
  'srv-app': at(4.4, 2.3),
  'srv-backup': at(4.4, 3.6),
  'sw-eng': at(18.1, 8.3),
  'sw-dqa': at(34.8, 8.3),
  'sw-office': at(8.15, 14.6),
  'ap-eng': at(25.5, 7.6),
  'ap-dsgn': at(41, 7.6),
  'ap-qa': at(17.8, 19.8),
  'ap-mtg': at(27.2, 16.5),
  'ap-lobby': at(8.5, 26.5),
  'prn-eng': at(32.7, 8.6),
  'prn-dsgn': at(46.9, 8.6),
  'prn-fin': at(7.6, 19.9),
  'noc-pc': at(13, 3.8),
  'cam-lobby': at(0.8, 21.6),
  'vc-atlas': at(32, 20.3),
  'signage-lobby': at(10.2, 27.4),
  'rogue-tplink': at(19.2, 19.4),
  'rogue-pi': at(36.2, 20.1),
};

/** Big status screen on the NOC wall (world px). */
export const NOC_SCREEN = { x: 9.6 * T, y: 0.2 * T, w: 6.8 * T };
/** Rooms that stay lit at night (server room + NOC). */
export const ALWAYS_LIT = { x: 0, y: 0, w: 17 * T, h: 10 * T };
/** Camera target for the "NOC" map button. */
export const NOC_VIEW = at(8.5, 5);

/** Wall ports in meeting rooms / benches that could receive rogue devices. */
export const SPARE_WALL_PORTS: { label: string; zone: ZoneId; pos: Point; switchId: string; switchPort: number }[] = [
  { label: 'ATL-01', zone: 'atlas', pos: at(27.5, 13.6), switchId: 'sw-office', switchPort: 13 },
  { label: 'ATL-02', zone: 'atlas', pos: at(36.5, 20.4), switchId: 'sw-office', switchPort: 14 },
  { label: 'BOR-01', zone: 'borealis', pos: at(47.5, 13.6), switchId: 'sw-office', switchPort: 15 },
  { label: 'RCP-02', zone: 'reception', pos: at(10.6, 27.6), switchId: 'sw-office', switchPort: 10 },
  { label: 'QA-BENCH', zone: 'qa', pos: at(19.6, 19.4), switchId: 'sw-dqa', switchPort: 15 },
  { label: 'ENG-HUD', zone: 'eng', pos: at(33.6, 9.5), switchId: 'sw-eng', switchPort: 15 },
];

// ---------------------------------------------------------------------------
// Navigation grid: tiles with blocked cells (furniture) and blocked edges (walls).

export interface NavGrid {
  w: number;
  h: number;
  blocked: Uint8Array;
  /** edge blocking: bit 1 = cannot move east from cell, bit 2 = cannot move south */
  edges: Uint8Array;
}

export interface WallSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  glass: boolean;
  exterior: boolean;
}

/** Build wall segments (tile units) with door gaps removed. */
export function buildWalls(): WallSeg[] {
  const segs: WallSeg[] = [];
  const addH = (y: number, x1: number, x2: number, gaps: [number, number][], glass = false, exterior = false) => {
    let cur = x1;
    for (const [g1, g2] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g1 > cur) segs.push({ x1: cur, y1: y, x2: g1, y2: y, glass, exterior });
      cur = Math.max(cur, g2);
    }
    if (cur < x2) segs.push({ x1: cur, y1: y, x2, y2: y, glass, exterior });
  };
  const addV = (x: number, y1: number, y2: number, gaps: [number, number][], glass = false, exterior = false) => {
    let cur = y1;
    for (const [g1, g2] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g1 > cur) segs.push({ x1: x, y1: cur, x2: x, y2: g1, glass, exterior });
      cur = Math.max(cur, g2);
    }
    if (cur < y2) segs.push({ x1: x, y1: cur, x2: x, y2, glass, exterior });
  };
  // exterior
  addH(0, 0, BW, [], false, true);
  addH(BH, 0, BW, [[ENTRANCE.from, ENTRANCE.to]], false, true);
  addV(0, 0, BH, [], false, true);
  addV(BW, 0, BH, [], false, true);
  for (const r of ROOMS) {
    if (!r.walls) continue;
    const gaps = (side: Door['side']) => r.doors.filter((d) => d.side === side).map((d) => [d.from, d.to] as [number, number]);
    if (r.y > 0) addH(r.y, r.x, r.x + r.w, gaps('N'), !!r.glass);
    if (r.y + r.h < BH) addH(r.y + r.h, r.x, r.x + r.w, gaps('S'), !!r.glass);
    if (r.x > 0) addV(r.x, r.y, r.y + r.h, gaps('W'), !!r.glass);
    if (r.x + r.w < BW) addV(r.x + r.w, r.y, r.y + r.h, gaps('E'), !!r.glass);
  }
  // restroom block
  const rr = RESTROOM;
  addH(rr.y, rr.x, rr.x + rr.w, [[rr.door.from, rr.door.to]]);
  addV(rr.x, rr.y, rr.y + rr.h, []);
  addV(rr.x + rr.w, rr.y, rr.y + rr.h, []);
  return dedupeWalls(segs);
}

function dedupeWalls(segs: WallSeg[]): WallSeg[] {
  const seen = new Set<string>();
  return segs.filter((s) => {
    const k = `${s.x1},${s.y1},${s.x2},${s.y2}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** All door openings (tile units) — drawn as door mats. */
export function doorOpenings(): { x1: number; y1: number; x2: number; y2: number; exterior: boolean }[] {
  const out: { x1: number; y1: number; x2: number; y2: number; exterior: boolean }[] = [];
  for (const r of ROOMS) {
    if (!r.walls) continue;
    for (const d of r.doors) {
      if (d.side === 'N') out.push({ x1: d.from, y1: r.y, x2: d.to, y2: r.y, exterior: false });
      if (d.side === 'S') out.push({ x1: d.from, y1: r.y + r.h, x2: d.to, y2: r.y + r.h, exterior: false });
      if (d.side === 'W') out.push({ x1: r.x, y1: d.from, x2: r.x, y2: d.to, exterior: false });
      if (d.side === 'E') out.push({ x1: r.x + r.w, y1: d.from, x2: r.x + r.w, y2: d.to, exterior: false });
    }
  }
  out.push({ x1: RESTROOM.door.from, y1: RESTROOM.y, x2: RESTROOM.door.to, y2: RESTROOM.y, exterior: false });
  out.push({ x1: ENTRANCE.from, y1: BH, x2: ENTRANCE.to, y2: BH, exterior: true });
  // dedupe shared doors (e.g. server room ↔ NOC)
  const seen = new Set<string>();
  return out.filter((o) => {
    const k = `${o.x1},${o.y1},${o.x2},${o.y2}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function buildNavGrid(walls: WallSeg[]): NavGrid {
  // extend grid below the building so people can walk in from outside
  const w = BW;
  const h = BH + 6;
  const blocked = new Uint8Array(w * h);
  const edges = new Uint8Array(w * h);
  for (const f of FURNITURE) {
    if (!f.blocks) continue;
    const x1 = Math.floor(f.x + 0.15);
    const y1 = Math.floor(f.y + 0.15);
    const x2 = Math.ceil(f.x + f.w - 0.15);
    const y2 = Math.ceil(f.y + f.h - 0.15);
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (x >= 0 && y >= 0 && x < w && y < h) blocked[y * w + x] = 1;
  }
  for (const s of walls) {
    if (s.y1 === s.y2) {
      // horizontal wall at y: blocks moving south from (x, y-1) to (x, y)
      const y = s.y1;
      for (let x = s.x1; x < s.x2; x++) if (y - 1 >= 0 && y - 1 < h) edges[(y - 1) * w + x] |= 2;
    } else {
      const x = s.x1;
      for (let y = s.y1; y < s.y2; y++) if (x - 1 >= 0) edges[y * w + (x - 1)] |= 1;
    }
  }
  return { w, h, blocked, edges };
}

export const WORLD_W = BW * T;
export const WORLD_H = BH * T;
