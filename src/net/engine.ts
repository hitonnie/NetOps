/**
 * NetEngine: computes the operational state of the simulated network from its
 * configuration (layer 1 → 2 → 3), and answers questions such as "can this
 * host reach that service?", with the same logic that drives ping/traceroute.
 *
 * Simplifications (documented in the in-game manual):
 *  - Spanning tree is modelled as "first link wins": redundant L2 paths are
 *    blocked deterministically, so there are no emergent loops.
 *  - Edge/core ACL evaluation is stateful: ACLs are checked in the direction a
 *    flow is initiated; return traffic of a permitted flow is allowed.
 *  - Timing (latency/loss) is approximated from link utilisation.
 */
import { fmtSyslog } from '../core/time';
import { hash } from '../core/rng';
import { INTERNET_HOSTS, type InternetHost, internetHostByIp, internetHostByName } from './internet';
import { addIp, cmpIp, inNetwork, ipToInt, isApipa, isPrivate, isValidIp, maskToPrefix, networkOf, sameSubnet, wildcardMatch, intToIp } from './ip';
import { type Acl, type AclEntry, type Device, type DhcpPool, type Iface, type Link, type NetState, ciscoMac, isIos, shortIf, vlanAllowed } from './model';

export interface OperInfo {
  up: boolean;
  /** show interfaces status column */
  status: 'connected' | 'notconnect' | 'disabled' | 'err-disabled' | 'inactive' | 'monitoring';
  /** show ip interface brief Status column */
  ipStatus: 'up' | 'down' | 'administratively down';
  proto: 'up' | 'down';
  speedMbps: number;
  duplex: 'full' | 'half';
  duplexMismatch: boolean;
  peer: { dev: string; iface: string } | null;
  linkId: string | null;
  poeW: number;
  poeStatus: 'on' | 'off' | 'denied' | 'n/a';
  reason: string;
}

export interface L3If {
  dev: string;
  iface: string;
  ifaceId: string;
  ip: string;
  mask: string;
  mac: string;
}

interface Edge {
  to: string;
  link: string | null;
  /** iface ids at each end (for STP/snooping/path analysis) */
  fromIf: string | null;
  toIf: string | null;
}

export interface WlanAssoc {
  ap: string;
  signal: number;
  quality: number;
  interference: number;
  channel: number;
}

export interface MacEntry {
  vlan: number;
  mac: string;
  port: string;
  type: 'DYNAMIC' | 'STATIC';
}

export interface Computed {
  version: number;
  devUp: Map<string, boolean>;
  devPowered: Map<string, boolean>;
  oper: Map<string, OperInfo>;
  segOf: Map<string, number>; // node → segment root id
  l3: L3If[];
  segMembers: Map<number, L3If[]>;
  adj: Map<string, Edge[]>;
  nodeIndex: Map<string, number>;
  stpBlocked: Set<string>; // iface ids with a blocked (redundant) edge
  macTables: Map<string, MacEntry[]>;
  wlan: Map<string, WlanAssoc>;
  apClients: Map<string, string[]>;
  poe: Map<string, { budget: number; used: number; denied: string[] }>;
  switchVlansActive: Map<string, Set<number>>;
}

export type FailCode =
  | 'ok'
  | 'host-down'
  | 'no-link'
  | 'no-ip'
  | 'apipa'
  | 'no-gateway'
  | 'no-route'
  | 'arp'
  | 'acl'
  | 'not-router'
  | 'ttl'
  | 'isp-down'
  | 'no-nat'
  | 'unreachable'
  | 'link-down';

export interface Hop {
  dev: string;
  ip: string;
}

export interface FwdResult {
  ok: boolean;
  code: FailCode;
  detail: string;
  hops: Hop[];
  failDev: string | null;
  dstDev: string | null;
  links: string[];
  natBy: string | null;
  natIp: string | null;
  external: InternetHost | null;
  aclHit: { dev: string; acl: string; seq: number } | null;
  /** the router that generated an ICMP unreachable, if any */
  unreachableFrom: string | null;
  viaWireless: string | null;
  /** source address actually used (before NAT) */
  srcIp: string;
}

export interface PathCheck {
  ok: boolean;
  fwd: FwdResult;
  rev: FwdResult | null;
  quality: number; // 0..1
  latencyMs: number;
  lossPct: number;
}

export interface DnsResult {
  ok: boolean;
  ip: string | null;
  server: string | null;
  code: 'ok' | 'nxdomain' | 'timeout' | 'servfail' | 'noserver' | 'refused';
  detail: string;
  fqdn: string;
}

export interface ServiceCheck {
  ok: boolean;
  stage: 'ok' | 'power' | 'link' | 'ip' | 'dns' | 'network' | 'service' | 'quality';
  detail: string;
  quality: number;
  latencyMs: number;
  dstIp: string | null;
}

export interface RouteEntry {
  code: 'C' | 'L' | 'S' | 'S*';
  net: string;
  mask: string;
  nextHop: string | null;
  iface: string | null;
  ad: number;
}

export interface UserFlow {
  src: string;
  dstIp: string;
  mbps: number;
}

const BOOT_MIN: Record<string, number> = { switch: 6, l3switch: 8, firewall: 7, ap: 4, pc: 3, laptop: 2, printer: 3, server: 5, iot: 2, rogue: 1, isp: 3 };
export function bootMinutes(kind: string): number {
  return BOOT_MIN[kind] ?? 3;
}

class UF {
  p: number[] = [];
  add(): number {
    this.p.push(this.p.length);
    return this.p.length - 1;
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.p[rb] = ra;
    return true;
  }
}

const ROUTER_KINDS = new Set(['firewall', 'l3switch']);

export class NetEngine {
  net: NetState;
  now = 0;
  private cache: Computed | null = null;
  private prevOper: Map<string, OperInfo> | null = null;
  private prevPowered: Map<string, boolean> | null = null;
  private pathCache = new Map<string, string[]>();
  private svcCache = new Map<string, ServiceCheck>();
  private svcBase = new Map<string, { r: ServiceCheck; fwd: FwdResult | null; rev: FwdResult | null }>();
  private rtCache = new Map<string, RouteEntry[]>();
  private dnsCache = new Map<string, DnsResult>();
  /** link id → Mbps carried last minute */
  linkLoad = new Map<string, number>();
  loadEpoch = 0;
  fwCpu = 9;
  coreCpu = 14;
  /** set when DoS traffic is being processed by the firewall */
  fwOverload = 0;
  /** hooks for the game layer */
  onLog: ((devId: string, msg: string) => void) | null = null;

  constructor(net: NetState) {
    this.net = net;
  }

  invalidate(): void {
    this.net.version++;
  }

  dev(id: string): Device {
    return this.net.devices[id];
  }

  get c(): Computed {
    let guard = 0;
    while (!this.cache || this.cache.version !== this.net.version) {
      const v = this.net.version;
      this.cache = this.compute();
      this.cache.version = v;
      this.pathCache.clear();
      this.rtCache.clear();
      this.svcBase.clear();
      this.dnsCache.clear();
      this.postCompute();
      if (++guard > 4) break;
    }
    return this.cache!;
  }

  // -------------------------------------------------------------------------
  // Logging

  log(devId: string, msg: string): void {
    const d = this.net.devices[devId];
    if (!d) return;
    const line = isIos(d) ? `*${fmtSyslog(this.now)}.${String(Math.floor((this.now * 1000) % 1000)).padStart(3, '0')}: ${msg}` : msg;
    d.logs.push({ t: this.now, msg: line });
    if (d.logs.length > 250) d.logs.splice(0, d.logs.length - 250);
    this.onLog?.(devId, msg);
  }

  // -------------------------------------------------------------------------
  // Helpers

  linkOf(ifaceId: string): Link | null {
    for (const l of Object.values(this.net.links)) {
      if (`${l.a.dev}|${l.a.iface}` === ifaceId || `${l.b.dev}|${l.b.iface}` === ifaceId) return l;
    }
    return null;
  }

  peerOf(devId: string, ifName: string): { dev: string; iface: string; link: Link } | null {
    for (const l of Object.values(this.net.links)) {
      if (l.a.dev === devId && l.a.iface === ifName) return { dev: l.b.dev, iface: l.b.iface, link: l };
      if (l.b.dev === devId && l.b.iface === ifName) return { dev: l.a.dev, iface: l.a.iface, link: l };
    }
    return null;
  }

  iface(devId: string, name: string): Iface | undefined {
    return this.net.devices[devId]?.ifaces.find((i) => i.name === name);
  }

  isUp(devId: string): boolean {
    return !!this.c.devUp.get(devId);
  }

  oper(i: Iface): OperInfo {
    return (
      this.c.oper.get(i.id) ?? {
        up: false,
        status: 'notconnect',
        ipStatus: 'down',
        proto: 'down',
        speedMbps: 0,
        duplex: 'full',
        duplexMismatch: false,
        peer: null,
        linkId: null,
        poeW: 0,
        poeStatus: 'n/a',
        reason: 'unknown',
      }
    );
  }

  // -------------------------------------------------------------------------
  // Core computation

