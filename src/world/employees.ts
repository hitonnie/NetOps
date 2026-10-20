/**
 * Employee generation and behaviour: arrival/departure, desk work, breaks,
 * meetings, printing, chatting, lunch and — when the network is broken —
 * frustration, reboots and visits to the NOC.
 */
import { chance, int, next, normal, pick, range, type RngState, shuffle } from '../core/rng';
import { dayIndex, isWeekend, minuteOfDay } from '../core/time';
import type { Point } from '../net/model';
import type { Appearance, EmployeeState, GameState, Meeting } from '../sim/types';
import { DESKS, ENTRY_INSIDE, EQUIP_POS, type NavGrid, POI, SEATS, SPAWN, T } from './layout';
import { findPath } from './pathfinding';
import { MANAGER_ID, PRINTER_FOR_ZONE, ROSTER, type RosterEntry } from './roster';

const SKIN = ['#f6d7c3', '#eac0a2', '#d7a17e', '#c68a62', '#a86b47', '#8d5524', '#6b3f22', '#4a2c19', '#f1c9a5', '#e0ac69'];
const HAIR = ['#1b1b1b', '#2e1f14', '#4a3020', '#6b4428', '#8c5a2b', '#b5813f', '#d9b36c', '#e8d29a', '#8a8a8a', '#c4c4c4', '#7a2e1f', '#3b2a4d'];
const SHIRT = ['#3d6fb6', '#c0504d', '#4f9d69', '#8064a2', '#f2a541', '#2a9d8f', '#e76f51', '#264653', '#e9c46a', '#6c757d', '#d62828', '#457b9d', '#9b5de5', '#00a6a6', '#f15bb5', '#3a5a40'];

export function makeAppearance(r: RngState): Appearance {
  return {
    skin: pick(r, SKIN),
    hair: pick(r, HAIR),
    hairStyle: int(r, 0, 7),
    shirt: pick(r, SHIRT),
    accent: pick(r, SHIRT),
    accessory: chance(r, 0.45) ? int(r, 1, 4) : 0,
    build: range(r, 0.9, 1.12),
  };
}

export function deskOf(empId: string) {
  const r = ROSTER.find((x) => x.id === empId)!;
  return DESKS.find((d) => d.id === r.desk)!;
}

export function rosterOf(empId: string): RosterEntry {
  return ROSTER.find((x) => x.id === empId)!;
}

export function createEmployees(r: RngState): EmployeeState[] {
  return ROSTER.map((ro) => ({
    id: ro.id,
    app: makeAppearance(r),
    arrive: 420,
    leave: 1080,
    lunchAt: 720,
    lunchOut: false,
    lunchedDay: -1,
    state: 'offsite' as const,
    plan: null,
    activity: 'Not in the office',
    pos: { ...SPAWN },
    path: [],
    speed: range(r, 170, 240),
    facing: 0,
    until: 0,
    nextDecision: 0,
    frustration: 0,
    health: 1,
    healthDetail: '',
    failing: [],
    blockedSince: null,
    lastEmailAt: -999,
    emailedFor: null,
    lastNocVisit: -999,
    lastReboot: -999,
    present: false,
    bubble: null,
    workRate: 1,
    meetingId: null,
    seat: null,
    patience: range(r, 6, 22),
    chatty: next(r),
  }));
}

