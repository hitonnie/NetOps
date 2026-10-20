/** Host-side IP configuration: DHCP client behaviour and static settings. */
import type { NetEngine } from './engine';
import type { Device } from './model';

export function isDhcpClient(d: Device): boolean {
  return !!d.host && d.host.dhcp && d.kind !== 'server' && d.kind !== 'isp';
}

function clearAddress(d: Device): void {
  const h = d.host!;
  const i = d.ifaces[0];
  i.ip = null;
  i.mask = null;
  h.ip = null;
  h.mask = null;
  h.gateway = null;
  if (h.dnsFromDhcp) h.dns = [];
  h.dhcpServer = null;
}

/** Run a DHCP DORA exchange for a host and apply the result. */
export function dhcpRenew(engine: NetEngine, devId: string): { ok: boolean; reason: string } {
  const d = engine.dev(devId);
  if (!d?.host || !d.host.dhcp) return { ok: false, reason: 'not a DHCP client' };
  const h = d.host;
  const i = d.ifaces[0];
  h.lastDhcpAttempt = engine.now;
  const r = engine.dhcpExchange(devId);
  if (r.ok) {
    const changed = i.ip !== r.ip || h.gateway !== r.gw || i.mask !== r.mask || (h.dnsFromDhcp && h.dns.join() !== r.dns.join());
    i.ip = r.ip;
    i.mask = r.mask;
    h.ip = r.ip;
    h.mask = r.mask;
    h.gateway = r.gw;
    if (h.dnsFromDhcp) h.dns = [...r.dns];
    h.domain = r.domain;
    h.dhcpServer = r.server;
    h.leaseObtained = engine.now;
    h.leaseExpires = engine.now + r.leaseMin;
    h.ipConflict = false;
    if (changed) engine.invalidate();
    return { ok: true, reason: '' };
  }
  if (r.reason === 'media disconnected' || r.reason === 'device off') {
    if (i.ip) {
      clearAddress(d);
      engine.invalidate();
    }
    return { ok: false, reason: r.reason };
  }
  // a still-valid lease is kept when a renewal fails
  if (i.ip && !i.ip.startsWith('169.254.') && h.leaseExpires > engine.now) return { ok: false, reason: r.reason };
  // DHCP failed: Windows falls back to an APIPA address
  const apipa = engine.apipaFor(i.mac);
  if (i.ip !== apipa) {
    i.ip = apipa;
    i.mask = '255.255.0.0';
    h.ip = apipa;
    h.mask = '255.255.0.0';
    h.gateway = null;
    if (h.dnsFromDhcp) h.dns = [];
    h.dhcpServer = null;
    h.leaseExpires = 0;
    engine.invalidate();
  }
  return { ok: false, reason: r.reason };
}

export function dhcpRelease(engine: NetEngine, devId: string): void {
  const d = engine.dev(devId);
  if (!d?.host || !d.host.dhcp) return;
  // remove the binding from whichever IOS server holds it
  for (const s of Object.values(engine.net.devices)) {
    if (!s.ios) continue;
    s.ios.dhcpBindings = s.ios.dhcpBindings.filter((b) => b.mac !== d.ifaces[0].mac);
  }
  clearAddress(d);
  d.host.leaseExpires = 0;
  engine.invalidate();
}

export function applyStatic(engine: NetEngine, devId: string, cfg: { ip: string; mask: string; gateway: string; dns: string[] }): void {
  const d = engine.dev(devId);
  const h = d.host!;
  const i = d.ifaces[0];
  h.dhcp = false;
  h.dnsFromDhcp = false;
  h.staticIp = cfg.ip;
  h.staticMask = cfg.mask;
  h.staticGateway = cfg.gateway;
  h.staticDns = [...cfg.dns];
  h.ip = cfg.ip || null;
  h.mask = cfg.mask || null;
  h.gateway = cfg.gateway || null;
  h.dns = cfg.dns.filter(Boolean);
  i.ip = h.ip;
  i.mask = h.mask;
  h.dhcpServer = null;
  h.leaseExpires = 0;
  engine.invalidate();
  // Windows checks for duplicate addresses when a static address is applied
  const dup = engine.duplicateIps().find((x) => x.ip === cfg.ip && x.devs.includes(devId));
  h.ipConflict = !!dup;
}

export function enableDhcp(engine: NetEngine, devId: string, dnsToo = true): void {
  const d = engine.dev(devId);
  const h = d.host!;
  h.dhcp = true;
  if (dnsToo) h.dnsFromDhcp = true;
  h.ipConflict = false;
  dhcpRenew(engine, devId);
}

/** Per-minute DHCP client state machine. */
export function dhcpClientTick(engine: NetEngine, d: Device): void {
  const h = d.host;
  if (!h || !h.dhcp || d.kind === 'server') return;
  const i = d.ifaces[0];
  if (!engine.isUp(d.id)) return;
  const up = engine.oper(i).up;
  if (!up) {
    if (i.ip) {
      clearAddress(d);
      engine.invalidate();
    }
    return;
  }
  const now = engine.now;
  const noValid = !i.ip || i.ip.startsWith('169.254.') || h.leaseExpires <= now;
  if (noValid) {
    // retry every 3 minutes (Windows retries DHCP periodically while on APIPA)
    if (now - h.lastDhcpAttempt >= 3) dhcpRenew(engine, d.id);
    return;
  }
  // T1 renewal at 50% of the lease
  const half = h.leaseObtained + (h.leaseExpires - h.leaseObtained) / 2;
  if (now >= half && now - h.lastDhcpAttempt >= 10) dhcpRenew(engine, d.id);
}