  private compute(): Computed {
    const net = this.net;
    const devs = Object.values(net.devices);
    const devPowered = new Map<string, boolean>();
    const devUp = new Map<string, boolean>();
    const linkByIf = new Map<string, Link>();
    for (const l of Object.values(net.links)) {
      linkByIf.set(`${l.a.dev}|${l.a.iface}`, l);
      linkByIf.set(`${l.b.dev}|${l.b.iface}`, l);
    }
    const peerOf = (ifId: string): { dev: string; iface: string } | null => {
      const l = linkByIf.get(ifId);
      if (!l) return null;
      return `${l.a.dev}|${l.a.iface}` === ifId ? l.b : l.a;
    };
    // 1. mains power
    for (const d of devs) {
      const mains = d.powered && !d.powerFault;
      const poeDevice = d.poeW > 0 && !(d.ap?.injectorPowered ?? false);
      devPowered.set(d.id, mains && !poeDevice);
    }
    const booted = (d: Device) => d.bootUntil <= this.now;
    // 2. PoE allocation per switch in port order
    const poe = new Map<string, { budget: number; used: number; denied: string[] }>();
    const poeGrant = new Map<string, number>(); // switch port iface id → watts
    for (const sw of devs) {
      if (!sw.ios || sw.ios.poeBudgetW <= 0) continue;
      const info = { budget: sw.ios.poeBudgetW, used: 0, denied: [] as string[] };
      poe.set(sw.id, info);
      if (!devPowered.get(sw.id) || !booted(sw)) continue;
      for (const i of sw.ifaces) {
        if (i.poe !== 'auto' || i.shutdown || i.errDisabled || i.hwFault === 'dead') continue;
        const l = linkByIf.get(i.id);
        if (!l || l.status === 'damaged' || l.status === 'unplugged') continue;
        const p = peerOf(i.id)!;
        const pd = net.devices[p.dev];
        if (!pd || pd.poeW <= 0 || !pd.powered || pd.powerFault || pd.ap?.injectorPowered) continue;
        if (info.used + pd.poeW <= info.budget) {
          info.used += pd.poeW;
          poeGrant.set(i.id, pd.poeW);
          devPowered.set(pd.id, true);
        } else {
          info.denied.push(i.name);
        }
      }
    }
    for (const d of devs) {
      if (d.ap?.injectorPowered && d.powered && !d.powerFault) devPowered.set(d.id, true);
      devUp.set(d.id, !!devPowered.get(d.id) && booted(d));
    }

    // 3. Interface operational state (physical)
    const oper = new Map<string, OperInfo>();
    const base = (): OperInfo => ({
      up: false,
      status: 'notconnect',
      ipStatus: 'down',
      proto: 'down',
      speedMbps: 0,
      duplex: 'full',
      duplexMismatch: false,
      peer: null,
      linkId: null,
      poeW: 0,
      poeStatus: 'n/a',
      reason: '',
    });
    const ifUsable = (d: Device, i: Iface) => devUp.get(d.id) && !i.shutdown && !i.errDisabled && i.hwFault !== 'dead';
    for (const d of devs) {
      for (const i of d.ifaces) {
        if (i.type === 'svi' || i.type === 'wlan') continue;
        const o = base();
        const l = linkByIf.get(i.id);
        o.linkId = l?.id ?? null;
        if (i.poe) {
          const g = poeGrant.get(i.id);
          o.poeW = g ?? 0;
          o.poeStatus = i.poe === 'never' ? 'off' : g ? 'on' : poe.get(d.id)?.denied.includes(i.name) ? 'denied' : 'off';
        }
        if (!devUp.get(d.id)) {
          o.reason = devPowered.get(d.id) ? 'device booting' : 'device powered off';
        } else if (i.shutdown) {
          o.status = 'disabled';
          o.ipStatus = 'administratively down';
          o.reason = 'administratively shut down';
        } else if (i.errDisabled) {
          o.status = 'err-disabled';
          o.reason = `err-disabled (${i.errDisabled})`;
        } else if (i.hwFault === 'dead') {
          o.reason = 'port hardware failure';
        } else if (!l) {
          o.reason = 'no cable connected';
        } else if (l.status === 'unplugged' || l.status === 'damaged') {
          o.reason = l.status === 'unplugged' ? 'cable unplugged' : 'cable damaged';
        } else {
          const p = peerOf(i.id)!;
          const pd = net.devices[p.dev];
          const pi = pd?.ifaces.find((x) => x.name === p.iface);
          o.peer = { ...p };
          if (!pd || !pi || !ifUsable(pd, pi)) {
            o.reason = !pd || !devUp.get(pd.id) ? 'far end device is off' : 'far end port is down';
          } else {
            // speed / duplex negotiation
            const sA = i.speed === 'auto' ? null : Number(i.speed);
            const sB = pi.speed === 'auto' ? null : Number(pi.speed);
            if (sA && sB && sA !== sB) {
              o.reason = `speed mismatch (${sA} vs ${sB})`;
            } else {
              let speed = Math.min(i.maxMbps, pi.maxMbps, sA ?? 99999, sB ?? 99999);
              if (l.status === 'degraded') speed = Math.min(speed, 100);
              let dA: 'full' | 'half' = i.duplex === 'auto' ? 'full' : i.duplex;
              let dB: 'full' | 'half' = pi.duplex === 'auto' ? 'full' : pi.duplex;
              // auto-negotiation fails against a hard-coded peer → auto side falls back to half duplex
              if (i.duplex === 'auto' && pi.duplex !== 'auto' && speed <= 100) dA = 'half';
              if (pi.duplex === 'auto' && i.duplex !== 'auto' && speed <= 100) dB = 'half';
              if (i.duplex === 'auto' && pi.duplex === 'auto') dA = dB = 'full';
              o.up = true;
              o.status = 'connected';
              o.ipStatus = 'up';
              o.proto = 'up';
              o.speedMbps = speed;
              o.duplex = dA;
              o.duplexMismatch = dA !== dB;
              o.reason = o.duplexMismatch ? 'duplex mismatch' : l.status === 'degraded' ? 'link degraded (CRC errors)' : '';
            }
          }
        }
        oper.set(i.id, o);
      }
    }

    // 4. Layer-2 graph
    const uf = new UF();
    const nodeIndex = new Map<string, number>();
    const adj = new Map<string, Edge[]>();
    const stpBlocked = new Set<string>();
    const node = (n: string) => {
      let x = nodeIndex.get(n);
      if (x === undefined) {
        x = uf.add();
        nodeIndex.set(n, x);
        adj.set(n, []);
      }
      return x;
    };
    const addEdge = (a: string, b: string, link: string | null, aIf: string | null, bIf: string | null) => {
      const ia = node(a);
      const ib = node(b);
      if (!uf.union(ia, ib)) {
        // redundant path → blocked by spanning tree
        if (aIf) stpBlocked.add(aIf);
        if (bIf) stpBlocked.add(bIf);
        return;
      }
      adj.get(a)!.push({ to: b, link, fromIf: aIf, toIf: bIf });
      adj.get(b)!.push({ to: a, link, fromIf: bIf, toIf: aIf });
    };
    const switchVlansActive = new Map<string, Set<number>>();
    const attach = (d: Device, i: Iface): Record<string, string> => {
      const isSw = d.kind === 'switch' || d.kind === 'l3switch';
      if (isSw && i.switchport && i.type !== 'svi') {
        const vl = d.ios!.vlans;
        if (i.mode === 'access') {
          if (!vl[String(i.accessVlan)]) return {};
          return { u: `${d.id}:v${i.accessVlan}` };
        }
        const out: Record<string, string> = {};
        for (const vs of Object.keys(vl)) {
          const v = Number(vs);
          if (!vlanAllowed(i, v)) continue;
          if (v === i.nativeVlan) out.u = `${d.id}:v${v}`;
          else out[`t${v}`] = `${d.id}:v${v}`;
        }
        return out;
      }
      if (d.kind === 'ap') return { u: `ap:${d.id}` };
      if (d.rogue?.bridge) return { u: `br:${d.id}` };
      return { u: `if:${i.id}` };
    };
    // mark access ports with missing VLAN as inactive
    for (const d of devs) {
      if (!(d.kind === 'switch' || d.kind === 'l3switch')) continue;
      for (const i of d.ifaces) {
        if (!i.switchport || i.type === 'svi' || i.mode !== 'access') continue;
        const o = oper.get(i.id);
        if (o && o.up && !d.ios!.vlans[String(i.accessVlan)]) {
          o.status = 'inactive';
          o.reason = `access VLAN ${i.accessVlan} does not exist`;
        }
      }
    }
    // Register every L3-capable interface node so isolated hosts still have a segment
    for (const d of devs) for (const i of d.ifaces) if (!(i.switchport && (d.kind === 'switch' || d.kind === 'l3switch')) || i.type === 'svi') node(`if:${i.id}`);
    const linksSorted = Object.values(net.links).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const l of linksSorted) {
      const da = net.devices[l.a.dev];
      const db = net.devices[l.b.dev];
      if (!da || !db) continue;
      const ia = da.ifaces.find((x) => x.name === l.a.iface);
      const ib = db.ifaces.find((x) => x.name === l.b.iface);
      if (!ia || !ib) continue;
      if (!oper.get(ia.id)?.up || !oper.get(ib.id)?.up) continue;
      const A = attach(da, ia);
      const B = attach(db, ib);
      for (const k of Object.keys(A)) {
        if (B[k]) {
          addEdge(A[k], B[k], l.id, ia.id, ib.id);
          for (const [dd, nn] of [
            [da, A[k]],
            [db, B[k]],
          ] as [Device, string][]) {
            if (dd.kind === 'switch' || dd.kind === 'l3switch') {
              const v = Number(nn.split(':v')[1]);
              if (!switchVlansActive.has(dd.id)) switchVlansActive.set(dd.id, new Set());
              switchVlansActive.get(dd.id)!.add(v);
            }
          }
        }
      }
      // routed/host ports need the if: node to match the attachment node
      for (const [dd, ii, att] of [
        [da, ia, A],
        [db, ib, B],
      ] as [Device, Iface, Record<string, string>][]) {
        if (att.u && att.u.startsWith('ap:')) addEdge(`if:${ii.id}`, att.u, null, null, null);
        void dd;
      }
    }
    // SVIs (autostate: up when the VLAN exists and has an active port)
    for (const d of devs) {
      if (!(d.kind === 'switch' || d.kind === 'l3switch')) continue;
      for (const i of d.ifaces) {
        if (i.type !== 'svi') continue;
        const v = Number(i.name.replace('Vlan', ''));
        const o = base();
        if (!devUp.get(d.id)) o.reason = 'device off';
        else if (i.shutdown) {
          o.status = 'disabled';
          o.ipStatus = 'administratively down';
          o.reason = 'administratively shut down';
        } else if (!d.ios!.vlans[String(v)]) {
          o.reason = `VLAN ${v} does not exist`;
        } else if (!switchVlansActive.get(d.id)?.has(v)) {
          o.ipStatus = 'up';
          o.reason = `no active ports in VLAN ${v} (autostate)`;
        } else {
          o.up = true;
          o.status = 'connected';
          o.ipStatus = 'up';
          o.proto = 'up';
          o.speedMbps = 1000;
          addEdge(`if:${i.id}`, `${d.id}:v${v}`, null, null, null);
        }
        oper.set(i.id, o);
      }
    }
    // AP management interface sits behind the AP bridge
    for (const d of devs) {
      if (d.kind !== 'ap' || !devUp.get(d.id)) continue;
      node(`ap:${d.id}`);
    }