/** Plan arrivals, departures, lunches and meetings for a new day. */
export function planDay(s: GameState, r: RngState): void {
  const day = dayIndex(s.t);
  for (const e of s.employees) {
    const isMgr = e.id === MANAGER_ID;
    let arrive = normal(r, isMgr ? 450 : 422, 14);
    if (chance(r, 0.1)) arrive += range(r, 30, 100); // running late
    e.arrive = Math.max(385, Math.min(arrive, 600));
    e.leave = Math.max(990, Math.min(normal(r, isMgr ? 1125 : 1080, 22), 1170));
    if (chance(r, 0.07)) e.leave = range(r, 960, 1010); // leaving early today
    e.lunchAt = normal(r, 735, 22);
    e.lunchOut = chance(r, 0.4);
    e.frustration = Math.max(0, e.frustration - 30);
    e.emailedFor = null;
    if (!e.present) e.activity = 'Not in the office';
  }
  // meetings
  const base = day * 1440;
  const titles = ['Sprint planning', 'Design review', 'Budget review', 'QA triage', 'Architecture sync', 'Customer call', 'Retro', 'Roadmap review', 'Hiring panel', 'Incident review', 'Standup (extended)', 'Vendor demo'];
  const meetings: Meeting[] = [];
  const n = int(r, 4, 7);
  const ids = s.employees.map((e) => e.id).filter((id) => id !== 'o-mthompson');
  for (let k = 0; k < n; k++) {
    const room = pick(r, ['atlas', 'borealis', 'atlas'] as const);
    const start = base + 540 + int(r, 0, 15) * 30;
    const dur = pick(r, [30, 45, 60, 60]);
    if (meetings.some((m) => m.room === room && start < m.end && start + dur > m.start)) continue;
    const size = room === 'atlas' ? int(r, 3, 7) : int(r, 2, 5);
    const pool = shuffle(r, [...ids]);
    const att = pool.filter((id) => !meetings.some((m) => m.attendees.includes(id) && start < m.end && start + dur > m.start)).slice(0, size);
    meetings.push({ id: `m${day}-${k}`, room, title: pick(r, titles), start, end: start + dur, attendees: att });
  }
  // manager 1:1s in the manager's office
  for (let k = 0; k < 2; k++) {
    const start = base + 600 + int(r, 0, 12) * 30;
    const who = pick(r, ids.filter((id) => id !== MANAGER_ID));
    meetings.push({ id: `m${day}-1on1-${k}`, room: 'mgr', title: '1:1', start, end: start + 30, attendees: [MANAGER_ID, who] });
  }
  s.meetings = meetings;
}

// ---------------------------------------------------------------------------
// Behaviour

export interface PeopleHost {
  s: GameState;
  nav: NavGrid;
  rng: RngState;
  /** called when someone reaches a printer: returns true if the job printed */
  tryPrint(e: EmployeeState): boolean;
  onNocVisit(e: EmployeeState): void;
  onReboot(e: EmployeeState): void;
  onArrived(e: EmployeeState): void;
}

function walkTo(h: PeopleHost, e: EmployeeState, target: Point, plan: EmployeeState['plan'], activity: string): void {
  const jitter = { x: target.x + range(h.rng, -2, 2), y: target.y + range(h.rng, -2, 2) };
  e.path = findPath(h.nav, e.pos, jitter);
  e.state = 'walking';
  e.plan = plan;
  e.activity = activity;
  e.seat = null;
}

function goToDesk(h: PeopleHost, e: EmployeeState, activity = 'Heading back to desk'): void {
  walkTo(h, e, deskOf(e.id).seat, { kind: 'working' }, activity);
}

function freeSeat(h: PeopleHost, zone: string, kind: string): { id: string; pos: Point } | null {
  const taken = new Set(h.s.employees.map((x) => x.seat).filter(Boolean));
  const planned = new Set(h.s.employees.map((x) => x.plan?.seat).filter(Boolean));
  const options = SEATS.filter((s) => (zone === '*' || s.zone === zone) && s.kind === kind && !taken.has(s.id) && !planned.has(s.id));
  if (!options.length) return null;
  const s = pick(h.rng, options);
  return { id: s.id, pos: s.pos };
}

export function updateMovement(h: PeopleHost, dtMin: number): void {
  for (const e of h.s.employees) {
    if (!e.present || e.state !== 'walking') continue;
    let budget = e.speed * dtMin;
    while (budget > 0 && e.path.length) {
      const tgt = e.path[0];
      const dx = tgt.x - e.pos.x;
      const dy = tgt.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) e.facing = Math.atan2(dy, dx);
      if (d <= budget) {
        e.pos = { x: tgt.x, y: tgt.y };
        e.path.shift();
        budget -= d;
      } else {
        e.pos = { x: e.pos.x + (dx / d) * budget, y: e.pos.y + (dy / d) * budget };
        budget = 0;
      }
    }
    if (!e.path.length) arrive(h, e);
  }
}

