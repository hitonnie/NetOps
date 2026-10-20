/** Cable routing for the office view: tidy Manhattan routes along trays. */
import type { Device, Link, NetState, Point } from '../net/model';
import { DESKS, T } from '../world/layout';

export interface CableRoute {
  id: string;
  pts: Point[];
  medium: 'copper' | 'fiber';
  kind: Link['kind'];
}

const CAB_PORT_OFFSET = (port: number) => ((port % 6) - 2.5) * 1.6;

function portNum(name: string): number {
  const m = /(\d+)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/** where the trunk tray runs for each access switch on its way to the core */
const UPLINK_TRAY: Record<string, { y: number; x: number; dy: number }> = {
  'sw-eng': { y: 11.0 * T, x: 8.35 * T, dy: -7 },
  'sw-dqa': { y: 11.4 * T, x: 8.55 * T, dy: 0 },
  'sw-office': { y: 11.8 * T, x: 8.75 * T, dy: 7 },
};

function deskSeamFor(dev: Device): number | null {
  const desk = DESKS.find((d) => Math.abs(d.pcPos.x - dev.pos.x) < 2 && Math.abs(d.pcPos.y - dev.pos.y) < 2);
  if (!desk) return null;
  // pods are two rows; the seam between them is where floor boxes sit
  return desk.facing === 'S' ? (desk.y + 1) * T : desk.y * T;
}

export function routeLink(net: NetState, l: Link): CableRoute | null {
  const a = net.devices[l.a.dev];
  const b = net.devices[l.b.dev];
  if (!a || !b) return null;
  // order: endpoint first, infrastructure second
  const infra = (d: Device) => d.kind === 'switch' || d.kind === 'l3switch' || d.kind === 'firewall' || d.kind === 'isp';
  let [ep, epIf, sw, swIf] = [a, l.a.iface, b, l.b.iface];
  if (infra(a) && !infra(b)) [ep, epIf, sw, swIf] = [b, l.b.iface, a, l.a.iface];
  const pn = portNum(swIf);
  const cab = { x: sw.pos.x + CAB_PORT_OFFSET(pn), y: sw.pos.y };
  const pts: Point[] = [];
  if (l.kind === 'uplink' && l.medium === 'fiber') {
    const access = a.kind === 'switch' ? a : b;
    const core = access === a ? b : a;
    const tray = UPLINK_TRAY[access.id] ?? { y: 11.4 * T, x: 8.5 * T, dy: 0 };
    const redundant = /1\/1\/2$/.test(access === a ? l.a.iface : l.b.iface);
    const off = redundant ? 3 : 0;
    const cy = core.pos.y + tray.dy + off;
    pts.push({ x: access.pos.x, y: access.pos.y }, { x: access.pos.x + off, y: tray.y + off }, { x: tray.x + off, y: tray.y + off }, { x: tray.x + off, y: cy }, { x: core.pos.x + 24, y: cy });
    return { id: l.id, pts, medium: 'fiber', kind: l.kind };
  }
  if (infra(ep) && infra(sw)) {
    // rack-internal cabling (ISP→FW→core)
    pts.push({ x: ep.pos.x + 20, y: ep.pos.y }, { x: ep.pos.x + 26, y: ep.pos.y }, { x: sw.pos.x + 26, y: sw.pos.y }, { x: sw.pos.x + 20, y: sw.pos.y });
    return { id: l.id, pts, medium: l.medium, kind: l.kind };
  }
  if (ep.kind === 'server') {
    const lane = ep.pos.x + 27 + pn * 0.9;
    pts.push({ x: ep.pos.x + 24, y: ep.pos.y }, { x: lane, y: ep.pos.y }, { x: lane, y: sw.pos.y + 12 + pn * 0.6 }, { x: sw.pos.x - 24, y: sw.pos.y + 12 + pn * 0.6 });
    return { id: l.id, pts, medium: l.medium, kind: l.kind };
  }
  const seam = deskSeamFor(ep);
  const start = { x: ep.pos.x, y: ep.pos.y };
  if (seam !== null) {
    const jitter = ((pn % 4) - 1.5) * 1.2;
    pts.push(start, { x: start.x, y: seam + jitter }, { x: cab.x, y: seam + jitter }, cab);
  } else if (ep.id === 'noc-pc') {
    pts.push(start, { x: start.x, y: 6.4 * T }, { x: 9.1 * T, y: 6.4 * T }, { x: 9.1 * T, y: sw.pos.y + 11 }, { x: sw.pos.x + 24, y: sw.pos.y + 11 });
  } else {
    // vertical first, then horizontal into the cabinet
    pts.push(start, { x: start.x, y: cab.y + ((pn % 5) - 2) * 1.5 }, cab);
  }
  void epIf;
  return { id: l.id, pts, medium: l.medium, kind: l.kind };
}

const cache = new Map<string, { key: string; route: CableRoute | null }>();

export function cachedRoute(net: NetState, l: Link): CableRoute | null {
  const a = net.devices[l.a.dev];
  const b = net.devices[l.b.dev];
  const key = `${l.a.dev}|${l.a.iface}|${l.b.dev}|${l.b.iface}|${a?.pos.x},${a?.pos.y}|${b?.pos.x},${b?.pos.y}`;
  const c = cache.get(l.id);
  if (c && c.key === key) return c.route;
  const route = routeLink(net, l);
  cache.set(l.id, { key, route });
  return route;
}