    // 5. Wireless association
    const wlan = new Map<string, WlanAssoc>();
    const apClients = new Map<string, string[]>();
    const aps = devs.filter((d) => d.kind === 'ap' && devUp.get(d.id) && d.ap!.radioOn);
    const txF = { low: 0.6, medium: 0.8, high: 1 } as const;
    const overlap = (a: number, b: number) => Math.max(0, 1 - Math.abs(a - b) / 5);
    const interferenceOf = (ap: Device) => {
      let s = 0;
      const r = ap.ap!.rangePx * txF[ap.ap!.txPower];
      for (const o of aps) {
        if (o === ap) continue;
        const dist = Math.hypot(o.pos.x - ap.pos.x, o.pos.y - ap.pos.y);
        const rr = r * 1.7;
        if (dist < rr) s += overlap(ap.ap!.channel, o.ap!.channel) * (1 - dist / rr) * 0.9;
      }
      for (const f of net.wireless.foreign) {
        const dist = Math.hypot(f.pos.x - ap.pos.x, f.pos.y - ap.pos.y);
        const rr = r * 2.2;
        if (dist < rr) s += overlap(ap.ap!.channel, f.channel) * f.strength * (1 - dist / rr);
      }
      return Math.min(0.85, s * 0.8);
    };
    const apInterf = new Map<string, number>();
    for (const ap of aps) apInterf.set(ap.id, interferenceOf(ap));
    for (const d of devs) {
      const wi = d.ifaces.find((i) => i.type === 'wlan');
      if (!wi) continue;
      const o = base();
      if (!devUp.get(d.id)) o.reason = 'device off';
      else if (wi.shutdown) {
        o.status = 'disabled';
        o.ipStatus = 'administratively down';
        o.reason = 'Wi-Fi adapter disabled';
      } else {
        let best: { ap: Device; sig: number } | null = null;
        for (const ap of aps) {
          if (ap.ap!.ssid !== (d.pc?.wifiProfile ?? 'CorpNet')) continue;
          const r = ap.ap!.rangePx * txF[ap.ap!.txPower];
          const dist = Math.hypot(ap.pos.x - d.pos.x, ap.pos.y - d.pos.y);
          const sig = 1 - dist / r;
          if (sig > 0.04 && (!best || sig > best.sig)) best = { ap, sig };
        }
        if (!best) {
          o.reason = 'no wireless network in range';
        } else {
          const intf = apInterf.get(best.ap.id) ?? 0;
          const clients = apClients.get(best.ap.id) ?? [];
          clients.push(d.id);
          apClients.set(best.ap.id, clients);
          const q = Math.max(0.05, (0.35 + 0.65 * Math.min(1, best.sig * 1.6)) * (1 - intf));
          wlan.set(d.id, { ap: best.ap.id, signal: best.sig, quality: q, interference: intf, channel: best.ap.ap!.channel });
          o.up = true;
          o.status = 'connected';
          o.ipStatus = 'up';
          o.proto = 'up';
          o.speedMbps = Math.round(866 * q);
          o.peer = { dev: best.ap.id, iface: 'radio' };
          addEdge(`if:${wi.id}`, `ap:${best.ap.id}`, null, wi.id, null);
        }
      }
      oper.set(wi.id, o);
    }
    // client load reduces quality on crowded APs
    for (const [apId, cl] of apClients) {
      if (cl.length > 12) for (const c of cl) wlan.get(c)!.quality *= Math.max(0.4, 1 - (cl.length - 12) * 0.04);
      void apId;
    }

    // 6. Segments
    const segOf = new Map<string, number>();
    for (const [n, idx] of nodeIndex) segOf.set(n, uf.find(idx));
    const l3: L3If[] = [];
    const segMembers = new Map<number, L3If[]>();
    for (const d of devs) {
      for (const i of d.ifaces) {
        if (!i.ip || !i.mask) continue;
        if (i.switchport && (d.kind === 'switch' || d.kind === 'l3switch') && i.type !== 'svi') continue;
        if (!oper.get(i.id)?.up) continue;
        const e: L3If = { dev: d.id, iface: i.name, ifaceId: i.id, ip: i.ip, mask: i.mask, mac: i.mac };
        l3.push(e);
        const s = segOf.get(`if:${i.id}`);
        if (s === undefined) continue;
        if (!segMembers.has(s)) segMembers.set(s, []);
        segMembers.get(s)!.push(e);
      }
    }