function arrive(h: PeopleHost, e: EmployeeState): void {
  const p = e.plan;
  const now = h.s.t;
  e.plan = null;
  if (!p) {
    e.state = 'working';
    return;
  }
  switch (p.kind) {
    case 'leave':
      e.present = false;
      e.state = 'offsite';
      e.activity = e.lunchOut && e.until > now ? 'Out for lunch' : 'Gone home';
      return;
    case 'working':
    case 'arrive': {
      const desk = deskOf(e.id);
      e.state = 'working';
      e.activity = 'Working at desk';
      e.facing = desk.facing === 'S' ? Math.PI / 2 : -Math.PI / 2;
      e.nextDecision = now + range(h.rng, 12, 45);
      if (p.kind === 'arrive') h.onArrived(e);
      return;
    }
    case 'meeting':
      e.state = 'meeting';
      e.seat = p.seat ?? null;
      e.until = p.until ?? now + 30;
      e.activity = `In a meeting`;
      return;
    case 'printing': {
      e.state = 'printing';
      e.until = now + range(h.rng, 1.5, 3);
      const ok = h.tryPrint(e);
      e.activity = ok ? 'Collecting a print-out' : 'Waiting for a print job that never comes';
      if (!ok) e.bubble = { icon: 'printer-x', until: now + 6 };
      return;
    }
    case 'visiting':
      e.state = 'visiting';
      e.until = now + range(h.rng, 4, 8);
      e.activity = 'At the NOC asking about the network';
      e.bubble = { icon: 'question', until: e.until };
      h.onNocVisit(e);
      return;
    default:
      e.state = p.kind;
      e.seat = p.seat ?? null;
      e.until = p.until ?? now + 10;
  }
}

