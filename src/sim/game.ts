/**
 * Game: owns the simulation state and orchestrates the subsystems
 * (network engine, employees, incident director, economy, persistence).
 * The UI reads `game.s` and calls the public action methods.
 */
import { chance, int, makeRng, next, pick, range, type RngState, weighted } from '../core/rng';
import { dayIndex, fmtClock, fmtDuration, isWeekend, minuteOfDay } from '../core/time';
import { complaint, type Failing, managerWelcome, NOISE, printerComplaint, thanks } from '../content/messages';
import { SHOP, START_INVENTORY } from '../content/shop';
import { COLLATERAL, SCENARIOS, scenarioById } from '../incidents/scenarios';
import type { ScenarioDef, ScenarioHost, SolutionStep } from '../incidents/types';
import { isUnsaved, restoreStartup, snapshotConfig } from '../net/config';
import { bootMinutes, NetEngine } from '../net/engine';
import { applyStatic, dhcpClientTick, dhcpRelease, dhcpRenew, enableDhcp } from '../net/hosts';
import { isApipa, isValidIp } from '../net/ip';
import { IosShell } from '../net/cli/ios';
import { LinuxShell } from '../net/cli/linux';
import type { Shell, SimApi } from '../net/cli/shell';
import { WindowsShell } from '../net/cli/windows';
import { type Device, type Flow, type Iface, isIos, makeDevice, makeIface, emptyHost } from '../net/model';
import { buildNetwork, connect, nextMac } from '../net/topology';
import { createEmployees, decideMinute, deskOf, type PeopleHost, planDay, rosterOf, settleAfterLoad, updateMovement } from '../world/employees';
import { buildNavGrid, buildWalls, DESKS, EQUIP_POS, type NavGrid, type WallSeg } from '../world/layout';
import { MANAGER_ID, PRINTER_FOR_ZONE, ROSTER, type RosterEntry, SERVICES_BY_DEPT } from '../world/roster';
import type { Email, EmployeeState, GameState, Incident, Task } from './types';

export const SAVE_KEY = 'netops-save-v1';
export const SAVE_VERSION = 4;
export const SPEEDS = [0, 1, 2, 4, 8, 16];
/** sim minutes per real second at 1x */
export const MIN_PER_SEC = 1 / 3;
export const SLA: Record<number, number> = { 1: 30, 2: 60, 3: 120, 4: 240 };
const STEPS_PER_MIN = 50;
const SUB_STEP = 1 / STEPS_PER_MIN;
export const SEV_LABEL: Record<number, string> = { 1: 'P1 Critical', 2: 'P2 High', 3: 'P3 Medium', 4: 'P4 Low' };

export interface Toast {
  id: number;
  kind: 'incident' | 'security' | 'email' | 'manager' | 'good' | 'bad' | 'info';
  title: string;
  body?: string;
  incidentId?: string;
  t: number;
}

export type GameEvent = { type: 'toast'; toast: Toast } | { type: 'flag'; name: string } | { type: 'changed' };

export interface ActionResult {
  ok: boolean;
  msg: string;
}

export function prodLevel(p: number): { label: string; tone: 'good' | 'ok' | 'warn' | 'bad' | 'crit' } {
  if (p >= 90) return { label: 'Excellent', tone: 'good' };
  if (p >= 75) return { label: 'Good', tone: 'ok' };
  if (p >= 60) return { label: 'Degraded', tone: 'warn' };
  if (p >= 40) return { label: 'Poor', tone: 'bad' };
  return { label: 'Critical', tone: 'crit' };
}

export function rankFor(score: number): string {
  if (score < 800) return 'Junior Network Technician';
  if (score < 2500) return 'Network Technician';
  if (score < 5500) return 'Network Engineer (CCNA)';
  if (score < 10000) return 'Senior Network Engineer';
  return 'Principal Network Architect';
}

export function newState(seed: number, opts: { tutorial: boolean; reproducible: boolean; hintMode: 'earned' | 'free' }): GameState {
  const net = buildNetwork();
  const people = makeRng(seed ^ 0x51ed27);
  return {
    version: SAVE_VERSION,
    seed,
    reproducible: opts.reproducible,
    rng: { incidents: makeRng(seed ^ 0x1234567), people, misc: makeRng(seed ^ 0x7777) },
    t: 6 * 60 + 40,
    speed: 1,
    net,
    employees: createEmployees(people),
    meetings: [],
    incidents: [],
    director: { nextAt: 8 * 60 + 25, lastScenarios: [], nightSecurityDay: -1, counter: 0, collateralCooldown: 0 },
    inbox: [],
    tasks: [],
    budget: 12000,
    satisfaction: 70,
    productivity: 100,
    prodSamples: { day: 0, sum: 0, n: 0 },
    prodHistory: [],
    inventory: { ...START_INVENTORY },
    purchases: [],
    manager: [],
    score: 0,
    hintTokens: 3,
    settings: { hintMode: opts.hintMode, autoSlow: true, tutorial: opts.tutorial, cables: 'auto', labels: true, reducedMotion: false },
    tutorial: { step: 0, active: opts.tutorial, done: !opts.tutorial, flags: {} },
    changes: [],
    feed: [],
    gameOver: false,
    days: [],
    seq: 1,
    stats: { resolved: 0, breaches: 0, commands: 0, hintsUsed: 0, securityResolved: 0 },
    lastDailyReport: -1,
    ispRestoreAt: 0,
  };
}

export class Game implements SimApi, ScenarioHost, PeopleHost {
  s: GameState;
  engine: NetEngine;
  nav: NavGrid;
  walls: WallSeg[];
  private shells = new Map<string, Shell>();
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  version = 0;
  private minuteAcc = 0;
  private subStep = 0;
  private toastSeq = 1;
  private lastHealthSlot = -1;
  private laptopPosAt = new Map<string, { x: number; y: number }>();
  private dirtyUi = false;
  private uiTimer = 0;
  skipping = false;

  constructor(state: GameState) {
    this.s = state;
    this.engine = new NetEngine(state.net);
    this.engine.now = state.t;
    this.engine.onLog = null;
    this.walls = buildWalls();
    this.nav = buildNavGrid(this.walls);
    // resume on a whole minute so sub-stepping stays aligned
    this.s.t = Math.floor(this.s.t);
    this.engine.now = this.s.t;
    settleAfterLoad(this);
  }

  static create(seed: number, opts: { tutorial: boolean; reproducible: boolean; hintMode: 'earned' | 'free' }): Game {
    const g = new Game(newState(seed, opts));
    // initial DHCP leases for every client
    for (const d of Object.values(g.s.net.devices)) if (d.host?.dhcp && d.kind !== 'server') dhcpRenew(g.engine, d.id);
    planDay(g.s, g.s.rng.people);
    const w = managerWelcome();
    g.managerMsg(w.subject, w.body, 'info');
    g.feed('Day 1 begins. Employees start arriving around 07:00.', 'info');
    if (!opts.tutorial) g.s.director.nextAt = 8 * 60 + 40;
    g.addRequestTasks();
    return g;
  }