    const comp: Computed = {
      version: net.version,
      devUp,
      devPowered,
      oper,
      segOf,
      l3,
      segMembers,
      adj,
      nodeIndex,
      stpBlocked,
      macTables: new Map(),
      wlan,
      apClients,
      poe,
      switchVlansActive,
    };
    comp.macTables = this.buildMacTables(comp);
    return comp;
  }

  private buildMacTables(c: Computed): Map<string, MacEntry[]> {
    const out = new Map<string, MacEntry[]>();
    const net = this.net;
    const ifaceMac = new Map<string, { mac: string; dev: string }>();
    for (const d of Object.values(net.devices)) for (const i of d.ifaces) ifaceMac.set(i.id, { mac: i.mac, dev: d.id });
    for (const sw of Object.values(net.devices)) {
      if (!(sw.kind === 'switch' || sw.kind === 'l3switch') || !c.devUp.get(sw.id)) continue;
      const entries: MacEntry[] = [];
      for (const [nodeName, edges] of c.adj) {
        if (!nodeName.startsWith(`${sw.id}:v`)) continue;
        const vlan = Number(nodeName.split(':v')[1]);
        for (const e of edges) {
          if (!e.fromIf) continue; // SVI edge
          const portName = e.fromIf.split('|')[1];
          const port = sw.ifaces.find((i) => i.name === portName);
          // BFS from neighbour excluding this switch-vlan node
          const seen = new Set<string>([nodeName]);
          const q = [e.to];
          seen.add(e.to);
          while (q.length) {
            const n = q.shift()!;
            if (n.startsWith('br:')) {
              const rd = net.devices[n.slice(3)];
              for (const xm of rd?.rogue?.extraMacs ?? []) entries.push({ vlan, mac: xm, port: portName, type: 'DYNAMIC' });
            }
            if (n.startsWith('if:')) {
              const m = ifaceMac.get(n.slice(3));
              if (m && m.dev !== sw.id) {
                entries.push({ vlan, mac: m.mac, port: portName, type: port?.portSecurity?.secureMacs.includes(m.mac) ? 'STATIC' : 'DYNAMIC' });
                const rd = net.devices[m.dev];
                if (rd?.rogue && !rd.rogue.bridge) for (const xm of rd.rogue.extraMacs) entries.push({ vlan, mac: xm, port: portName, type: 'DYNAMIC' });
              }
            }
            for (const ne of c.adj.get(n) ?? []) {
              if (seen.has(ne.to)) continue;
              seen.add(ne.to);
              q.push(ne.to);
            }
          }
        }
      }
      entries.sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
      out.set(sw.id, entries);
    }
    return out;
  }

  /** Mutating enforcement & log generation after a recompute. */
  private postCompute(): void {
    const c = this.cache!;
    const net = this.net;
    let changed = false;
    // port-security and BPDU guard
    for (const sw of Object.values(net.devices)) {
      if (!(sw.kind === 'switch' || sw.kind === 'l3switch') || !c.devUp.get(sw.id)) continue;
      const table = c.macTables.get(sw.id) ?? [];
      for (const i of sw.ifaces) {
        if (!i.switchport || i.type === 'svi') continue;
        const o = c.oper.get(i.id);
        if (!o?.up) continue;
        const ps = i.portSecurity;
        if (ps && ps.enabled && i.mode === 'access') {
          const macs = [...new Set(table.filter((e) => e.port === i.name).map((e) => e.mac))];
          for (const m of macs) {
            if (ps.secureMacs.includes(m)) continue;
            if (ps.secureMacs.length < ps.maximum) {
              ps.secureMacs.push(m);
              changed = true;
              continue;
            }
            ps.violations++;
            this.log(sw.id, `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${ciscoMac(m)} on port ${i.name}.`);
            if (ps.violation === 'shutdown') {
              i.errDisabled = 'psecure-violation';
              this.log(sw.id, `%PM-4-ERR_DISABLE: psecure-violation error detected on ${shortIf(i.name)}, putting ${shortIf(i.name)} in err-disable state`);
              changed = true;
              break;
            }
          }
        }
        if (i.bpduguard && o.peer) {
          const pd = net.devices[o.peer.dev];
          const sendsBpdu = pd && ((pd.kind === 'switch' || pd.kind === 'l3switch') || pd.rogue?.sendsBpdu);
          if (sendsBpdu && i.mode === 'access') {
            i.errDisabled = 'bpduguard';
            this.log(sw.id, `%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${i.name} with BPDU Guard enabled. Disabling port.`);
            this.log(sw.id, `%PM-4-ERR_DISABLE: bpduguard error detected on ${shortIf(i.name)}, putting ${shortIf(i.name)} in err-disable state`);
            changed = true;
          }
        }
      }
    }
    // link state change logs
    if (this.prevOper) {
      for (const d of Object.values(net.devices)) {
        if (!isIos(d)) continue;
        for (const i of d.ifaces) {
          const now = c.oper.get(i.id);
          const before = this.prevOper.get(i.id);
          if (!now || !before) continue;
          if (now.ipStatus !== before.ipStatus) {
            const st = now.ipStatus === 'administratively down' ? 'administratively down' : now.ipStatus;
            this.log(d.id, `%LINK-${now.ipStatus === 'up' ? '3' : '5'}-UPDOWN: Interface ${i.name}, changed state to ${st}`);
          }
          if (now.proto !== before.proto) this.log(d.id, `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${i.name}, changed state to ${now.proto}`);
          if (now.poeStatus !== before.poeStatus && i.poe) {
            if (now.poeStatus === 'denied') this.log(d.id, `%ILPOWER-5-ILPOWER_POWER_DENY: Interface ${shortIf(i.name)}: inline power denied. Reason: insufficient power`);
            if (now.poeStatus === 'on') this.log(d.id, `%ILPOWER-5-POWER_GRANTED: Interface ${shortIf(i.name)}: Power granted`);
          }
        }
      }
      // powered-on transitions start a boot timer
      for (const d of Object.values(net.devices)) {
        const p = c.devPowered.get(d.id);
        const was = this.prevPowered?.get(d.id);
        if (p && was === false) {
          d.bootUntil = this.now + bootMinutes(d.kind);
          changed = true;
        }
      }
    }
    this.prevOper = c.oper;
    this.prevPowered = c.devPowered;
    if (changed) this.invalidate();
  }

  // -------------------------------------------------------------------------
  // Layer-2 helpers

  segOfIface(ifaceId: string): number | undefined {
    return this.c.segOf.get(`if:${ifaceId}`);
  }

  membersOf(seg: number | undefined): L3If[] {
    if (seg === undefined) return [];
    return this.c.segMembers.get(seg) ?? [];
  }

  /** Physical links traversed between two L2 nodes. */
  l2Path(from: string, to: string): string[] {
    const key = `${from}>${to}`;
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    const adj = this.c.adj;
    const prev = new Map<string, { n: string; link: string | null }>();
    const q = [from];
    const seen = new Set([from]);
    while (q.length) {
      const n = q.shift()!;
      if (n === to) break;
      for (const e of adj.get(n) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, { n, link: e.link });
        q.push(e.to);
      }
    }
    const links: string[] = [];
    let cur = to;
    while (prev.has(cur)) {
      const p = prev.get(cur)!;
      if (p.link) links.push(p.link);
      cur = p.n;
    }
    links.reverse();
    this.pathCache.set(key, links);
    return links;
  }

  /** Switch hops (switch id, ingress iface id) along an L2 path, for DHCP snooping checks. */
  private l2Ingress(from: string, to: string): { sw: string; ingressIf: string | null; vlan: number }[] {
    const adj = this.c.adj;
    const prev = new Map<string, { n: string; e: Edge }>();
    const q = [from];
    const seen = new Set([from]);
    while (q.length) {
      const n = q.shift()!;
      if (n === to) break;
      for (const e of adj.get(n) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, { n, e });
        q.push(e.to);
      }
    }
    const out: { sw: string; ingressIf: string | null; vlan: number }[] = [];
    let cur = to;
    while (prev.has(cur)) {
      const p = prev.get(cur)!;
      if (/:v\d+$/.test(cur) && !cur.startsWith('if:') && !cur.startsWith('ap:')) {
        const [sw, v] = cur.split(':v');
        out.push({ sw, ingressIf: p.e.toIf, vlan: Number(v) });
      }
      cur = p.n;
    }
    return out.reverse();
  }

  /** VLAN an endpoint sits in (as seen by the first switch it reaches). */
  vlanOfHost(devId: string): number | null {
    const d = this.dev(devId);
    const i = d?.ifaces[0];
    if (!i) return null;
    const start = `if:${i.id}`;
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const n = q.shift()!;
      for (const e of this.c.adj.get(n) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        const m = /:v(\d+)$/.exec(e.to);
        if (m && !e.to.startsWith('if:') && !e.to.startsWith('ap:')) return Number(m[1]);
        if (e.to.startsWith('if:') || e.to.startsWith('ap:')) q.push(e.to);
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Layer-3: addresses & routing

  primaryIf(d: Device): Iface | null {
    if (d.kind === 'switch') return d.ifaces.find((i) => i.name === 'Vlan99' && i.ip) ?? null;
    for (const i of d.ifaces) if (i.ip && i.mask && this.oper(i).up) return i;
    return d.ifaces.find((i) => i.ip && i.mask) ?? null;
  }

  ownsIp(d: Device, ip: string): boolean {
    return d.ifaces.some((i) => i.ip === ip && this.oper(i).up);
  }

  isRouter(d: Device): boolean {
    return ROUTER_KINDS.has(d.kind) && (d.kind !== 'l3switch' || !!d.ios?.ipRouting);
  }

  routeTable(d: Device): RouteEntry[] {
    void this.c;
    const hit = this.rtCache.get(d.id);
    if (hit) return hit;
    const out = this.buildRouteTable(d);
    this.rtCache.set(d.id, out);
    return out;
  }

  private buildRouteTable(d: Device): RouteEntry[] {
    const out: RouteEntry[] = [];
    for (const i of d.ifaces) {
      if (!i.ip || !i.mask || !this.oper(i).up) continue;
      if (i.switchport && i.type !== 'svi' && (d.kind === 'switch' || d.kind === 'l3switch')) continue;
      out.push({ code: 'C', net: networkOf(i.ip, i.mask), mask: i.mask, nextHop: null, iface: i.name, ad: 0 });
      out.push({ code: 'L', net: i.ip, mask: '255.255.255.255', nextHop: null, iface: i.name, ad: 0 });
    }
    if (d.ios) {
      for (const r of d.ios.routes) {
        let iface: string | null = r.iface;
        if (r.nextHop) {
          const conn = out.find((c) => c.code === 'C' && inNetwork(r.nextHop!, c.net, c.mask));
          if (!conn) continue; // next hop not resolvable → not installed
          iface = iface ?? conn.iface;
        } else if (iface) {
          const ii = d.ifaces.find((x) => x.name === iface);
          if (!ii || !this.oper(ii).up) continue;
        }
        out.push({ code: r.net === '0.0.0.0' && r.mask === '0.0.0.0' ? 'S*' : 'S', net: r.net, mask: r.mask, nextHop: r.nextHop, iface, ad: r.ad });
      }
    }
    if (d.kind === 'isp') {
      out.push({ code: 'S*', net: '0.0.0.0', mask: '0.0.0.0', nextHop: null, iface: 'Internet', ad: 1 });
    }
    return out;
  }

  private lpm(d: Device, dst: string): RouteEntry | null {
    let best: RouteEntry | null = null;
    let bestLen = -1;
    for (const r of this.routeTable(d)) {
      if (!inNetwork(dst, r.net, r.mask)) continue;
      const len = maskToPrefix(r.mask);
      if (len > bestLen || (len === bestLen && best && r.ad < best.ad)) {
        best = r;
        bestLen = len;
      }
    }
    return best;
  }

  /** Decide egress interface and next-hop IP for a packet leaving `d`. */
  private route(d: Device, dst: string, transit: boolean): { iface: Iface; nextHop: string } | { fail: FailCode; detail: string } {
    if (this.isRouter(d)) {
      const r = this.lpm(d, dst);
      if (!r || !r.iface) return { fail: 'no-route', detail: `${d.name} has no route to ${dst}` };
      const iface = d.ifaces.find((i) => i.name === r.iface)!;
      const nextHop = r.code === 'C' ? dst : (r.nextHop ?? dst);
      return { iface, nextHop };
    }
    if (transit) return { fail: 'not-router', detail: `${d.name} is not a router and dropped the packet` };
    const i = this.primaryIf(d);
    if (!i || !i.ip || !i.mask) return { fail: 'no-ip', detail: `${d.name} has no IP address` };
    if (!this.oper(i).up) return { fail: 'no-link', detail: `${d.name}: interface is down` };
    if (sameSubnet(dst, i.ip, i.mask)) return { iface: i, nextHop: dst };
    const gw = d.kind === 'switch' ? d.ios?.defaultGateway : d.host?.gateway;
    if (!gw || !isValidIp(gw)) return { fail: 'no-gateway', detail: `${d.name} has no default gateway` };
    return { iface: i, nextHop: gw };
  }

  // -------------------------------------------------------------------------
  // ACL evaluation

  aclLookup(d: Device, name: string): Acl | undefined {
    return d.ios?.acls.find((a) => a.name === name);
  }

  aclMatch(acl: Acl, pkt: { src: string; dst: string; proto: string; port: number }): AclEntry | null {
    const entries = [...acl.entries].sort((a, b) => a.seq - b.seq);
    for (const e of entries) {
      if (acl.type === 'standard') {
        if (e.src.any || wildcardMatch(pkt.src, e.src.ip, e.src.wildcard)) return e;
        continue;
      }
      if (e.proto !== 'ip' && e.proto !== pkt.proto) continue;
      if (!e.src.any && !wildcardMatch(pkt.src, e.src.ip, e.src.wildcard)) continue;
      if (!e.dst.any && !wildcardMatch(pkt.dst, e.dst.ip, e.dst.wildcard)) continue;
      if (e.dstPort && (pkt.proto === 'tcp' || pkt.proto === 'udp')) {
        const p = pkt.port;
        const ports = e.dstPort.ports;
        const okPort =
          e.dstPort.op === 'eq' ? p === ports[0] : e.dstPort.op === 'neq' ? p !== ports[0] : e.dstPort.op === 'gt' ? p > ports[0] : e.dstPort.op === 'lt' ? p < ports[0] : p >= ports[0] && p <= ports[1];
        if (!okPort) continue;
      } else if (e.dstPort) continue;
      return e;
    }
    return null;
  }

  /** returns null when permitted, otherwise the matching deny (seq -1 = implicit deny) */
  aclDenies(d: Device, aclName: string, pkt: { src: string; dst: string; proto: string; port: number }, count = true): { seq: number } | null {
    const acl = this.aclLookup(d, aclName);
    if (!acl) return null; // non-existent ACL permits everything
    const e = this.aclMatch(acl, pkt);
    if (e && count) e.hits++;
    if (e && e.action === 'permit') return null;
    return { seq: e ? e.seq : -1 };
  }

  // -------------------------------------------------------------------------
  // Packet walk

  forward(srcId: string, dstIp: string, proto: string, port: number, opts: { srcIp?: string; checkAcl: boolean; flowKey: string; count?: boolean }): FwdResult {
    const res: FwdResult = {
      ok: false,
      code: 'ok',
      detail: '',
      hops: [],
      failDev: null,
      dstDev: null,
      links: [],
      natBy: null,
      natIp: null,
      external: null,
      aclHit: null,
      unreachableFrom: null,
      viaWireless: null,
      srcIp: '',
    };
    const fail = (code: FailCode, detail: string, at: string | null) => {
      res.ok = false;
      res.code = code;
      res.detail = detail;
      res.failDev = at;
      return res;
    };
    let cur = this.dev(srcId);
    if (!cur || !this.isUp(srcId)) return fail('host-down', 'source device is not running', srcId);
    let src = opts.srcIp ?? null;
    if (!src && this.isRouter(cur)) {
      // routers source packets from the egress interface
      const r0 = this.route(cur, dstIp, false);
      if (!('fail' in r0)) src = r0.iface.ip;
    }
    src = src ?? this.primaryIf(cur)?.ip ?? null;
    if (!src) return fail('no-ip', `${cur.name} has no IP address`, srcId);
    if (isApipa(src)) return fail('apipa', `${cur.name} only has a self-assigned (APIPA) address`, srcId);
    res.srcIp = src;
    if (cur.pc?.edrIsolated) return fail('no-link', `${cur.name} is isolated by EDR`, srcId);
    let ingress: Iface | null = null;
    const wl = this.c.wlan.get(srcId);
    if (wl) res.viaWireless = wl.ap;
    for (let ttl = 0; ttl < 24; ttl++) {
      if (this.ownsIp(cur, dstIp)) {
        res.ok = true;
        res.dstDev = cur.id;
        return res;
      }
      if (cur.kind === 'isp' && !inNetwork(dstIp, '203.0.113.0', '255.255.255.252')) {
        if (this.net.ispOutage && !this.net.lteBackup) return fail('isp-down', 'ISP upstream network is down', cur.id);
        if (isPrivate(src)) return fail('no-nat', `ISP dropped a packet with private source ${src} (not translated)`, cur.id);
        const h = internetHostByIp(dstIp);
        if (!h) return fail('unreachable', `no response from ${dstIp}`, null);
        res.ok = true;
        res.external = h;
        res.dstDev = 'isp-gw';
        return res;
      }
      const r = this.route(cur, dstIp, ingress !== null);
      if ('fail' in r) {
        if (r.fail === 'no-route' && ingress) res.unreachableFrom = cur.id;
        return fail(r.fail, r.detail, cur.id);
      }
      const egress = r.iface;
      if (opts.checkAcl && egress.aclOut && this.isRouter(cur)) {
        const den = this.aclDenies(cur, egress.aclOut, { src, dst: dstIp, proto, port }, opts.count !== false);
        if (den) {
          res.aclHit = { dev: cur.id, acl: egress.aclOut, seq: den.seq };
          res.unreachableFrom = cur.id;
          return fail('acl', `${cur.name}: ACL ${egress.aclOut} (out on ${shortIf(egress.name)}) denied the packet`, cur.id);
        }
      }
      if (this.isRouter(cur) && ingress?.nat === 'inside' && egress.nat === 'outside' && cur.ios) {
        const rule = cur.ios.natRules.find((n) => n.outsideIface === egress.name);
        if (rule && egress.ip) {
          const acl = this.aclLookup(cur, rule.acl);
          const m = acl ? this.aclMatch(acl, { src, dst: dstIp, proto, port }) : null;
          if (m && m.action === 'permit') {
            res.natBy = cur.id;
            res.natIp = egress.ip;
            src = egress.ip;
          }
        }
      }
      const seg = this.segOfIface(egress.id);
      if (seg === undefined || !this.oper(egress).up) return fail('link-down', `${cur.name}: ${shortIf(egress.name)} is down`, cur.id);
      const cands = this.membersOf(seg).filter((m) => m.ip === r.nextHop && m.dev !== cur.id);
      if (!cands.length) {
        if (ingress) res.unreachableFrom = cur.id;
        return fail('arp', `${cur.name}: no ARP reply from ${r.nextHop}`, cur.id);
      }
      // duplicate IPs: ARP answers flap over time, so the choice varies minute to minute
      const pick = cands.length > 1 ? cands[hash(opts.flowKey + cur.id + Math.floor(this.now / 2)) % cands.length] : cands[0];
      res.links.push(...this.l2Path(`if:${egress.id}`, `if:${pick.ifaceId}`));
      const nd = this.dev(pick.dev);
      const nIf = nd.ifaces.find((i) => i.name === pick.iface)!;
      res.hops.push({ dev: nd.id, ip: pick.ip });
      if (opts.checkAcl && nIf.aclIn && this.isRouter(nd)) {
        const den = this.aclDenies(nd, nIf.aclIn, { src, dst: dstIp, proto, port }, opts.count !== false);
        if (den) {
          res.aclHit = { dev: nd.id, acl: nIf.aclIn, seq: den.seq };
          res.unreachableFrom = nd.id;
          return fail('acl', `${nd.name}: ACL ${nIf.aclIn} (in on ${shortIf(nIf.name)}) denied the packet`, nd.id);
        }
      }
      if (!this.ownsIp(nd, dstIp) && !this.isRouter(nd) && nd.kind !== 'isp') {
        return fail('not-router', `${nd.name} (${pick.ip}) is not a router and dropped the packet`, nd.id);
      }
      cur = nd;
      ingress = nIf;
    }
    return fail('ttl', 'TTL expired in transit (routing loop?)', cur.id);
  }

  /** Would hop k of a forward trace be able to send a TTL-exceeded reply back to the source? */
  hopReplies(fwd: FwdResult, k: number): boolean {
    const hop = fwd.hops[k];
    if (!hop || !fwd.srcIp) return false;
    const natIdx = fwd.natBy ? fwd.hops.findIndex((x) => x.dev === fwd.natBy) : -1;
    const o = { srcIp: hop.ip, checkAcl: false, flowKey: 'ttl', count: false };
    if (fwd.natBy && natIdx >= 0 && k > natIdx) {
      const a = this.forward(hop.dev, fwd.natIp!, 'icmp', 0, o);
      if (!a.ok) return false;
      return this.forward(fwd.natBy, fwd.srcIp, 'icmp', 0, o).ok;
    }
    return this.forward(hop.dev, fwd.srcIp, 'icmp', 0, o).ok;
  }

  /** Full round trip: forward with ACLs, then the reply path. */
  roundTrip(srcId: string, dstIp: string, proto: 'tcp' | 'udp' | 'icmp', port: number, count = true, srcIpOverride?: string): PathCheck {
    const flowKey = `${srcId}>${dstIp}:${proto}/${port}`;
    const fwd = this.forward(srcId, dstIp, proto, port, { checkAcl: true, flowKey, count, srcIp: srcIpOverride });
    if (!fwd.ok) return { ok: false, fwd, rev: null, quality: 0, latencyMs: 0, lossPct: 100 };
    const srcIp = fwd.srcIp;
    const startDev = fwd.dstDev!;
    let rev: FwdResult;
    if (fwd.natBy) {
      rev = this.forward(startDev, fwd.natIp!, proto, port, { srcIp: dstIp, checkAcl: false, flowKey });
      if (rev.ok) {
        const rev2 = this.forward(fwd.natBy, srcIp, proto, port, { srcIp: dstIp, checkAcl: false, flowKey });
        rev2.links = [...rev.links, ...rev2.links];
        rev2.hops = [...rev.hops, ...rev2.hops];
        rev = rev2;
      }
    } else {
      rev = this.forward(startDev, srcIp, proto, port, { srcIp: dstIp, checkAcl: false, flowKey });
    }
    // a reply that lands on a different device (duplicate IP) is lost
    if (rev.ok && rev.dstDev !== srcId) {
      rev.ok = false;
      rev.code = 'arp';
      rev.detail = `reply delivered to ${this.dev(rev.dstDev!)?.name ?? 'another host'} (duplicate IP address)`;
    }
    if (!rev.ok) return { ok: false, fwd, rev, quality: 0, latencyMs: 0, lossPct: 100 };
    const { quality, latency } = this.pathQuality(srcId, fwd, rev);
    return { ok: true, fwd, rev, quality, latencyMs: latency, lossPct: Math.round((1 - quality) * 100) };
  }

  pathQuality(srcId: string, fwd: FwdResult, rev: FwdResult | null): { quality: number; latency: number } {
    let q = 1;
    let latency = 0.4;
    const seen = new Set<string>();
    for (const lid of [...fwd.links, ...(rev?.links ?? [])]) {
      if (seen.has(lid)) continue;
      seen.add(lid);
      const l = this.net.links[lid];
      if (!l) continue;
      latency += 0.15;
      const util = this.utilization(lid);
      if (util > 0.85) {
        q *= 1 - Math.min(0.75, (util - 0.85) * 1.6);
        latency += Math.min(400, (util - 0.85) * 900);
      }
      if (l.status === 'degraded') {
        q *= 0.55;
        latency += 15;
      }
      const ia = this.iface(l.a.dev, l.a.iface);
      if (ia) {
        const o = this.oper(ia);
        if (o.duplexMismatch) {
          q *= 0.6;
          latency += 25;
        }
        if (ia.hwFault === 'crc') q *= 0.86;
      }
      const ib = this.iface(l.b.dev, l.b.iface);
      if (ib?.hwFault === 'crc') q *= 0.86;
    }
    const wl = this.c.wlan.get(srcId);
    if (wl) {
      q *= 0.25 + 0.75 * wl.quality;
      latency += 3 + (1 - wl.quality) * 60;
    }
    if (fwd.hops.some((h) => h.dev === 'fw-edge') || fwd.natBy) {
      if (this.fwOverload > 0) {
        q *= Math.max(0.15, 1 - this.fwOverload);
        latency += this.fwOverload * 300;
      }
    }
    if (fwd.external) {
      latency += 14 + (hash(fwd.external.ip) % 20);
      if (this.net.ispOutage && this.net.lteBackup) {
        q *= 0.7;
        latency += 45;
      }
    }
    return { quality: Math.max(0, Math.min(1, q)), latency: Math.round(latency * 10) / 10 };
  }

  utilization(linkId: string): number {
    const l = this.net.links[linkId];
    if (!l) return 0;
    const load = this.linkLoad.get(linkId) ?? 0;
    let cap = 1000;
    const ia = this.iface(l.a.dev, l.a.iface);
    if (ia) {
      const o = this.oper(ia);
      cap = o.speedMbps || ia.maxMbps;
    }
    if (l.kind === 'wan') cap = this.net.ispOutage && this.net.lteBackup ? 50 : this.net.ispMbps;
    return load / Math.max(1, cap);
  }

  // -------------------------------------------------------------------------
  // DNS

  resolve(srcId: string, name: string): DnsResult {
    void this.c;
    const key = `${srcId}|${name}|${this.net.version}`;
    const hit = this.dnsCache.get(key);
    if (hit) return hit;
    const r = this.resolveUncached(srcId, name);
    if (this.dnsCache.size > 2000) this.dnsCache.clear();
    this.dnsCache.set(key, r);
    return r;
  }

  /** Resolve using an explicit server list (nslookup <name> <server>). Not cached. */
  resolveWith(srcId: string, name: string, servers: string[]): DnsResult {
    return this.resolveUncached(srcId, name, servers);
  }

  private resolveUncached(srcId: string, name0: string, serversOverride?: string[]): DnsResult {
    const name = name0.toLowerCase().replace(/\.$/, '');
    if (isValidIp(name)) return { ok: true, ip: name, server: null, code: 'ok', detail: '', fqdn: name };
    const d = this.dev(srcId);
    const servers = serversOverride ?? (d.kind === 'switch' || d.kind === 'l3switch' || d.kind === 'firewall' ? (d.ios?.nameServers ?? []) : (d.host?.dns ?? []));
    const domain = d.host?.domain || d.ios?.domainName || 'corp.local';
    const fqdn = name.includes('.') ? name : `${name}.${domain}`;
    if (!servers.length) return { ok: false, ip: null, server: null, code: 'noserver', detail: 'No DNS servers configured', fqdn };
    let last: DnsResult = { ok: false, ip: null, server: servers[0], code: 'timeout', detail: 'DNS request timed out', fqdn };
    for (const s of servers) {
      const path = this.roundTrip(srcId, s, 'udp', 53);
      if (!path.ok) {
        last = { ok: false, ip: null, server: s, code: 'timeout', detail: `DNS request to ${s} timed out (${path.rev ? path.rev.detail : path.fwd.detail})`, fqdn };
        continue;
      }
      const ans = this.answerFrom(path.fwd, fqdn, s);
      if (ans.code === 'timeout') {
        last = ans;
        continue;
      }
      return ans;
    }
    return last;
  }

  private answerFrom(fwd: FwdResult, fqdn: string, server: string): DnsResult {
    if (fwd.external) {
      if (!fwd.external.udp.includes(53)) return { ok: false, ip: null, server, code: 'timeout', detail: `${server} is not a DNS server`, fqdn };
      const h = internetHostByName(fqdn);
      if (h) return { ok: true, ip: h.ip, server, code: 'ok', detail: '', fqdn };
      return { ok: false, ip: null, server, code: 'nxdomain', detail: `Non-existent domain`, fqdn };
    }
    const sd = this.dev(fwd.dstDev!);
    if (sd.rogue) return { ok: false, ip: null, server, code: 'timeout', detail: `${server} did not answer (no upstream)`, fqdn };
    const dns = sd.server?.services.find((x) => x.id === 'dns');
    if (!sd.server || !dns) return { ok: false, ip: null, server, code: 'timeout', detail: `${server} is not running a DNS service`, fqdn };
    if (!dns.running) return { ok: false, ip: null, server, code: 'timeout', detail: `DNS service on ${sd.name} is not running`, fqdn };
    const zone = sd.server.dnsZone ?? [];
    if (fqdn.endsWith('.corp.local') || fqdn === 'corp.local') {
      let cur = fqdn;
      for (let i = 0; i < 6; i++) {
        const rec = zone.find((z) => z.name === cur);
        if (!rec) return { ok: false, ip: null, server, code: 'nxdomain', detail: 'Non-existent domain', fqdn };
        if (rec.type === 'A') return { ok: true, ip: rec.value, server, code: 'ok', detail: '', fqdn };
        cur = rec.value;
      }
      return { ok: false, ip: null, server, code: 'servfail', detail: 'CNAME loop', fqdn };
    }
    // forward to upstream resolvers
    for (const f of sd.server.dnsForwarders) {
      const up = this.roundTrip(sd.id, f, 'udp', 53, false);
      if (up.ok && up.fwd.external?.udp.includes(53)) {
        const h = internetHostByName(fqdn);
        if (h) return { ok: true, ip: h.ip, server, code: 'ok', detail: '', fqdn };
        return { ok: false, ip: null, server, code: 'nxdomain', detail: 'Non-existent domain', fqdn };
      }
    }
    return { ok: false, ip: null, server, code: 'servfail', detail: `Server failed: ${sd.name} could not reach its forwarders`, fqdn };
  }

  // -------------------------------------------------------------------------
  // Services

  serviceListening(dstDevId: string | null, external: InternetHost | null, proto: 'tcp' | 'udp' | 'icmp', port: number): { ok: boolean; detail: string } {
    if (proto === 'icmp') return { ok: true, detail: '' };
    if (external) {
      const ports = proto === 'tcp' ? external.tcp : external.udp;
      return ports.includes(port) ? { ok: true, detail: '' } : { ok: false, detail: `connection refused by ${external.name}` };
    }
    const d = dstDevId ? this.dev(dstDevId) : null;
    if (!d) return { ok: false, detail: 'no destination' };
    if (d.server) {
      // nginx reverse-proxies the ERP app: 443 requires both nginx and erp-api for erp.*
      const s = d.server.services.find((x) => x.proto === proto && x.ports.includes(port));
      if (!s) return { ok: false, detail: `connection refused (nothing listening on ${proto}/${port})` };
      if (!s.running) return { ok: false, detail: `connection refused (${s.name} is not running)` };
      if (d.server.diskUsedPct >= 99.5) return { ok: false, detail: `${s.name} returned an error (disk full)` };
      return { ok: true, detail: '' };
    }
    if (d.kind === 'printer') return [9100, 80, 443, 631].includes(port) && d.printer!.status !== 'offline' ? { ok: true, detail: '' } : { ok: false, detail: 'printer did not accept the connection' };
    if (isIos(d)) return port === 22 ? { ok: true, detail: '' } : { ok: false, detail: 'connection refused' };
    return { ok: false, detail: 'connection refused' };
  }

  checkService(srcId: string, host: string, proto: 'tcp' | 'udp', port: number): ServiceCheck {
    void this.c;
    const key = `${srcId}|${host}|${proto}|${port}|${this.net.version}|${this.loadEpoch}`;
    const hit = this.svcCache.get(key);
    if (hit) return hit;
    // reachability only changes with the network state; quality changes with load every minute
    const bkey = `${srcId}|${host}|${proto}|${port}`;
    let base = this.svcBase.get(bkey);
    if (!base) {
      base = this.checkServiceUncached(srcId, host, proto, port);
      this.svcBase.set(bkey, base);
    }
    let r = base.r;
    if (r.ok && base.fwd) {
      const { quality, latency } = this.pathQuality(srcId, base.fwd, base.rev);
      r = { ...r, quality, latencyMs: latency, stage: quality < 0.6 ? 'quality' : 'ok', detail: quality < 0.6 ? 'very slow / packet loss' : '' };
    }
    if (this.svcCache.size > 3000) this.svcCache.clear();
    this.svcCache.set(key, r);
    return r;
  }

  private checkServiceUncached(srcId: string, host: string, proto: 'tcp' | 'udp', port: number): { r: ServiceCheck; fwd: FwdResult | null; rev: FwdResult | null } {
    const d = this.dev(srcId);
    const failR = (stage: ServiceCheck['stage'], detail: string): ServiceCheck => ({ ok: false, stage, detail, quality: 0, latencyMs: 0, dstIp: null });
    const fail = (stage: ServiceCheck['stage'], detail: string) => ({ r: failR(stage, detail), fwd: null, rev: null });
    if (!d || !this.isUp(srcId)) return fail('power', 'device is off');
    if (d.pc?.edrIsolated) return fail('network', 'endpoint is isolated by EDR');
    const i = this.primaryIf(d) ?? d.ifaces[0];
    if (!i || !this.oper(i).up) return fail('link', i?.type === 'wlan' ? 'not connected to Wi-Fi' : 'network cable unplugged / no link');
    if (!i.ip) return fail('ip', 'no IP address');
    if (isApipa(i.ip)) return fail('ip', 'self-assigned (APIPA) address – DHCP failed');
    const dns = this.resolve(srcId, host);
    if (!dns.ok) return fail('dns', `could not resolve ${host}: ${dns.detail}`);
    const path = this.roundTrip(srcId, dns.ip!, proto, port);
    if (!path.ok) return { r: { ...failR('network', path.rev ? `no reply: ${path.rev.detail}` : path.fwd.detail), dstIp: dns.ip }, fwd: null, rev: null };
    const lis = this.serviceListening(path.fwd.dstDev, path.fwd.external, proto, port);
    if (!lis.ok) return { r: { ...failR('service', lis.detail), dstIp: dns.ip }, fwd: null, rev: null };
    return { r: { ok: true, stage: 'ok', detail: '', quality: path.quality, latencyMs: path.latencyMs, dstIp: dns.ip }, fwd: path.fwd, rev: path.rev };
  }

  // -------------------------------------------------------------------------
  // DHCP

  poolAddresses(pool: DhcpPool): string[] {
    if (!pool.network || !pool.mask) return [];
    const start = ipToInt(pool.network) + 1;
    const size = 2 ** (32 - maskToPrefix(pool.mask)) - 2;
    const out: string[] = [];
    for (let k = 0; k < Math.min(size, 4094); k++) out.push(intToIp((start + k) >>> 0));
    return out;
  }

  isExcluded(ios: NonNullable<Device['ios']>, ip: string): boolean {
    return ios.dhcpExcluded.some((e) => cmpIp(ip, e.start) >= 0 && cmpIp(ip, e.end) <= 0);
  }

  poolStats(d: Device, pool: DhcpPool): { total: number; excluded: number; leased: number; free: number } {
    const ios = d.ios!;
    const addrs = this.poolAddresses(pool);
    const excluded = addrs.filter((a) => this.isExcluded(ios, a)).length;
    const leased = ios.dhcpBindings.filter((b) => b.pool === pool.name && b.expires > this.now).length;
    const conflicts = ios.dhcpConflicts.filter((c) => pool.network && pool.mask && inNetwork(c.ip, pool.network, pool.mask)).length;
    return { total: addrs.length, excluded, leased, free: Math.max(0, addrs.length - excluded - leased - conflicts) };
  }

  /** Allocate (or renew) a lease from an IOS pool. */
  allocate(server: Device, pool: DhcpPool, mac: string, deviceId: string | null, seg: number | undefined): string | null {
    const ios = server.ios!;
    ios.dhcpBindings = ios.dhcpBindings.filter((b) => b.expires > this.now);
    const leaseMin = Math.max(1, pool.leaseDays * 1440 + pool.leaseHours * 60);
    const existing = ios.dhcpBindings.find((b) => b.mac === mac && b.pool === pool.name);
    if (existing) {
      existing.expires = this.now + leaseMin;
      existing.deviceId = deviceId;
      return existing.ip;
    }
    const taken = new Set(ios.dhcpBindings.map((b) => b.ip));
    const conflicts = new Set(ios.dhcpConflicts.map((c) => c.ip));
    const inUse = new Set(this.membersOf(seg).map((m) => m.ip));
    for (const ip of this.poolAddresses(pool)) {
      if (this.isExcluded(ios, ip) || taken.has(ip) || conflicts.has(ip)) continue;
      if (inUse.has(ip)) {
        // IOS pings an address before offering it
        ios.dhcpConflicts.push({ ip, detected: this.now });
        this.log(server.id, `%DHCPD-4-PING_CONFLICT: DHCP address conflict:  server pinged ${ip}.`);
        continue;
      }
      ios.dhcpBindings.push({ ip, mac, expires: this.now + leaseMin, deviceId, pool: pool.name });
      return ip;
    }
    this.log(server.id, `%DHCPD-4-NO_ADDRESS: DHCP pool ${pool.name} has no free addresses (exhausted)`);
    return null;
  }

  /**
   * Run a DHCP exchange for a host. Returns the applied config or a failure reason.
   * The caller (game) applies the result to the host config.
   */
  dhcpExchange(devId: string): { ok: true; ip: string; mask: string; gw: string | null; dns: string[]; domain: string; server: string; leaseMin: number } | { ok: false; reason: string } {
    const d = this.dev(devId);
    const i = d.ifaces[0];
    if (!this.isUp(devId)) return { ok: false, reason: 'device off' };
    if (!this.oper(i).up) return { ok: false, reason: 'media disconnected' };
    const clientNode = `if:${i.id}`;
    const seg = this.c.segOf.get(clientNode);
    if (seg === undefined) return { ok: false, reason: 'no network' };
    // gather all L3 nodes in the client's segment (including ones without IPs we can't use)
    const members = this.membersOf(seg);
    type Offer = { kind: 'ios'; server: Device; pool: DhcpPool; via: L3If } | { kind: 'rogue'; server: Device; via: L3If };
    const offers: Offer[] = [];
    for (const m of members) {
      const sd = this.dev(m.dev);
      if (sd.id === devId) continue;
      if (sd.rogue?.dhcp && this.isUp(sd.id)) {
        offers.push({ kind: 'rogue', server: sd, via: m });
        continue;
      }
      if (!sd.ios) continue;
      const iff = sd.ifaces.find((x) => x.name === m.iface)!;
      const local = sd.ios.dhcpPools.find((p) => p.network && p.mask && inNetwork(m.ip, p.network, p.mask));
      if (local) offers.push({ kind: 'ios', server: sd, pool: local, via: m });
      else
        for (const h of iff.helper) {
          const target = Object.values(this.net.devices).find((x) => x.ifaces.some((y) => y.ip === h) && x.ios);
          const pool = target?.ios?.dhcpPools.find((p) => p.network && p.mask && inNetwork(m.ip, p.network, p.mask));
          if (target && pool && this.isUp(target.id)) offers.push({ kind: 'ios', server: target, pool, via: m });
        }
    }
    // DHCP snooping: drop server messages entering an untrusted port on a snooping switch
    const allowed = offers.filter((o) => {
      const hops = this.l2Ingress(`if:${o.via.ifaceId}`, clientNode);
      for (const h of hops) {
        const sw = this.dev(h.sw);
        const sn = sw.ios?.dhcpSnooping;
        if (!sn?.enabled || !sn.vlans.includes(h.vlan) || !h.ingressIf) continue;
        const ingress = sw.ifaces.find((x) => x.id === h.ingressIf);
        if (ingress && !ingress.dhcpSnoopTrust) {
          this.log(sw.id, `%DHCP_SNOOPING-5-DHCP_SNOOPING_UNTRUSTED_PORT: DHCP_SNOOPING drop message on untrusted port, message type: DHCPOFFER, MAC sa: ${ciscoMac(o.server.ifaces[0].mac)}`);
          return false;
        }
      }
      return true;
    });
    if (!allowed.length) return { ok: false, reason: offers.length ? 'DHCP offers were dropped' : 'no DHCP server responded' };
    // consumer routers answer fast: rogue wins most races
    const rogue = allowed.find((o) => o.kind === 'rogue');
    const legit = allowed.filter((o) => o.kind === 'ios') as Extract<Offer, { kind: 'ios' }>[];
    const rogueWins = rogue && (!legit.length || hash(`${i.mac}${Math.floor(this.now / 7)}`) % 10 < 7);
    if (rogueWins && rogue && rogue.server.rogue?.dhcp) {
      const rd = rogue.server.rogue.dhcp;
      const host = 100 + (hash(i.mac) % 100);
      const ip = `${rd.net.split('.').slice(0, 3).join('.')}.${host}`;
      return { ok: true, ip, mask: rd.mask, gw: rd.gw, dns: [rd.dns], domain: 'lan', server: rd.gw, leaseMin: 1440 };
    }
    for (const o of legit) {
      const ip = this.allocate(o.server, o.pool, i.mac, devId, seg);
      if (!ip) continue;
      return {
        ok: true,
        ip,
        mask: o.pool.mask!,
        gw: o.pool.defaultRouter[0] ?? null,
        dns: [...o.pool.dns],
        domain: o.pool.domain,
        server: o.via.ip,
        leaseMin: Math.max(1, o.pool.leaseDays * 1440 + o.pool.leaseHours * 60),
      };
    }
    return { ok: false, reason: 'DHCP pool exhausted' };
  }

  // -------------------------------------------------------------------------
  // Tables for show commands

  arpTable(d: Device): { ip: string; mac: string; iface: string; age: number }[] {
    const out: { ip: string; mac: string; iface: string; age: number }[] = [];
    for (const i of d.ifaces) {
      if (!i.ip || !i.mask || !this.oper(i).up) continue;
      const seg = this.segOfIface(i.id);
      out.push({ ip: i.ip, mac: i.mac, iface: i.name, age: -1 });
      for (const m of this.membersOf(seg)) {
        if (m.dev === d.id) continue;
        if (!sameSubnet(m.ip, i.ip, i.mask)) continue;
        out.push({ ip: m.ip, mac: m.mac, iface: i.name, age: hash(m.mac) % 30 });
      }
    }
    // duplicate IPs: only one MAC is shown (whichever answered last)
    const seen = new Map<string, number>();
    const res: typeof out = [];
    for (const e of out) {
      const k = `${e.ip}|${e.iface}`;
      if (seen.has(k)) {
        if (Math.floor(this.now) % 2 === 0) res[seen.get(k)!] = e;
        continue;
      }
      seen.set(k, res.length);
      res.push(e);
    }
    return res.sort((a, b) => cmpIp(a.ip, b.ip));
  }

  duplicateIps(): { ip: string; devs: string[] }[] {
    const out: { ip: string; devs: string[] }[] = [];
    for (const [, members] of this.c.segMembers) {
      const byIp = new Map<string, string[]>();
      for (const m of members) {
        if (!byIp.has(m.ip)) byIp.set(m.ip, []);
        byIp.get(m.ip)!.push(m.dev);
      }
      for (const [ip, devs] of byIp) if (devs.length > 1) out.push({ ip, devs });
    }
    return out;
  }

  cdpNeighbors(d: Device): { dev: Device; localIf: string; remoteIf: string; hold: number }[] {
    const out: { dev: Device; localIf: string; remoteIf: string; hold: number }[] = [];
    if (!this.isUp(d.id)) return out;
    for (const i of d.ifaces) {
      const o = this.oper(i);
      if (!o.up || !o.peer || i.type === 'wlan') continue;
      const pd = this.dev(o.peer.dev);
      if (!pd || !(isIos(pd) || pd.kind === 'ap')) continue;
      out.push({ dev: pd, localIf: i.name, remoteIf: o.peer.iface, hold: 120 + (hash(i.id) % 50) });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Traffic accounting (called once per simulated minute)

  minuteTick(userFlows: UserFlow[]): void {
    this.loadEpoch++;
    const load = new Map<string, number>();
    const add = (links: string[], mbps: number) => {
      for (const l of new Set(links)) load.set(l, (load.get(l) ?? 0) + mbps);
    };
    for (const f of userFlows) {
      const r = this.forward(f.src, f.dstIp, 'tcp', 443, { checkAcl: true, flowKey: `u${f.src}`, count: true });
      if (r.ok) add(r.links, f.mbps);
      if (r.ok && r.external) add(this.wanLinks(), f.mbps);
    }
    let fwDos = 0;
    for (const f of this.net.flows) {
      f.blockedAt = null;
      if (f.src === 'internet') {
        if (this.net.ispUpstreamFilter && f.kind === 'dos') continue;
        // arrives on the WAN link regardless of ACLs
        add(this.wanLinks(), f.mbps);
        const r = this.forward('isp-gw', f.dstIp, f.proto, f.port, { srcIp: f.srcIp, checkAcl: true, flowKey: f.id, count: true });
        if (!r.ok && r.code === 'acl') {
          f.blockedAt = r.aclHit?.dev ?? 'acl';
          fwDos += f.mbps * 0.08; // ACL drops are cheap
        } else {
          fwDos += f.mbps;
        }
        continue;
      }
      if (!this.isUp(f.src)) continue;
      const d = this.dev(f.src);
      if (d.pc?.edrIsolated) {
        f.blockedAt = f.src;
        continue;
      }
      const r = this.forward(f.src, f.dstIp, f.proto, f.port, { checkAcl: true, flowKey: f.id, count: true });
      if (!r.ok) {
        f.blockedAt = r.aclHit?.dev ?? r.failDev ?? 'path';
        if (r.links.length) add(r.links, f.mbps);
        continue;
      }
      add(r.links, f.mbps);
      if (r.external) add(this.wanLinks(), f.mbps);
    }
    this.linkLoad = load;
    this.fwOverload = Math.max(0, Math.min(0.85, (fwDos - 60) / 300));
    this.fwCpu = Math.round(Math.min(99, 9 + fwDos / 3 + (hash(String(this.loadEpoch)) % 5)));
    this.coreCpu = 12 + (hash(`c${this.loadEpoch}`) % 6);
    // interface counters
    for (const l of Object.values(this.net.links)) {
      const mbps = load.get(l.id) ?? 0;
      const ia = this.iface(l.a.dev, l.a.iface);
      const ib = this.iface(l.b.dev, l.b.iface);
      const up = ia && this.oper(ia).up;
      for (const [i, dir] of [
        [ia, 1],
        [ib, -1],
      ] as [Iface | undefined, number][]) {
        if (!i) continue;
        const base = up ? 0.15 + (hash(i.id + this.loadEpoch) % 100) / 200 : 0;
        const inM = up ? mbps * (dir > 0 ? 0.35 : 0.65) + base : 0;
        const outM = up ? mbps * (dir > 0 ? 0.65 : 0.35) + base : 0;
        i.counters.inRate = Math.round(inM * 1e6);
        i.counters.outRate = Math.round(outM * 1e6);
        const inPk = Math.round((inM * 1e6 * 60) / 8 / 800);
        const outPk = Math.round((outM * 1e6 * 60) / 8 / 800);
        i.counters.inPkts += inPk;
        i.counters.outPkts += outPk;
        i.counters.inBytes += inPk * 800;
        i.counters.outBytes += outPk * 800;
        i.counters.broadcasts += up ? 3 + (hash(i.id) % 5) : 0;
        if (up && (l.status === 'degraded' || i.hwFault === 'crc')) {
          const e = 20 + (hash(i.id + this.loadEpoch) % 60);
          i.counters.crc += e;
          i.counters.inErrors += e;
        }
        if (up && this.oper(i).duplexMismatch) {
          if (this.oper(i).duplex === 'half') {
            i.counters.collisions += 40 + (hash(i.id + this.loadEpoch) % 40);
            i.counters.lateCollisions += 5 + (hash(i.id) % 10);
          } else {
            const e = 30 + (hash(i.id + this.loadEpoch) % 50);
            i.counters.crc += e;
            i.counters.inErrors += e;
          }
        }
      }
    }
    // SVIs: aggregate rates loosely from member ports
    for (const d of Object.values(this.net.devices)) {
      for (const i of d.ifaces) {
        if (i.type !== 'svi' && i.type !== 'wlan') continue;
        const up = this.oper(i).up;
        i.counters.inRate = up ? Math.round((0.5 + (hash(i.id + this.loadEpoch) % 100) / 30) * 1e6) : 0;
        i.counters.outRate = up ? Math.round((0.4 + (hash(i.id + 'o' + this.loadEpoch) % 100) / 30) * 1e6) : 0;
        i.counters.inPkts += up ? 1200 : 0;
        i.counters.outPkts += up ? 1100 : 0;
      }
    }
  }

  wanLinks(): string[] {
    return Object.values(this.net.links)
      .filter((l) => l.kind === 'wan')
      .map((l) => l.id);
  }

  /** Utilisation of the Internet circuit (0..n). */
  wanUtil(): number {
    const w = this.wanLinks()[0];
    return w ? this.utilization(w) : 0;
  }

  publicHosts(): InternetHost[] {
    return INTERNET_HOSTS;
  }

  /** Assign a deterministic APIPA address. */
  apipaFor(mac: string): string {
    const h = hash(mac);
    return `169.254.${1 + (h % 254)}.${1 + ((h >>> 8) % 253)}`;
  }

  nextFreeIp(base: string): string {
    return addIp(base, 1);
  }
}