export function decideMinute(h: PeopleHost): void {
  const s = h.s;
  const now = s.t;
  const mod = minuteOfDay(now);
  const weekend = isWeekend(now);
  for (const e of s.employees) {
    if (e.bubble && e.bubble.until < now) e.bubble = null;
    if (!e.present) {
      if (weekend) continue;
      const returningFromLunch = e.lunchOut && e.activity === 'Out for lunch' && now >= e.until;
      if ((mod >= e.arrive && mod < e.leave - 45 && e.activity !== 'Gone home' && e.activity !== 'Out for lunch') || returningFromLunch) {
        e.present = true;
        e.pos = { x: SPAWN.x + range(h.rng, -40, 40), y: SPAWN.y + range(h.rng, -10, 20) };
        const target = deskOf(e.id).seat;
        e.path = [ENTRY_INSIDE, ...findPath(h.nav, ENTRY_INSIDE, target)];
        e.state = 'walking';
        e.plan = { kind: 'arrive' };
        e.activity = returningFromLunch ? 'Back from lunch' : mod > e.arrive + 40 ? 'Arriving (running late)' : 'Arriving at work';
      }
      continue;
    }
    // leaving for the day
    if (mod >= e.leave && e.plan?.kind !== 'leave' && e.state !== 'meeting') {
      walkTo(h, e, SPAWN, { kind: 'leave' }, 'Heading home');
      continue;
    }
    if (e.state === 'walking') continue;
    // meetings
    const mt = s.meetings.find((m) => m.attendees.includes(e.id) && m.start - 3 <= now && now < m.end - 5);
    if (mt && e.state !== 'meeting' && e.meetingId !== mt.id) {
      e.meetingId = mt.id;
      const seat = freeSeat(h, mt.room, 'meeting');
      const pos = seat?.pos ?? (mt.room === 'mgr' ? deskOf(MANAGER_ID).seat : { x: 32 * T, y: 17 * T });
      if (mt.room === 'mgr' && e.id === MANAGER_ID) {
        const p = { kind: 'meeting' as const, until: mt.end, seat: seat?.id };
        walkTo(h, e, pos, p, `Walking to "${mt.title}"`);
      } else walkTo(h, e, pos, { kind: 'meeting', until: mt.end, seat: seat?.id }, `Walking to "${mt.title}"`);
      continue;
    }
    // end of timed activity
    if (e.state !== 'working' && now >= e.until) {
      if (e.state === 'meeting') e.meetingId = null;
      if (e.plan?.kind === 'leave') continue;
      goToDesk(h, e);
      continue;
    }
    if (e.state !== 'working') continue;
    // lunch
    if (mod >= e.lunchAt && mod < e.lunchAt + 90 && e.lunchedDay !== dayIndex(now)) {
      e.lunchedDay = dayIndex(now);
      const dur = range(h.rng, 28, 55);
      if (e.lunchOut) {
        // walking out; the offsite branch brings them back when e.until passes
        walkTo(h, e, { x: SPAWN.x + range(h.rng, -60, 60), y: SPAWN.y }, { kind: 'leave' }, 'Going out for lunch');
        e.until = now + dur + 6;
      } else {
        const seat = freeSeat(h, 'kitchen', 'kitchen');
        walkTo(h, e, seat?.pos ?? POI.coffee, { kind: 'break', until: now + dur, seat: seat?.id }, 'Lunch in the kitchen');
      }
      continue;
    }
    // network trouble reactions
    const blockedFor = e.blockedSince !== null ? now - e.blockedSince : 0;
    if (blockedFor > 18 && now - e.lastReboot > 70 && chance(h.rng, 0.25)) {
      e.lastReboot = now;
      e.activity = 'Restarting their computer';
      e.bubble = { icon: 'restart', until: now + 4 };
      h.onReboot(e);
      e.nextDecision = now + 8;
      continue;
    }
    if (e.frustration > 55 && blockedFor > 25 && now - e.lastNocVisit > 150 && chance(h.rng, 0.12)) {
      e.lastNocVisit = now;
      walkTo(h, e, chance(h.rng, 0.5) ? POI.nocVisit : POI.nocVisit2, { kind: 'visiting' }, 'Walking to the NOC');
      continue;
    }
    if (now < e.nextDecision) continue;
    e.nextDecision = now + range(h.rng, 14, 55);
    const ro = rosterOf(e.id);
    const morningCoffee = mod > 570 && mod < 640;
    const afternoon = mod > 870 && mod < 960;
    const opts: { w: number; f: () => void }[] = [
      { w: 6, f: () => {} },
      {
        w: morningCoffee || afternoon ? 1.4 : 0.5,
        f: () => {
          if (chance(h.rng, 0.5)) {
            const seat = freeSeat(h, 'kitchen', 'kitchen');
            walkTo(h, e, seat?.pos ?? POI.coffee, { kind: 'break', until: now + range(h.rng, 6, 14), seat: seat?.id }, 'Coffee break');
          } else walkTo(h, e, chance(h.rng, 0.6) ? POI.coffee : POI.water, { kind: 'break', until: now + range(h.rng, 2, 5) }, 'Grabbing a coffee');
        },
      },
      { w: 0.35, f: () => walkTo(h, e, POI.restroom, { kind: 'restroom', until: now + range(h.rng, 3, 6) }, 'Restroom break') },
      {
        w: 0.6 * e.chatty,
        f: () => {
          const peers = s.employees.filter((x) => x !== e && x.present && x.state === 'working' && rosterOf(x.id).zone === ro.zone);
          if (!peers.length) return;
          const peer = pick(h.rng, peers);
          const ps = deskOf(peer.id).seat;
          walkTo(h, e, { x: ps.x + range(h.rng, -26, 26), y: ps.y + (deskOf(peer.id).facing === 'S' ? -20 : 20) }, { kind: 'chatting', until: now + range(h.rng, 3, 9) }, `Chatting with ${peer.id === MANAGER_ID ? 'Dana' : rosterOf(peer.id).name.split(' ')[0]}`);
        },
      },
      {
        w: ro.dept === 'Finance' ? 0.7 : ro.dept === 'Design' ? 0.45 : 0.18,
        f: () => {
          const prn = PRINTER_FOR_ZONE[ro.zone];
          if (!prn) return;
          const p = EQUIP_POS[prn];
          walkTo(h, e, { x: p.x + range(h.rng, -10, 10), y: p.y + 26 }, { kind: 'printing' }, 'Walking to the printer');
        },
      },
      {
        w: afternoon ? 0.35 : 0.08,
        f: () => {
          const seat = freeSeat(h, 'lounge', 'lounge');
          if (seat) walkTo(h, e, seat.pos, { kind: 'break', until: now + range(h.rng, 8, 18), seat: seat.id }, 'Break in the lounge');
        },
      },
    ];
    const total = opts.reduce((a, b) => a + b.w, 0);
    let x = next(h.rng) * total;
    for (const o of opts) {
      x -= o.w;
      if (x <= 0) {
        o.f();
        break;
      }
    }
  }
}

/** Instantly settle positions after loading a save (no mid-walk restore). */
export function settleAfterLoad(h: PeopleHost): void {
  for (const e of h.s.employees) {
    if (!e.present) {
      e.pos = { ...SPAWN };
      e.path = [];
      continue;
    }
    if (e.state === 'walking') {
      e.path = [];
      e.plan = null;
      e.state = 'working';
      e.pos = { ...deskOf(e.id).seat };
      e.activity = 'Working at desk';
    }
  }
}