  // ===========================================================================
  // Subscription

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  onEvent(fn: (e: GameEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private emit(e: GameEvent): void {
    for (const l of this.eventListeners) l(e);
  }

  touch(): void {
    this.dirtyUi = true;
  }

  // ===========================================================================
  // Basic accessors (ScenarioHost)

  get e(): NetEngine {
    return this.engine;
  }
  get rng(): RngState {
    return this.s.rng.incidents;
  }
  get now(): number {
    return this.s.t;
  }
  dev(id: string): Device {
    return this.s.net.devices[id];
  }
  deviceOf(empId: string): Device | null {
    return Object.values(this.s.net.devices).find((d) => d.ownerId === empId) ?? null;
  }
  ownerOf(devId: string): RosterEntry | null {
    const d = this.s.net.devices[devId];
    return d?.ownerId ? (ROSTER.find((r) => r.id === d.ownerId) ?? null) : null;
  }
  employee(empId: string): EmployeeState | undefined {
    return this.s.employees.find((e) => e.id === empId);
  }
  hasUpgrade(id: string): boolean {
    return this.s.purchases.includes(id);
  }
  invalidate(): void {
    this.engine.invalidate();
  }

  accessPort(devId: string): { sw: Device; port: Iface } | null {
    const d = this.dev(devId);
    if (!d) return null;
    for (const i of d.ifaces) {
      const p = this.engine.peerOf(d.id, i.name);
      if (!p) continue;
      let pd = this.dev(p.dev);
      let pi = pd?.ifaces.find((x) => x.name === p.iface);
      if (pd?.rogue?.bridge) {
        // follow through an unmanaged desk switch
        for (const ri of pd.ifaces) {
          const q = this.engine.peerOf(pd.id, ri.name);
          if (q && q.dev !== d.id) {
            pd = this.dev(q.dev);
            pi = pd.ifaces.find((x) => x.name === q.iface);
            break;
          }
        }
      }
      if (pd && pi && (pd.kind === 'switch' || pd.kind === 'l3switch')) return { sw: pd, port: pi };
    }
    return null;
  }

  hostsInVlan(vlan: number): Device[] {
    return Object.values(this.s.net.devices).filter((d) => {
      if (!['pc', 'laptop', 'printer'].includes(d.kind)) return false;
      if (d.kind === 'laptop') return vlan === 70;
      const ap = this.accessPort(d.id);
      return !!ap && ap.port.mode === 'access' && ap.port.accessVlan === vlan;
    });
  }

  hostOnline(devId: string): boolean {
    const d = this.dev(devId);
    if (!d || !this.engine.isUp(devId)) return false;
    const i = this.engine.primaryIf(d);
    if (!i || !i.ip || isApipa(i.ip) || !this.engine.oper(i).up) return false;
    const gw = d.host?.gateway;
    if (!gw) return false;
    return this.engine.roundTrip(devId, gw, 'icmp', 0, false).ok;
  }

  hostHealthy(devId: string): boolean {
    const r = this.ownerOf(devId);
    if (!r) return this.hostOnline(devId);
    return SERVICES_BY_DEPT[r.dept].every((svc) => {
      const c = this.engine.checkService(devId, svc.host, svc.proto, svc.port);
      return c.ok && c.quality >= 0.6;
    });
  }

  forceRenew(devIds: string[]): void {
    for (const id of devIds) {
      const d = this.dev(id);
      if (!d?.host?.dhcp) continue;
      d.host.leaseExpires = 0;
      d.host.lastDhcpAttempt = -999;
      dhcpRenew(this.engine, id);
    }
  }

  addRogue(spec: Parameters<ScenarioHost['addRogue']>[0]): Device {
    const net = this.s.net;
    const d = makeDevice(spec.id, spec.name, 'rogue', spec.model, 'corridor', spec.pos);
    d.serial = 'unknown';
    d.addedAt = this.now;
    d.ifaces.push(makeIface(spec.id, 'eth0', nextMac(net, spec.vendor), {}));
    if (spec.ip) {
      d.ifaces[0].ip = spec.ip;
      d.ifaces[0].mask = spec.mask;
      d.host = emptyHost();
      d.host.dhcp = false;
      d.host.ip = spec.ip;
      d.host.mask = spec.mask;
      d.host.gateway = spec.gw ?? null;
    }
    const extra: string[] = [];
    for (let k = 0; k < (spec.extraMacs ?? 0); k++) extra.push(nextMac(net, 'lenovo'));
    d.rogue = { vendor: spec.vendor, description: '', dhcp: spec.dhcp ?? null, discoveredBy: null, extraMacs: extra, sendsBpdu: !!spec.sendsBpdu, bridge: false, restoreLink: null };
    net.devices[d.id] = d;
    // free the switch port if something is plugged in
    for (const [lid, l] of Object.entries(net.links)) {
      if ((l.a.dev === spec.swId && l.a.iface === spec.port) || (l.b.dev === spec.swId && l.b.iface === spec.port)) delete net.links[lid];
    }
    connect(net, [d.id, 'eth0'], [spec.swId, spec.port], 'copper', 'rogue');
    this.invalidate();
    return d;
  }

  removeDevice(id: string): void {
    const net = this.s.net;
    const d = net.devices[id];
    if (!d) return;
    for (const [lid, l] of Object.entries(net.links)) if (l.a.dev === id || l.b.dev === id) delete net.links[lid];
    const rl = d.rogue?.restoreLink;
    delete net.devices[id];
    if (rl) connect(net, rl.a, rl.b, 'copper', 'access');
    this.shells.delete(id);
    this.invalidate();
  }

  addFlow(f: Flow): void {
    this.s.net.flows.push(f);
  }

  removeFlows(pred: (f: Flow) => boolean): void {
    this.s.net.flows = this.s.net.flows.filter((f) => !pred(f));
  }

  serverLog(devId: string, msg: string): void {
    this.engine.log(devId, msg);
  }

  feed(msg: string, kind: 'info' | 'good' | 'bad' | 'security' | 'change' = 'info'): void {
    this.s.feed.push({ t: this.now, msg, kind });
    if (this.s.feed.length > 200) this.s.feed.splice(0, this.s.feed.length - 200);
    this.touch();
  }

  managerMsg(subject: string, body: string, kind: 'info' | 'praise' | 'warning' | 'budget' | 'escalation' | 'review' = 'info'): void {
    this.s.manager.push({ id: `mm${this.s.seq++}`, t: this.now, subject, body, kind, read: false });
    this.toast({ kind: 'manager', title: `Dana: ${subject}` });
  }

  toast(t: Omit<Toast, 'id' | 't'>): void {
    this.emit({ type: 'toast', toast: { ...t, id: this.toastSeq++, t: this.now } });
    this.touch();
  }

  flag(name: string): void {
    if (this.s.tutorial.flags[name]) return;
    this.s.tutorial.flags[name] = true;
    this.emit({ type: 'flag', name });
    this.touch();
  }

  // ===========================================================================
  // SimApi (for shells)

  recordChange(devId: string, what: string): void {
    this.s.changes.push({ t: this.now, dev: devId, what });
    if (this.s.changes.length > 80) this.s.changes.shift();
    if (!/^(write memory|clear )/.test(what)) this.feed(`Change on ${this.dev(devId)?.name ?? devId}: ${what}`, 'change');
    this.invalidate();
    this.touch();
  }

  onCommand(devId: string, canon: string, _raw: string): void {
    this.s.stats.commands++;
    this.flag('cli-used');
    const c = canon.toLowerCase();
    if (c.startsWith('ipconfig')) this.flag('cmd-ipconfig');
    if (c.startsWith('ping')) this.flag('cmd-ping');
    if (c.startsWith('show ip interface brief') || c.startsWith('show interfaces status')) this.flag('cmd-show-int');
    if (c.startsWith('enable')) this.flag('cmd-enable');
    if (c.startsWith('configure terminal')) this.flag('cmd-conf');
    this.markViewed(devId);
    this.touch();
  }

  reloadDevice(devId: string): void {
    const d = this.dev(devId);
    if (!d) return;
    if (d.ios) {
      restoreStartup(d);
      this.engine.log(devId, '%SYS-5-RESTART: System restarted --');
    }
    d.bootUntil = this.now + bootMinutes(d.kind);
    if (d.host?.dhcp) {
      d.host.leaseExpires = 0;
      d.host.lastDhcpAttempt = -999;
      d.ifaces[0].ip = null;
      d.host.ip = null;
    }
    this.shells.delete(devId);
    this.invalidate();
    this.touch();
  }

  dhcpRenew(devId: string) {
    return dhcpRenew(this.engine, devId);
  }
  dhcpRelease(devId: string): void {
    dhcpRelease(this.engine, devId);
  }
  applyStatic(devId: string, cfg: { ip: string; mask: string; gateway: string; dns: string[] }): void {
    applyStatic(this.engine, devId, cfg);
  }
  enableDhcp(devId: string): void {
    enableDhcp(this.engine, devId);
  }

  restartService(devId: string, svcName: string, action: 'start' | 'stop' | 'restart'): ActionResult {
    const d = this.dev(devId);
    const s = d?.server?.services.find((x) => x.name === svcName || x.id === svcName);
    if (!d || !s) return { ok: false, msg: 'Unknown service' };
    if (action === 'stop') {
      s.running = false;
      s.failed = null;
      this.serverLog(devId, `systemd[1]: Stopped ${s.label}.`);
    } else {
      if (d.server!.diskUsedPct >= 99) {
        s.running = false;
        s.failed = 'disk';
        this.serverLog(devId, `${s.name}[${4000 + int(this.s.rng.misc, 0, 999)}]: FATAL: could not write pid file: No space left on device`);
        this.serverLog(devId, `systemd[1]: ${s.name}.service: Failed with result 'exit-code'.`);
        this.invalidate();
        return { ok: false, msg: 'Service failed to start (no space left on device)' };
      }
      s.running = true;
      s.failed = null;
      this.serverLog(devId, `systemd[1]: ${action === 'restart' ? 'Restarted' : 'Started'} ${s.label}.`);
    }
    this.recordChange(devId, `systemctl ${action} ${s.name}`);
    return { ok: true, msg: '' };
  }

  freeDisk(devId: string): number {
    const srv = this.dev(devId)?.server;
    if (!srv || srv.diskUsedPct <= 60) return 0;
    const before = srv.diskUsedPct;
    srv.diskUsedPct = 52 + int(this.s.rng.misc, 0, 8);
    this.recordChange(devId, 'journalctl --vacuum-size');
    return ((before - srv.diskUsedPct) / 100) * 98;
  }

  getShell(devId: string): Shell | null {
    let sh = this.shells.get(devId);
    if (sh) return sh;
    const d = this.dev(devId);
    if (!d) return null;
    if (isIos(d)) sh = new IosShell(devId, this);
    else if (d.kind === 'pc' || d.kind === 'laptop') sh = new WindowsShell(devId, this);
    else if (d.kind === 'server') sh = new LinuxShell(devId, this);
    else return null;
    this.shells.set(devId, sh);
    return sh;
  }

  markViewed(devId: string): void {
    for (const inc of this.s.incidents) {
      if (inc.status === 'resolved') continue;
      const v = ((inc.data._viewed as string[]) ??= []);
      if (!v.includes(devId)) v.push(devId);
    }
  }

  // ===========================================================================
  // PeopleHost

  tryPrint(e: EmployeeState): boolean {
    const r = rosterOf(e.id);
    const prnId = PRINTER_FOR_ZONE[r.zone];
    const dev = this.deviceOf(e.id);
    if (!prnId || !dev) return true;
    const prn = this.dev(prnId);
    const ok = (() => {
      if (!prn || !this.engine.isUp(prnId) || prn.printer?.status !== 'ready') return false;
      const ip = prn.ifaces[0].ip;
      if (!ip) return false;
      const rt = this.engine.roundTrip(dev.id, ip, 'tcp', 9100, true);
      return rt.ok && rt.fwd.dstDev === prnId;
    })();
    if (ok) {
      prn.printer!.pagesToday += int(this.s.rng.people, 1, 12);
    } else {
      e.frustration = Math.min(100, e.frustration + 12);
      if (this.now - e.lastEmailAt > 60 && chance(this.s.rng.people, 0.6)) {
        const m = printerComplaint(this.s.rng.people, r, prn?.name ?? 'the printer');
        e.lastEmailAt = this.now;
        const inc = this.s.incidents.find((i) => i.status !== 'resolved' && (i.affectedDevs.includes(prnId) || i.affectedDevs.includes(dev.id)));
        this.addEmail({ from: e.id, fromName: r.name, subject: m.subject, body: m.body, kind: 'report', incidentId: inc?.id ?? null });
      }
    }
    return ok;
  }

  onNocVisit(e: EmployeeState): void {
    const r = rosterOf(e.id);
    this.feed(`${r.name} walked over to the NOC: "${e.failing.length ? `${e.failing[0]} isn't working` : 'the network is acting up'} — any news?"`, 'bad');
    this.s.satisfaction = Math.max(0, this.s.satisfaction - 0.5);
  }

  onReboot(e: EmployeeState): void {
    const d = this.deviceOf(e.id);
    if (d) {
      this.reloadDevice(d.id);
      this.feed(`${rosterOf(e.id).name} restarted their computer hoping it fixes the network.`, 'info');
    }
  }

  onArrived(_e: EmployeeState): void {}

  // ===========================================================================
  // Main loop

  /** Advance the simulation by real seconds (called every animation frame). */
  frame(dtReal: number): void {
    if (this.s.gameOver && this.s.speed > 0) this.s.speed = 0;
    const dtMin = Math.min(0.25, dtReal) * SPEEDS[this.s.speed] * MIN_PER_SEC;
    // fixed sub-steps tied to simulation time: the simulation is identical
    // whatever the frame rate, which keeps seeded runs reproducible
    this.minuteAcc += dtMin;
    let guard = 0;
    while (this.minuteAcc >= SUB_STEP && guard++ < 2000) {
      this.minuteAcc -= SUB_STEP;
      updateMovement(this, SUB_STEP);
      this.subStep++;
      if (this.subStep >= STEPS_PER_MIN) {
        this.subStep = 0;
        this.s.t = Math.round(this.s.t) + 1;
        this.minuteTick();
      } else this.s.t = Math.floor(this.s.t) + this.subStep * SUB_STEP;
    }
    this.uiTimer += dtReal;
    if (this.dirtyUi || this.uiTimer > 0.25) {
      this.dirtyUi = false;
      this.uiTimer = 0;
      this.notify();
    }
  }

  setSpeed(i: number): void {
    this.s.speed = Math.max(0, Math.min(SPEEDS.length - 1, i));
    if (i > 0) this.flag('speed-changed');
    this.touch();
  }

  minuteTick(): void {
    const s = this.s;
    const e = this.engine;
    e.now = s.t;
    const mod = minuteOfDay(s.t);
    const day = dayIndex(s.t);
    // new day planning
    if (mod >= 360 && mod < 361) {
      planDay(s, s.rng.people);
      if (!isWeekend(s.t)) this.feed(`Day ${day + 1} — ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day % 7]}. ${s.meetings.length} meetings scheduled.`, 'info');
      this.addRequestTasks();
    }
    // night power blip (no UPS): reboots a switch and discards unsaved config
    if (mod >= 133 && mod < 134 && day >= 1 && !this.hasUpgrade('ups') && chance(s.rng.misc, 0.25)) this.powerBlip();
    // devices finishing boot need a recompute
    for (const d of Object.values(s.net.devices)) {
      if (d.bootUntil > 0 && d.bootUntil <= s.t && d.bootUntil > s.t - 1.01) this.invalidate();
      if (d.pc && d.pc.reimageUntil > 0 && s.t >= d.pc.reimageUntil) {
        d.pc.reimageUntil = 0;
        d.pc.compromised = false;
        d.pc.malware = null;
        this.feed(`${d.name} finished re-imaging — clean build restored.`, 'good');
        if (d.host) {
          d.host.dhcp = true;
          d.host.dnsFromDhcp = true;
        }
      }
      if (d.pc && d.pc.scanUntil > 0 && s.t >= d.pc.scanUntil) {
        d.pc.scanUntil = 0;
        if (d.pc.compromised) {
          this.feed(`EDR scan on ${d.name}: removed ${d.pc.malware?.proc} (trojan) and its persistence.`, 'good');
          d.pc.compromised = false;
          d.pc.malware = null;
        } else this.feed(`EDR scan on ${d.name}: no threats found.`, 'info');
      }
    }
    // ISP restoration
    if (s.net.ispOutage && s.ispRestoreAt && s.t >= s.ispRestoreAt) {
      s.net.ispOutage = false;
      this.invalidate();
      this.feed('ISP: circuit restored (RFO: fiber cut in the metro network).', 'good');
    }
    // laptops follow their owners into meetings
    this.syncLaptops();
    // people
    decideMinute(this);
    // DHCP clients
    for (const d of Object.values(s.net.devices)) if (d.host?.dhcp) dhcpClientTick(e, d);
    // traffic & counters
    e.minuteTick(this.userFlows());
    // health (staggered every 2 minutes)
    this.evalHealth();
    // productivity
    this.updateProductivity();
    // incidents
    this.directorTick();
    this.incidentTick();
    this.tasksTick();
    // guest Wi-Fi churn keeps DHCP pools realistic
    if (!isWeekend(s.t) && mod > 480 && mod < 1080 && chance(s.rng.misc, 0.04)) this.guestLease();
    // noise mail
    if (!isWeekend(s.t) && mod > 470 && mod < 1060 && chance(s.rng.misc, 0.006)) {
      const n = pick(s.rng.misc, NOISE);
      this.addEmail({ from: 'system', fromName: n.from, subject: n.subject, body: n.body, kind: 'noise', incidentId: null });
    }
    // daily report
    if (mod >= 1110 && s.lastDailyReport !== day && !isWeekend(s.t)) this.dailyReport();
    this.touch();
  }

  private syncLaptops(): void {
    for (const d of Object.values(this.s.net.devices)) {
      if (d.kind !== 'laptop' || !d.ownerId) continue;
      const emp = this.employee(d.ownerId);
      const desk = DESKS.find((x) => x.id === rosterOf(d.ownerId!).desk)!;
      const carry = emp && emp.present && (emp.state === 'meeting' || (emp.state === 'walking' && emp.plan?.kind === 'meeting'));
      const target = carry ? emp!.pos : desk.pcPos;
      d.pos = { x: target.x, y: target.y };
      const last = this.laptopPosAt.get(d.id);
      if (!last || Math.hypot(last.x - d.pos.x, last.y - d.pos.y) > 40) {
        this.laptopPosAt.set(d.id, { ...d.pos });
        this.invalidate();
      }
    }
  }

  private userFlows() {
    const flows: { src: string; dstIp: string; mbps: number }[] = [];
    for (const emp of this.s.employees) {
      if (!emp.present || emp.state !== 'working') continue;
      const d = this.deviceOf(emp.id);
      if (!d) continue;
      const r = rosterOf(emp.id);
      const svc = SERVICES_BY_DEPT[r.dept][int(this.s.rng.misc, 0, SERVICES_BY_DEPT[r.dept].length - 1)];
      const dst = this.engine.resolve(d.id, svc.host);
      if (!dst.ok || !dst.ip) continue;
      flows.push({ src: d.id, dstIp: dst.ip, mbps: range(this.s.rng.misc, 0.5, r.dept === 'Design' ? 9 : 5) });
    }
    return flows;
  }

  private evalHealth(): void {
    const slot = Math.floor(this.s.t);
    if (slot === this.lastHealthSlot) return;
    this.lastHealthSlot = slot;
    const s = this.s;
    s.employees.forEach((emp, idx) => {
      if (!emp.present) {
        emp.blockedSince = null;
        return;
      }
      if ((idx + slot) % 2 !== 0) return;
      const d = this.deviceOf(emp.id);
      if (!d) return;
      // a user waiting for their own PC to restart/re-image isn't evaluated
      if (d.powered && !this.engine.isUp(d.id)) return;
      const r = rosterOf(emp.id);
      const svcs = SERVICES_BY_DEPT[r.dept];
      let sum = 0;
      let tot = 0;
      const failing: Failing[] = [];
      for (const svc of svcs) {
        const c = this.engine.checkService(d.id, svc.host, svc.proto, svc.port);
        tot += svc.weight;
        const q = c.ok ? Math.min(1, c.quality / 0.85) : 0;
        sum += svc.weight * q;
        if (!c.ok || c.quality < 0.6) failing.push({ label: svc.label.replace(/ \(.*\)$/, ''), stage: c.ok ? 'quality' : c.stage, detail: c.detail, internal: svc.host.endsWith('.corp.local') });
      }
      emp.health = tot ? sum / tot : 1;
      emp.failing = failing.map((f) => f.label);
      emp.healthDetail = failing.map((f) => `${f.label}: ${f.stage}`).join('; ');
      const working = emp.state === 'working';
      const blocked = emp.health < 0.75;
      if (working && blocked) {
        if (emp.blockedSince === null) emp.blockedSince = s.t;
        emp.frustration = Math.min(100, emp.frustration + (1 - emp.health) * 6);
        if (!emp.bubble || emp.bubble.icon === 'ok') emp.bubble = { icon: emp.health < 0.35 ? 'no-net' : 'slow', until: s.t + 2.5 };
        // complain by email after their personal patience runs out
        const sig = failing
          .map((f) => f.label + f.stage)
          .sort()
          .join('|');
        const blockedFor = s.t - emp.blockedSince;
        if (blockedFor >= emp.patience && emp.emailedFor !== sig && s.t - emp.lastEmailAt > 45) {
          const inc = this.incidentFor(d.id);
          const count = inc ? s.inbox.filter((m) => m.incidentId === inc.id && m.kind === 'report').length : 0;
          if (!inc || count < 3) {
            const m = complaint(s.rng.people, r, failing, failing.length === svcs.length);
            emp.emailedFor = sig;
            emp.lastEmailAt = s.t;
            this.addEmail({ from: emp.id, fromName: r.name, subject: m.subject, body: m.body, kind: 'report', incidentId: inc?.id ?? null });
          }
        }
      } else if (!blocked) {
        if (emp.blockedSince !== null && emp.emailedFor && s.t - emp.blockedSince > emp.patience && chance(s.rng.people, 0.35)) {
          const m = thanks(s.rng.people, r);
          this.addEmail({ from: emp.id, fromName: r.name, subject: m.subject, body: m.body, kind: 'thanks', incidentId: null });
        }
        emp.blockedSince = null;
        emp.emailedFor = null;
        emp.frustration = Math.max(0, emp.frustration - 1.5);
      }
    });
    this.detectCollateral();
  }

  private updateProductivity(): void {
    const s = this.s;
    let sum = 0;
    let n = 0;
    for (const emp of s.employees) {
      if (!emp.present) continue;
      let rate: number | null = null;
      if (emp.state === 'working') rate = emp.health * (1 - emp.frustration / 400);
      else if (emp.state === 'meeting') rate = 0.92;
      else if (emp.state === 'visiting') rate = 0;
      else if (emp.state === 'walking' && emp.plan?.kind === 'visiting') rate = 0;
      emp.workRate = rate ?? emp.workRate;
      if (rate !== null) {
        sum += rate;
        n++;
      }
    }
    if (n >= 3) {
      const inst = (sum / n) * 100;
      s.productivity = s.productivity * 0.82 + inst * 0.18;
      const day = dayIndex(s.t);
      if (s.prodSamples.day !== day) s.prodSamples = { day, sum: 0, n: 0 };
      s.prodSamples.sum += s.productivity;
      s.prodSamples.n++;
    }
    if (Math.floor(s.t) % 10 === 0) {
      s.prodHistory.push(Math.round(s.productivity));
      if (s.prodHistory.length > 144) s.prodHistory.shift();
    }
  }

  private guestLease(): void {
    const core = this.dev('core-sw1');
    const pool = core.ios?.dhcpPools.find((p) => p.name === 'WIFI');
    if (!pool) return;
    const mac = nextMac(this.s.net, 'tplink').replace(/^50:c7:bf/, 'da:a1:19');
    this.engine.allocate(core, pool, mac, null, undefined);
  }

  // ===========================================================================
  // Incidents

  incidentFor(devId: string): Incident | undefined {
    return this.s.incidents.find((i) => i.status !== 'resolved' && i.affectedDevs.includes(devId));
  }

  activeIncidents(): Incident[] {
    return this.s.incidents.filter((i) => i.status !== 'resolved');
  }

  openIncidents(): Incident[] {
    return this.s.incidents.filter((i) => i.status === 'open');
  }

  spawnScenario(def: ScenarioDef, opts?: { target?: string; delay?: number }): Incident | null {
    const inj = def.inject(this, opts);
    if (!inj) return null;
    this.invalidate();
    const s = this.s;
    const detectDelay = opts?.delay ?? (def.detect === 'users' ? range(s.rng.incidents, 3, 9) : def.detect === 'ids' ? range(s.rng.incidents, 1, 3) : this.hasUpgrade('nms') ? 1 : range(s.rng.incidents, 2, 5));
    const inc: Incident = {
      id: `INC-${String(1000 + s.director.counter++).padStart(4, '0')}`,
      scenario: def.id,
      title: '',
      symptom: '',
      area: '',
      severity: def.severity,
      security: !!def.security,
      createdAt: s.t,
      reportedAt: s.t + detectDelay,
      slaElapsed: 0,
      status: 'latent',
      resolvedAt: null,
      data: inj.data,
      affectedDevs: inj.affected,
      hintsUsed: 0,
      verifyAttempts: 0,
      escalations: 0,
      breached: false,
      statusUpdates: 0,
      checklist: [],
      fixedSince: null,
      score: 0,
      rootCause: '',
      fixSummary: '',
      verified: false,
      timeline: [{ t: s.t, msg: 'Fault began' }],
    };
    // informational variants (fully mitigated by upgrades) are low severity
    if (inj.affected.length === 0 && def.id !== 'rogue-scanner' && !def.security) inc.severity = Math.max(inc.severity, 3) as Incident['severity'];
    if (def.id === 'dos-flood' && this.hasUpgrade('ddos')) inc.severity = 3;
    s.incidents.push(inc);
    s.director.lastScenarios = [...s.director.lastScenarios, def.id].slice(-5);
    return inc;
  }

  private openIncident(inc: Incident): void {
    const def = scenarioById(inc.scenario)!;
    const a = def.alert(this, inc);
    inc.title = a.title;
    inc.symptom = a.symptom;
    inc.area = a.area;
    inc.status = 'open';
    inc.reportedAt = this.s.t;
    inc.checklist = (def.checklist?.(this, inc) ?? [
      { id: 'diagnose', text: 'Diagnose the root cause' },
      { id: 'fix', text: 'Apply a fix' },
      { id: 'verify', text: 'Verify service is restored, then close the incident' },
    ]).map((c) => ({ ...c, done: false }));
    inc.timeline.push({ t: this.s.t, msg: `Reported: ${a.title}` });
    this.toast({ kind: inc.security ? 'security' : 'incident', title: `${inc.security ? '⚠ SECURITY · ' : ''}${SEV_LABEL[inc.severity]} — ${a.title}`, body: a.area, incidentId: inc.id });
    this.feed(`${inc.id} opened (${SEV_LABEL[inc.severity]}): ${a.title}`, inc.security ? 'security' : 'bad');
    if (def.detect === 'ids') this.addEmail({ from: 'system', fromName: 'IDS · FW-EDGE', subject: `[ALERT] ${a.title}`, body: `${a.symptom}\n\nSeverity: ${SEV_LABEL[inc.severity]}\nSensor: FW-EDGE (inline)\nIncident: ${inc.id}`, kind: 'security', incidentId: inc.id });
    if (def.detect === 'monitoring') this.addEmail({ from: 'system', fromName: 'NMS Monitoring', subject: `[DOWN] ${a.title}`, body: `${a.symptom}\n\nIncident: ${inc.id}`, kind: 'system', incidentId: inc.id });
    if (this.s.settings.autoSlow && this.s.speed > 2) this.s.speed = 1;
    if (inc.severity === 1) this.managerMsg(`${inc.id}: ${a.title}`, `I'm hearing about "${a.title.toLowerCase()}". This is hurting the whole company — please prioritise it and keep me posted.\n\n— Dana`, 'escalation');
    this.flag('incident-open');
  }

  private directorTick(): void {
    const s = this.s;
    const now = s.t;
    const mod = minuteOfDay(now);
    const day = dayIndex(now);
    // tutorial incident
    if (s.tutorial.active && !s.tutorial.done) {
      if (s.tutorial.flags['tutorial-incident'] && !s.incidents.length) {
        this.spawnScenario(scenarioById('port-shutdown')!, { target: 'e-akim', delay: 0.5 });
      }
      return;
    }
    if (isWeekend(now)) return;
    const active = this.activeIncidents();
    // night-time security event (at most one per night, from day 2)
    if (day >= 1 && s.director.nightSecurityDay !== day && (mod > 1170 || mod < 330) && active.length === 0) {
      s.director.nightSecurityDay = day;
      if (chance(s.rng.incidents, 0.3)) {
        const cands = SCENARIOS.filter((x) => x.security && !x.workHoursOnly && x.minDay <= day);
        const def = weighted(s.rng.incidents, cands.map((c) => ({ item: c, weight: c.weight })));
        if (def) this.spawnScenario(def);
      }
    }
    if (now < s.director.nextAt) return;
    if (mod < 470 || mod > 1005) return;
    const cap = day === 0 ? 1 : day < 3 ? 2 : 3;
    if (active.length >= cap) {
      s.director.nextAt = now + 20;
      return;
    }
    const recent = s.incidents.filter((i) => now - i.createdAt < 30).length;
    if (recent) {
      s.director.nextAt = now + 15;
      return;
    }
    const hasP1 = active.some((i) => i.severity === 1);
    const hasSec = active.some((i) => i.security);
    const recentCats = s.director.lastScenarios.map((id) => scenarioById(id)?.category);
    const cands = SCENARIOS.filter(
      (x) => x.minDay <= day && x.weight > 0 && !s.director.lastScenarios.includes(x.id) && !active.some((i) => i.scenario === x.id) && !(hasP1 && x.severity === 1) && !(hasSec && x.security) && !(day === 0 && x.severity === 1),
    );
    let spawned: Incident | null = null;
    for (let tries = 0; tries < 8 && !spawned; tries++) {
      const def = weighted(
        s.rng.incidents,
        cands.map((c) => ({ item: c, weight: c.weight * (recentCats.includes(c.category) ? 0.4 : 1) * (c.security ? 0.9 : 1) })),
      );
      if (!def) break;
      spawned = this.spawnScenario(def);
      if (!spawned) cands.splice(cands.indexOf(def), 1);
    }
    const difficulty = day === 0 ? 1.35 : day === 1 ? 1.1 : day === 2 ? 0.95 : 0.85;
    s.director.nextAt = now + range(s.rng.incidents, 65, 130) * difficulty + (spawned?.security ? 25 : 0);
  }

  private detectCollateral(): void {
    const s = this.s;
    if (s.t < s.director.collateralCooldown) return;
    const unexplained: string[] = [];
    for (const emp of s.employees) {
      if (!emp.present || emp.state !== 'working' || emp.blockedSince === null) continue;
      if (s.t - emp.blockedSince < 4) continue;
      const d = this.deviceOf(emp.id);
      if (!d || this.incidentFor(d.id)) continue;
      unexplained.push(d.id);
    }
    if (!unexplained.length) return;
    const open = s.incidents.find((i) => i.scenario === 'collateral' && i.status !== 'resolved');
    if (open) {
      for (const d of unexplained) if (!open.affectedDevs.includes(d)) open.affectedDevs.push(d);
      return;
    }
    const recent = s.changes.filter((c) => s.t - c.t < 30 && !/^(write memory|ipconfig|clear)/.test(c.what));
    const sev = unexplained.length >= 8 ? 1 : unexplained.length >= 3 ? 2 : 3;
    const inc = this.spawnScenario({ ...COLLATERAL, severity: sev as 1 | 2 | 3, inject: () => ({ data: { changes: recent.map((c) => `${this.dev(c.dev)?.name ?? c.dev}: ${c.what}`) }, affected: [...unexplained] }) }, { delay: 1 });
    if (inc) inc.severity = sev as Incident['severity'];
    s.director.collateralCooldown = s.t + 10;
  }

  private incidentTick(): void {
    const s = this.s;
    for (const inc of s.incidents) {
      if (inc.status === 'resolved') continue;
      const def = scenarioById(inc.scenario);
      if (!def) continue;
      if (inc.status === 'latent' && inc.reportedAt !== null && s.t >= inc.reportedAt) {
        const userDetect = def.detect === 'users';
        const anyPresent = inc.affectedDevs.length === 0 || inc.affectedDevs.some((d) => {
          const o = this.ownerOf(d);
          return !o || this.employee(o.id)?.present;
        });
        if (!userDetect || anyPresent) this.openIncident(inc);
        else inc.reportedAt = s.t + 5;
      }
      def.tick?.(this, inc);
      if (inc.status !== 'open') continue;
      // checklist
      if (def.checkItem) for (const c of inc.checklist) c.done = def.checkItem(this, inc, c.id);
      const fixed = def.resolved(this, inc);
      if (!def.checkItem) {
        for (const c of inc.checklist) c.done = c.id === 'verify' ? false : fixed;
      }
      if (fixed) {
        if (inc.fixedSince === null) {
          inc.fixedSince = s.t;
          inc.timeline.push({ t: s.t, msg: 'Service appears restored (awaiting verification)' });
          this.feed(`${inc.id}: monitoring/users indicate service is restored — verify and close it.`, 'good');
          this.toast({ kind: 'good', title: `${inc.id} looks fixed — verify to close`, incidentId: inc.id });
          this.flag('incident-fixed');
        } else if (s.t - inc.fixedSince > 45) {
          this.closeIncident(inc, false);
          continue;
        }
      } else inc.fixedSince = null;
      // SLA escalation (the clock runs in business hours; security incidents run 24/7)
      const mod = minuteOfDay(s.t);
      if (inc.security || (!isWeekend(s.t) && mod >= 420 && mod < 1110)) inc.slaElapsed = (inc.slaElapsed ?? 0) + 1;
      if (s.tutorial.active && !s.tutorial.done) inc.slaElapsed = Math.min(inc.slaElapsed, SLA[inc.severity] * 0.6);
      const elapsed = inc.slaElapsed;
      const sla = SLA[inc.severity];
      const level = elapsed > sla * 2 ? 2 : elapsed > sla ? 1 : 0;
      if (level > inc.escalations && !fixed) {
        inc.escalations = level;
        if (level === 1) {
          inc.breached = true;
          s.stats.breaches++;
          s.satisfaction = Math.max(0, s.satisfaction - (inc.statusUpdates ? 2 : 4));
          this.managerMsg(`${inc.id} breached its SLA`, `"${inc.title}" has been open for ${fmtDuration(elapsed)} (SLA ${fmtDuration(sla)} for ${SEV_LABEL[inc.severity]}). People are blocked. What's the plan?\n\n— Dana`, 'escalation');
        } else {
          s.satisfaction = Math.max(0, s.satisfaction - (inc.statusUpdates ? 3 : 6));
          if (inc.severity > 1) inc.severity = (inc.severity - 1) as Incident['severity'];
          this.managerMsg(`${inc.id} escalated to ${SEV_LABEL[inc.severity]}`, `This is now seriously affecting the business. I've escalated "${inc.title}" to ${SEV_LABEL[inc.severity]}. Drop everything else.\n\n— Dana`, 'escalation');
        }
        const msg = def.escalate?.(this, inc, level);
        if (msg) {
          inc.timeline.push({ t: s.t, msg });
          this.feed(`${inc.id}: ${msg}`, inc.security ? 'security' : 'bad');
          this.toast({ kind: inc.security ? 'security' : 'bad', title: `${inc.id} escalated`, body: msg, incidentId: inc.id });
        }
      }
    }
    if (s.satisfaction <= 0 && !s.gameOver) {
      s.gameOver = true;
      this.managerMsg('We need to talk', "I'm sorry, but the last few days have cost us too much. We're letting you go. (Game over — start a new game, or keep playing in sandbox mode.)", 'review');
    }
  }

  verifyIncident(id: string): ActionResult {
    const inc = this.s.incidents.find((i) => i.id === id);
    if (!inc || inc.status !== 'open') return { ok: false, msg: 'Incident is not open.' };
    const def = scenarioById(inc.scenario)!;
    if (def.resolved(this, inc)) {
      this.closeIncident(inc, true);
      return { ok: true, msg: `${inc.id} verified and closed.` };
    }
    inc.verifyAttempts++;
    this.s.satisfaction = Math.max(0, this.s.satisfaction - 1);
    const why = def.whyNot?.(this, inc) || 'The service is not restored yet.';
    inc.timeline.push({ t: this.s.t, msg: `Verification failed: ${why}` });
    this.feed(`${inc.id}: verification failed — ${why}`, 'bad');
    return { ok: false, msg: why };
  }

  private closeIncident(inc: Incident, verified: boolean): void {
    const s = this.s;
    const def = scenarioById(inc.scenario)!;
    inc.status = 'resolved';
    inc.resolvedAt = s.t;
    inc.verified = verified;
    inc.rootCause = def.rootCause(inc, this);
    inc.fixSummary = def.fix(inc, this);
    const elapsed = inc.slaElapsed ?? s.t - (inc.reportedAt ?? inc.createdAt);
    const sla = SLA[def.severity];
    const base = { 1: 400, 2: 250, 3: 150, 4: 100 }[def.severity];
    const tf = Math.max(0.4, Math.min(1.6, 1.6 - (elapsed / sla) * 0.6));
    const hp = (s.settings.hintMode === 'free' ? 0.75 : 0.85) ** inc.hintsUsed;
    const vp = Math.max(0.5, 1 - 0.1 * inc.verifyAttempts);
    const score = Math.round(base * tf * hp * vp * (verified ? 1 : 0.6));
    inc.score = score;
    s.score += score;
    s.stats.resolved++;
    if (inc.security) s.stats.securityResolved++;
    const inSla = elapsed <= sla;
    s.satisfaction = Math.min(100, s.satisfaction + (inSla ? (inc.severity <= 2 ? 4 : 2) : 0.5));
    if (inSla && verified) s.hintTokens++;
    inc.timeline.push({ t: s.t, msg: verified ? `Verified and closed (+${score} pts)` : `Auto-closed without verification (+${score} pts)` });
    def.cleanup?.(this, inc);
    this.feed(`${inc.id} ${verified ? 'resolved' : 'auto-closed (unverified)'} in ${fmtDuration(s.t - (inc.reportedAt ?? inc.createdAt))} — +${score} pts. Root cause: ${inc.rootCause}`, 'good');
    this.toast({ kind: 'good', title: `${inc.id} closed — +${score} pts`, body: inc.rootCause, incidentId: inc.id });
    if (inSla && inc.severity <= 2 && verified && chance(s.rng.misc, 0.7)) this.managerMsg(`Nice work on ${inc.id}`, `Thanks for sorting out "${inc.title}" so quickly (${fmtDuration(elapsed)}). That's exactly what we need.\n\n— Dana`, 'praise');
    // follow-up: unsaved configuration on devices you changed
    const touched = new Set(s.changes.filter((c) => c.t >= inc.createdAt - 1).map((c) => c.dev));
    for (const dv of touched) {
      const d = this.dev(dv);
      if (d?.ios && isUnsaved(d) && !s.tasks.some((t) => !t.done && t.check === 'saved' && t.checkArgs.dev === dv)) {
        this.addTask({ title: `Save the running configuration on ${d.name}`, detail: `You changed ${d.name} while working on ${inc.id}. Unsaved changes are lost if the switch reboots (power blips happen — there's no UPS yet). Use 'copy running-config startup-config' or 'write memory'.`, kind: 'followup', incidentId: inc.id, check: 'saved', checkArgs: { dev: dv }, reward: 1, due: null, requester: null });
      }
    }
    if (inc.scenario === 'rogue-dhcp' && !s.tasks.some((t) => t.check === 'snooping')) this.addTask({ title: 'Harden SW-DQA with DHCP snooping', detail: "Prevent rogue DHCP servers: 'ip dhcp snooping', 'ip dhcp snooping vlan 20,30', and 'ip dhcp snooping trust' on the uplink Gi1/1/1.", kind: 'followup', incidentId: inc.id, check: 'snooping', checkArgs: {}, reward: 2, due: null, requester: null });
    if (this.s.tutorial.active) this.flag('incident-verified');
  }

  useHint(id: string): ActionResult {
    const inc = this.s.incidents.find((i) => i.id === id);
    if (!inc || inc.status !== 'open') return { ok: false, msg: 'Incident is not open.' };
    if (inc.hintsUsed >= 3) return { ok: false, msg: 'All hints already revealed.' };
    if (this.s.settings.hintMode === 'earned') {
      if (this.s.hintTokens <= 0) return { ok: false, msg: 'No hint tokens left. Earn them by resolving incidents within SLA (or switch hint mode in Settings).' };
      this.s.hintTokens--;
    }
    inc.hintsUsed++;
    this.s.stats.hintsUsed++;
    this.touch();
    return { ok: true, msg: '' };
  }

  hintsFor(inc: Incident): string[] {
    const def = scenarioById(inc.scenario);
    return def ? def.hints(inc, this).slice(0, inc.hintsUsed) : [];
  }

  manualRefs(inc: Incident): string[] {
    return scenarioById(inc.scenario)?.manual ?? [];
  }

  statusUpdate(id: string): ActionResult {
    const inc = this.s.incidents.find((i) => i.id === id);
    if (!inc || inc.status !== 'open') return { ok: false, msg: 'Incident is not open.' };
    if (this.s.t - (inc.data._lastUpdate as number ?? -999) < 15) return { ok: false, msg: 'You just sent an update — give it a few minutes.' };
    inc.data._lastUpdate = this.s.t;
    inc.statusUpdates++;
    if (inc.statusUpdates <= 2) this.s.satisfaction = Math.min(100, this.s.satisfaction + 1);
    inc.timeline.push({ t: this.s.t, msg: 'Status update sent to the manager' });
    this.managerMsg(`Re: ${inc.id}`, pick(this.s.rng.misc, ['Thanks for the update — keep me posted.', "Appreciated. I'll let the department heads know you're on it.", 'Got it. Shout if you need anything approved.']) + '\n\n— Dana', 'info');
    return { ok: true, msg: 'Status update sent.' };
  }

  askRestart(id: string): ActionResult {
    const inc = this.s.incidents.find((i) => i.id === id);
    if (!inc || inc.status !== 'open') return { ok: false, msg: 'Incident is not open.' };
    let n = 0;
    for (const d of inc.affectedDevs) {
      const dev = this.dev(d);
      if (!dev || !(dev.kind === 'pc' || dev.kind === 'laptop')) continue;
      const emp = dev.ownerId ? this.employee(dev.ownerId) : undefined;
      if (emp && !emp.present) continue;
      this.reloadDevice(d);
      n++;
    }
    inc.timeline.push({ t: this.s.t, msg: `Asked ${n} affected user(s) to restart` });
    this.feed(`${inc.id}: asked ${n} user(s) to restart their computers.`, 'info');
    return { ok: true, msg: n ? `${n} user(s) are restarting (PCs re-request DHCP when they boot).` : 'No affected users are at their desks.' };
  }

  // ===========================================================================
  // Device actions (physical / GUI)

  performAction(devId: string, action: string, args: Record<string, unknown> = {}): ActionResult {
    const d = this.dev(devId);
    if (!d) return { ok: false, msg: 'Device not found' };
    const s = this.s;
    const done = (msg: string, change = true): ActionResult => {
      if (change) this.recordChange(devId, msg);
      this.touch();
      return { ok: true, msg };
    };
    const linkFor = (ifName?: string) => {
      const i = ifName ? d.ifaces.find((x) => x.name === ifName) : d.ifaces[0];
      return i ? this.engine.linkOf(i.id) : null;
    };
    switch (action) {
      case 'power-toggle': {
        if (d.kind === 'isp') return { ok: false, msg: 'The ISP device is managed by the provider.' };
        d.powered = !d.powered;
        if (!d.powered && d.ios) restoreStartup(d);
        this.invalidate();
        return done(d.powered ? 'powered on' : 'powered off');
      }
      case 'power-cycle':
        if (d.kind === 'isp') return { ok: false, msg: 'The ISP device is managed by the provider.' };
        this.reloadDevice(devId);
        return done('power-cycled');
      case 'reseat-cable': {
        const l = linkFor(args.iface as string | undefined);
        if (!l) return { ok: false, msg: 'No cable connected here.' };
        if (l.status === 'unplugged') {
          l.status = 'ok';
          this.invalidate();
          return done('reseated cable');
        }
        return { ok: true, msg: l.status === 'ok' ? 'The cable is firmly seated; nothing changed.' : 'The cable is seated, but it looks damaged — it needs replacing.' };
      }
      case 'replace-cable': {
        const l = linkFor(args.iface as string | undefined);
        if (!l) return { ok: false, msg: 'No cable connected here.' };
        const item = l.medium === 'fiber' ? 'fiber' : 'cable';
        if ((s.inventory[item] ?? 0) <= 0) return { ok: false, msg: `No spare ${item === 'fiber' ? 'fiber patch/SFP' : 'patch cables'} in stock — buy some in the Shop.` };
        s.inventory[item]--;
        l.status = 'ok';
        this.invalidate();
        return done(`replaced ${l.medium} cable`);
      }
      case 'replace-optic': {
        const i = d.ifaces.find((x) => x.name === args.iface);
        if (!i || i.type !== 'sfp') return { ok: false, msg: 'Select an SFP (fiber) port.' };
        if ((s.inventory.fiber ?? 0) <= 0) return { ok: false, msg: 'No spare optic in stock — buy "Fiber patch + SFP" in the Shop.' };
        s.inventory.fiber--;
        i.hwFault = 'none';
        const l = this.engine.linkOf(i.id);
        if (l) l.status = 'ok';
        this.engine.log(devId, `%SFF8472-5-THRESHOLD_VIOLATION: ${i.name}: Rx power low alarm cleared`);
        this.invalidate();
        return done(`replaced optic in ${i.name}`);
      }
      case 'replace-psu': {
        if (!d.powerFault) return { ok: true, msg: 'The power supply is working fine.' };
        if ((s.inventory.psu ?? 0) <= 0) return { ok: false, msg: 'No spare PSU — buy one in the Shop.' };
        s.inventory.psu--;
        d.powerFault = false;
        this.invalidate();
        return done('replaced power supply');
      }
      case 'move-cable': {
        const from = d.ifaces.find((x) => x.name === args.from);
        const to = d.ifaces.find((x) => x.name === args.to);
        if (!from || !to) return { ok: false, msg: 'Pick both ports.' };
        if (this.engine.linkOf(to.id)) return { ok: false, msg: `${to.name} already has a cable.` };
        const l = this.engine.linkOf(from.id);
        if (!l) return { ok: false, msg: `No cable on ${from.name}.` };
        if ((from.type === 'sfp') !== (to.type === 'sfp')) return { ok: false, msg: 'Copper and fiber ports are not interchangeable.' };
        const end = l.a.dev === devId && l.a.iface === from.name ? l.a : l.b;
        end.iface = to.name;
        to.wallPort = from.wallPort;
        from.wallPort = undefined;
        this.invalidate();
        return done(`moved cable ${from.name} → ${to.name}`);
      }
      case 'remove-device': {
        if (d.kind !== 'rogue' && d.id !== 'signage-lobby') return { ok: false, msg: 'Only unknown/unauthorised devices can be removed.' };
        const name = d.model;
        this.removeDevice(devId);
        this.feed(`Removed ${name} from the network.`, 'security');
        this.recordChange(devId, `removed device (${name})`);
        return { ok: true, msg: `Removed ${name}.` };
      }
      case 'restart-service':
      case 'start-service':
      case 'stop-service': {
        const r = this.restartService(devId, String(args.svc), action === 'stop-service' ? 'stop' : action === 'start-service' ? 'start' : 'restart');
        this.invalidate();
        return r.ok ? { ok: true, msg: `${args.svc} ${action.split('-')[0]}ed.` } : r;
      }
      case 'free-disk': {
        const gb = this.freeDisk(devId);
        this.invalidate();
        return { ok: true, msg: gb > 0 ? `Freed ${gb.toFixed(1)} GB of old logs.` : 'Disk usage is already healthy.' };
      }
      case 'dns-set': {
        const z = d.server?.dnsZone;
        if (!z) return { ok: false, msg: 'Not a DNS server.' };
        const name = String(args.name).toLowerCase().trim();
        const type = (args.type === 'CNAME' ? 'CNAME' : 'A') as 'A' | 'CNAME';
        const value = String(args.value).trim().toLowerCase();
        if (!name.endsWith('.corp.local')) return { ok: false, msg: 'Names must end in .corp.local' };
        if (type === 'A' && !isValidIp(value)) return { ok: false, msg: 'An A record needs a valid IPv4 address.' };
        const rec = z.find((r) => r.name === name);
        if (rec) Object.assign(rec, { type, value });
        else z.push({ name, type, value });
        this.serverLog(devId, `named[812]: zone corp.local/IN: ${name} ${type} ${value} (reloaded)`);
        this.invalidate();
        return done(`DNS ${name} ${type} ${value}`);
      }
      case 'dns-delete': {
        const z = d.server?.dnsZone;
        if (!z) return { ok: false, msg: 'Not a DNS server.' };
        const i = z.findIndex((r) => r.name === args.name);
        if (i >= 0) z.splice(i, 1);
        this.invalidate();
        return done(`DNS delete ${args.name}`);
      }
      case 'ap-set': {
        if (!d.ap) return { ok: false, msg: 'Not an access point.' };
        if (args.channel !== undefined) {
          const ch = Number(args.channel);
          if (!Number.isInteger(ch) || ch < 1 || ch > 11) return { ok: false, msg: 'Channel must be 1–11 (2.4 GHz).' };
          d.ap.channel = ch;
        }
        if (args.txPower) d.ap.txPower = args.txPower as 'low' | 'medium' | 'high';
        if (args.radioOn !== undefined) d.ap.radioOn = !!args.radioOn;
        this.invalidate();
        return done(`AP ch ${d.ap.channel}, power ${d.ap.txPower}, radio ${d.ap.radioOn ? 'on' : 'off'}`);
      }
      case 'printer-set': {
        if (!d.printer || !d.host) return { ok: false, msg: 'Not a printer.' };
        const ip = String(args.ip);
        const mask = String(args.mask);
        const gw = String(args.gateway);
        if (!isValidIp(ip) || !isValidIp(mask) || !isValidIp(gw)) return { ok: false, msg: 'Enter valid IPv4 address, mask and gateway.' };
        applyStatic(this.engine, devId, { ip, mask, gateway: gw, dns: d.host.dns });
        return done(`printer static ${ip}`);
      }
      case 'printer-clear': {
        if (d.printer) {
          d.printer.jobs = 0;
          d.printer.status = d.printer.status === 'jam' ? 'ready' : d.printer.status;
        }
        return done('printer queue cleared', false);
      }
      case 'save-config': {
        if (!d.ios) return { ok: false, msg: 'Not a configurable network device.' };
        d.ios.startup = snapshotConfig(d);
        this.engine.log(devId, '%SYS-5-CONFIG_I: Configured from console by netadmin on vty0 (10.10.99.50)');
        return done('write memory');
      }
      case 'pc-renew': {
        if (!d.host?.dhcp) return { ok: false, msg: 'DHCP is not enabled on this adapter.' };
        const r = dhcpRenew(this.engine, devId);
        this.recordChange(devId, 'ipconfig /renew');
        return { ok: r.ok, msg: r.ok ? `Lease renewed: ${d.ifaces[0].ip}` : `Renew failed: ${r.reason}` };
      }
      case 'pc-release':
        if (!d.host?.dhcp) return { ok: false, msg: 'DHCP is not enabled on this adapter.' };
        dhcpRelease(this.engine, devId);
        return done('ipconfig /release');
      case 'pc-dhcp':
        if (!d.host) return { ok: false, msg: 'No IP settings.' };
        enableDhcp(this.engine, devId);
        return done('set adapter to DHCP');
      case 'pc-static': {
        const ip = String(args.ip ?? '');
        const mask = String(args.mask ?? '');
        const gw = String(args.gateway ?? '');
        const dns = (args.dns as string[] | undefined) ?? [];
        if (!isValidIp(ip) || !isValidIp(mask)) return { ok: false, msg: 'Enter a valid IPv4 address and subnet mask.' };
        if (gw && !isValidIp(gw)) return { ok: false, msg: 'Gateway is not a valid IPv4 address.' };
        for (const x of dns) if (x && !isValidIp(x)) return { ok: false, msg: `DNS server "${x}" is not a valid IPv4 address.` };
        applyStatic(this.engine, devId, { ip, mask, gateway: gw, dns: dns.filter(Boolean) });
        return done(`static IP ${ip}/${mask} gw ${gw || 'none'}`);
      }
      case 'pc-adapter': {
        d.ifaces[0].shutdown = !args.enabled;
        this.invalidate();
        return done(`network adapter ${args.enabled ? 'enabled' : 'disabled'}`);
      }
      case 'edr-scan':
        if (!this.hasUpgrade('edr')) return { ok: false, msg: 'Requires EDR licences (Shop → Security).' };
        if (!d.pc) return { ok: false, msg: 'Not an endpoint.' };
        d.pc.scanUntil = s.t + 8;
        return done('EDR full scan started (≈8 min)', false);
      case 'edr-isolate':
      case 'edr-release':
        if (!this.hasUpgrade('edr')) return { ok: false, msg: 'Requires EDR licences (Shop → Security).' };
        if (!d.pc) return { ok: false, msg: 'Not an endpoint.' };
        d.pc.edrIsolated = action === 'edr-isolate';
        this.invalidate();
        return done(d.pc.edrIsolated ? 'EDR network isolation ON' : 'EDR network isolation released');
      case 'reimage': {
        if (!d.pc) return { ok: false, msg: 'Not an endpoint.' };
        const dur = this.hasUpgrade('edr') ? 25 : 45;
        d.pc.reimageUntil = s.t + dur;
        d.bootUntil = s.t + dur;
        if (d.host) {
          d.host.dhcp = true;
          d.host.dnsFromDhcp = true;
          d.host.leaseExpires = 0;
          d.host.lastDhcpAttempt = -999;
        }
        this.invalidate();
        return done(`re-image started (${dur} min)`);
      }
      case 'isp-ticket': {
        if (s.net.ispTicketOpen) return { ok: true, msg: 'A ticket is already open with the ISP.' };
        s.net.ispTicketOpen = true;
        if (s.net.ispOutage) s.ispRestoreAt = Math.min(s.ispRestoreAt, s.t + range(s.rng.misc, 25, 45));
        this.feed('Opened ticket #CX-48817 with the ISP.', 'info');
        return done('opened ISP ticket', false);
      }
      case 'isp-filter': {
        if (s.net.ispUpstreamFilter) return { ok: true, msg: 'Upstream filtering is already active.' };
        if (s.budget < 500) return { ok: false, msg: 'Emergency upstream filtering costs $500 — not enough budget.' };
        s.budget -= 500;
        s.net.ispUpstreamFilter = true;
        this.feed('ISP enabled emergency upstream filtering ($500).', 'security');
        return done('ISP upstream filtering requested', false);
      }
      default:
        return { ok: false, msg: `Unknown action ${action}` };
    }
  }

  // ===========================================================================
  // Shop

  buy(itemId: string): ActionResult {
    const item = SHOP.find((x) => x.id === itemId);
    if (!item) return { ok: false, msg: 'Unknown item' };
    const s = this.s;
    if (item.kind === 'upgrade' && s.purchases.includes(itemId)) return { ok: false, msg: 'Already purchased.' };
    if (s.budget < item.price) return { ok: false, msg: `Not enough budget ($${s.budget.toLocaleString()} available).` };
    s.budget -= item.price;
    if (item.kind === 'consumable') s.inventory[itemId] = (s.inventory[itemId] ?? 0) + (item.qty ?? 1);
    else {
      s.purchases.push(itemId);
      this.applyUpgrade(itemId);
    }
    this.feed(`Purchased: ${item.name} ($${item.price.toLocaleString()}).`, 'good');
    this.flag('shop-bought');
    this.touch();
    return { ok: true, msg: `Purchased ${item.name}.` };
  }

  private applyUpgrade(id: string): void {
    const net = this.s.net;
    switch (id) {
      case 'redundant-uplinks': {
        const pairs: [string, string, string][] = [
          ['sw-eng', 'GigabitEthernet1/1/5', '10,70,99'],
          ['sw-dqa', 'GigabitEthernet1/1/6', '20,30,70,99'],
          ['sw-office', 'GigabitEthernet1/1/7', '40,50,70,99'],
        ];
        for (const [swId, corePort, allowed] of pairs) {
          const a = this.dev(swId).ifaces.find((i) => i.name === 'GigabitEthernet1/1/2')!;
          const b = this.dev('core-sw1').ifaces.find((i) => i.name === corePort)!;
          for (const [i, desc] of [
            [a, 'UPLINK-2 to CORE-SW1'],
            [b, `DOWNLINK-2 to ${this.dev(swId).name}`],
          ] as [Iface, string][]) {
            Object.assign(i, { mode: 'trunk', nativeVlan: 998, allowedVlans: allowed, shutdown: false, description: desc, portfast: false, bpduguard: false, dhcpSnoopTrust: true, hwFault: 'none' });
          }
          connect(net, [swId, a.name], ['core-sw1', b.name], 'fiber', 'uplink');
          for (const dv of [swId, 'core-sw1']) this.dev(dv).ios!.startup = snapshotConfig(this.dev(dv));
        }
        break;
      }
      case 'isp-1g':
        net.ispMbps = 1000;
        break;
      case 'lte-backup':
        net.lteBackup = true;
        break;
      case 'poe-injectors':
        for (const ap of ['ap-mtg', 'ap-lobby']) this.dev(ap).ap!.injectorPowered = true;
        break;
      case 'sw-office-upgrade': {
        const sw = this.dev('sw-office');
        sw.model = 'C9200-24P';
        sw.ios!.poeBudgetW = 370;
        break;
      }
      case 'training':
        this.s.hintTokens += 4;
        this.s.satisfaction = Math.min(100, this.s.satisfaction + 5);
        break;
      case 'ids': {
        // block known C2 infrastructure at the edge
        const acl = this.dev('fw-edge').ios!.acls.find((a) => a.name === 'INSIDE-OUT');
        if (acl) {
          let seq = 1;
          for (const h of this.engine.publicHosts().filter((x) => x.malicious)) {
            if (!acl.entries.some((e) => e.dst.ip === h.ip)) acl.entries.unshift({ seq: seq++, action: 'deny', proto: 'ip', src: { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' }, srcPort: null, dst: { any: false, ip: h.ip, wildcard: '0.0.0.0' }, dstPort: null, log: true, hits: 0, remark: 'IPS threat-intel block' });
          }
          acl.entries.sort((a, b) => a.seq - b.seq);
          this.dev('fw-edge').ios!.startup = snapshotConfig(this.dev('fw-edge'));
        }
        break;
      }
    }
    this.invalidate();
  }

  // ===========================================================================
  // Inbox / tasks / manager

  addEmail(m: Omit<Email, 'id' | 't' | 'read' | 'starred' | 'archived'>): void {
    const email: Email = { ...m, id: `em${this.s.seq++}`, t: this.s.t, read: false, starred: false, archived: false };
    this.s.inbox.push(email);
    if (this.s.inbox.length > 250) this.s.inbox.splice(0, this.s.inbox.length - 250);
    if (m.kind !== 'noise') this.toast({ kind: m.kind === 'security' ? 'security' : 'email', title: `✉ ${m.fromName}: ${m.subject}`, incidentId: m.incidentId ?? undefined });
  }

  addTask(t: Omit<Task, 'id' | 't' | 'done' | 'doneAt' | 'failed'>): void {
    this.s.tasks.push({ ...t, id: `tk${this.s.seq++}`, t: this.s.t, done: false, doneAt: null, failed: false });
    this.touch();
  }

  private addRequestTasks(): void {
    const s = this.s;
    const day = dayIndex(s.t);
    if (day === 0 && !s.tasks.some((t) => t.check === 'provision')) {
      this.addTask({
        title: 'Provision desk ENG-11 for a new engineer',
        detail: "Sam Rivera starts tomorrow at desk ENG-11 (SW-ENG Gi1/0/11). Put the port in VLAN 10, give it a description, and bring it up ('no shutdown'). Reward: $300 and manager confidence.",
        kind: 'request',
        incidentId: null,
        check: 'provision',
        checkArgs: { sw: 'sw-eng', port: 'GigabitEthernet1/0/11', vlan: 10 },
        due: 1440 + 9 * 60,
        reward: 300,
        requester: 'People Ops',
      });
    }
    if (day === 1 && !s.tasks.some((t) => t.check === 'blockhost')) {
      this.addTask({
        title: 'Block a known-malicious domain at the firewall',
        detail: "Security asks you to block all traffic from inside to 185.220.101.47 (update-check.xyz) on FW-EDGE. Add a deny entry ABOVE the permit in the INSIDE-OUT ACL. Reward: $250.",
        kind: 'request',
        incidentId: null,
        check: 'blockhost',
        checkArgs: { ip: '185.220.101.47' },
        due: 2 * 1440 + 17 * 60,
        reward: 250,
        requester: 'Fatima Haddad (Security)',
      });
    }
    if (day === 2 && !s.tasks.some((t) => t.check === 'provision' && t.checkArgs.port === 'GigabitEthernet1/0/7')) {
      this.addTask({
        title: 'Provision desk DSN-07 for a contractor',
        detail: 'A design contractor sits at DSN-07 (SW-DQA Gi1/0/7) from tomorrow. Configure the port as an access port in VLAN 20, add a description and enable it. Reward: $300.',
        kind: 'request',
        incidentId: null,
        check: 'provision',
        checkArgs: { sw: 'sw-dqa', port: 'GigabitEthernet1/0/7', vlan: 20 },
        due: 3 * 1440 + 9 * 60,
        reward: 300,
        requester: 'Kenji Sato (Design Lead)',
      });
    }
  }

  private tasksTick(): void {
    const s = this.s;
    for (const t of s.tasks) {
      if (t.done || t.failed) continue;
      let ok = false;
      if (t.check === 'saved') {
        const d = this.dev(String(t.checkArgs.dev));
        ok = !!d && !isUnsaved(d);
      } else if (t.check === 'provision') {
        const p = this.dev(String(t.checkArgs.sw)).ifaces.find((i) => i.name === t.checkArgs.port)!;
        ok = !p.shutdown && p.mode === 'access' && p.accessVlan === t.checkArgs.vlan && p.description.trim().length > 0 && !p.description.includes('spare desk');
      } else if (t.check === 'blockhost') {
        const fw = this.dev('fw-edge');
        const acl = fw.ios!.acls.find((a) => a.name === 'INSIDE-OUT');
        ok = !!acl && !!this.engine.aclDenies(fw, 'INSIDE-OUT', { src: '10.10.10.21', dst: String(t.checkArgs.ip), proto: 'tcp', port: 443 }, false) && !this.engine.aclDenies(fw, 'INSIDE-OUT', { src: '10.10.10.21', dst: '140.82.112.3', proto: 'tcp', port: 443 }, false);
      } else if (t.check === 'snooping') {
        const sw = this.dev('sw-dqa');
        ok = sw.ios!.dhcpSnooping.enabled && sw.ios!.dhcpSnooping.vlans.includes(30) && !!sw.ifaces.find((i) => i.name === 'GigabitEthernet1/1/1')?.dhcpSnoopTrust;
      }
      if (ok) {
        t.done = true;
        t.doneAt = s.t;
        if (t.reward >= 50) s.budget += t.reward;
        s.satisfaction = Math.min(100, s.satisfaction + (t.kind === 'request' ? 3 : t.reward));
        s.score += t.kind === 'request' ? 120 : 40;
        this.feed(`Task complete: ${t.title}${t.reward >= 50 ? ` (+$${t.reward})` : ''}`, 'good');
        this.toast({ kind: 'good', title: `Task done: ${t.title}` });
      } else if (t.due && s.t > t.due) {
        t.failed = true;
        s.satisfaction = Math.max(0, s.satisfaction - 3);
        this.feed(`Task overdue: ${t.title}`, 'bad');
      }
    }
  }

  private powerBlip(): void {
    const sw = pick(this.s.rng.misc, ['sw-eng', 'sw-dqa', 'sw-office']);
    const d = this.dev(sw);
    const lost = isUnsaved(d);
    this.reloadDevice(sw);
    this.feed(`02:13 power blip: ${d.name} rebooted (no UPS).${lost ? ' Unsaved configuration changes were LOST.' : ''}`, lost ? 'bad' : 'info');
    if (lost) this.managerMsg('Power blip overnight', `Facilities says we had a short power dip at 02:13 and ${d.name} rebooted. I'm told any changes that weren't saved to startup-config were lost. Might be worth looking at a UPS.\n\n— Dana`, 'warning');
  }

  private dailyReport(): void {
    const s = this.s;
    const day = dayIndex(s.t);
    s.lastDailyReport = day;
    const avg = s.prodSamples.n ? s.prodSamples.sum / s.prodSamples.n : s.productivity;
    const todays = s.incidents.filter((i) => dayIndex(i.createdAt) === day);
    const resolved = todays.filter((i) => i.status === 'resolved').length;
    const open = s.incidents.filter((i) => i.status !== 'resolved').length;
    const breaches = todays.filter((i) => i.breached).length;
    const allowance = Math.max(600, Math.round(1200 + Math.max(0, avg - 60) * 55 + resolved * 150 - breaches * 200));
    s.budget += allowance;
    s.satisfaction = Math.max(0, Math.min(100, s.satisfaction + Math.max(-5, Math.min(5, (avg - 80) / 4))));
    s.days.push({ day, avgProductivity: Math.round(avg), incidentsResolved: resolved, incidentsOpen: open, slaBreaches: breaches, allowance, score: s.score });
    const tone = avg >= 90 ? 'Great day.' : avg >= 75 ? 'Solid day overall.' : avg >= 60 ? 'A rough day — people lost a lot of time.' : 'That was a bad day for the business.';
    this.managerMsg(`Day ${day + 1} wrap-up`, `${tone}\n\n• Average productivity: ${Math.round(avg)}%\n• Incidents resolved today: ${resolved}${breaches ? ` (${breaches} breached SLA)` : ''}\n• Still open: ${open}\n• Tomorrow's IT allowance: +$${allowance.toLocaleString()}\n\nBudget is now $${Math.round(s.budget).toLocaleString()}.${s.satisfaction < 35 ? "\n\nI'll be honest — I'm worried. We need fewer outages." : ''}\n\n— Dana`, 'budget');
    this.flag('day-ended');
  }

  /** Fast-forward to the next working morning (stops if an incident opens). */
  skipToMorning(): void {
    const s = this.s;
    this.skipping = true;
    const startOpen = this.openIncidents().length;
    let guard = 0;
    for (;;) {
      if (guard++ > 4 * 1440) break;
      const mod = minuteOfDay(s.t);
      if (mod >= 400 && mod < 420 && !isWeekend(s.t)) break;
      s.t += 1;
      this.minuteTick();
      for (const emp of s.employees) if (emp.state === 'walking') emp.path.length = 0;
      updateMovement(this, 30);
      if (this.openIncidents().length > startOpen) break;
    }
    this.skipping = false;
    this.notify();
  }

  // ===========================================================================
  // Test helpers: apply a scripted scenario solution

  runSolution(steps: SolutionStep[]): void {
    for (const st of steps) {
      if ('cli' in st) {
        const sh = this.getShell(st.cli)!;
        for (const c of st.cmds) sh.run(c);
      } else if ('act' in st) {
        const r = this.performAction(st.dev, st.act, st.args ?? {});
        if (!r.ok) throw new Error(`action ${st.act} failed: ${r.msg}`);
      } else if ('renew' in st) {
        for (const d of st.renew) dhcpRenew(this.engine, d);
      } else if ('wait' in st) {
        for (let k = 0; k < st.wait; k++) {
          this.s.t += 1;
          this.minuteTick();
        }
      }
    }
  }

  // ===========================================================================
  // Persistence

  serialize(): string {
    for (const d of Object.values(this.s.net.devices)) if (d.logs.length > 120) d.logs.splice(0, d.logs.length - 120);
    return JSON.stringify(this.s);
  }

  save(): boolean {
    try {
      localStorage.setItem(SAVE_KEY, this.serialize());
      return true;
    } catch {
      return false;
    }
  }

  static load(): Game | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const st = JSON.parse(raw) as GameState;
      if (st.version !== SAVE_VERSION) return null;
      return new Game(st);
    } catch {
      return null;
    }
  }

  static clearSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ===========================================================================
  // UI helpers

  clockLabel(): string {
    return fmtClock(this.s.t);
  }

  employeeAt(empId: string) {
    return { r: rosterOf(empId), e: this.employee(empId)!, desk: deskOf(empId) };
  }

  equipPos(id: string) {
    return EQUIP_POS[id];
  }

  get managerId(): string {
    return MANAGER_ID;
  }

  randomFloat(): number {
    return next(this.s.rng.misc);
  }
}
