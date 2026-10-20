/**
 * Running/startup configuration snapshots and IOS-style config rendering.
 */
import type { AclEntry, AddrSpec, Device, Iface, IosConfig, PortMatch } from './model';
import { formatVlanList, parseVlanList } from './model';

const IFACE_CFG_KEYS = [
  'shutdown',
  'description',
  'switchport',
  'mode',
  'accessVlan',
  'nativeVlan',
  'allowedVlans',
  'ip',
  'mask',
  'helper',
  'aclIn',
  'aclOut',
  'nat',
  'speed',
  'duplex',
  'poe',
  'portfast',
  'bpduguard',
  'portSecurity',
  'dhcpSnoopTrust',
] as const;

type IfaceCfg = Pick<Iface, (typeof IFACE_CFG_KEYS)[number]> & { name: string };

interface ConfigSnapshot {
  name: string;
  ios: Omit<IosConfig, 'dhcpBindings' | 'dhcpConflicts' | 'startup'>;
  ifaces: IfaceCfg[];
}

function cleanIos(ios: IosConfig): ConfigSnapshot['ios'] {
  const { dhcpBindings: _b, dhcpConflicts: _c, startup: _s, ...rest } = ios;
  const copy = JSON.parse(JSON.stringify(rest)) as ConfigSnapshot['ios'];
  for (const acl of copy.acls) for (const e of acl.entries) e.hits = 0;
  return copy;
}

function ifaceCfg(i: Iface): IfaceCfg {
  const o: Record<string, unknown> = { name: i.name };
  for (const k of IFACE_CFG_KEYS) o[k] = JSON.parse(JSON.stringify(i[k] ?? null));
  if (o.portSecurity) (o.portSecurity as { violations: number }).violations = 0;
  return o as unknown as IfaceCfg;
}

export function snapshotConfig(d: Device): string {
  if (!d.ios) return '';
  const snap: ConfigSnapshot = { name: d.name, ios: cleanIos(d.ios), ifaces: d.ifaces.map(ifaceCfg) };
  return JSON.stringify(snap);
}

export function isUnsaved(d: Device): boolean {
  if (!d.ios) return false;
  return d.ios.startup !== snapshotConfig(d);
}

export function restoreStartup(d: Device): void {
  if (!d.ios || !d.ios.startup) return;
  const snap = JSON.parse(d.ios.startup) as ConfigSnapshot;
  const { dhcpBindings, dhcpConflicts, startup } = d.ios;
  d.name = snap.name;
  d.ios = { ...snap.ios, dhcpBindings, dhcpConflicts, startup } as IosConfig;
  for (const ic of snap.ifaces) {
    const i = d.ifaces.find((x) => x.name === ic.name);
    if (!i) continue;
    Object.assign(i, ic);
  }
}

// ---------------------------------------------------------------------------
// Rendering

export const PORT_NAMES: Record<string, number> = {
  ftp: 21,
  ssh: 22,
  telnet: 23,
  smtp: 25,
  domain: 53,
  bootps: 67,
  bootpc: 68,
  www: 80,
  http: 80,
  ntp: 123,
  snmp: 161,
  https: 443,
  smb: 445,
};

const PORT_DISPLAY: Record<number, string> = { 21: 'ftp', 23: 'telnet', 25: 'smtp', 53: 'domain', 67: 'bootps', 68: 'bootpc', 80: 'www', 123: 'ntp', 161: 'snmp' };

export function addrToStr(a: AddrSpec): string {
  if (a.any) return 'any';
  if (a.wildcard === '0.0.0.0') return `host ${a.ip}`;
  return `${a.ip} ${a.wildcard}`;
}

function portToStr(p: PortMatch | null): string {
  if (!p) return '';
  const name = (n: number) => PORT_DISPLAY[n] ?? String(n);
  if (p.op === 'range') return ` range ${name(p.ports[0])} ${name(p.ports[1])}`;
  return ` ${p.op} ${name(p.ports[0])}`;
}

export function aceToStr(e: AclEntry, type: 'standard' | 'extended'): string {
  if (type === 'standard') {
    const src = e.src.any ? 'any' : e.src.wildcard === '0.0.0.0' ? `host ${e.src.ip}` : `${e.src.ip}, wildcard bits ${e.src.wildcard}`;
    return `${e.seq} ${e.action} ${src}${e.log ? ' log' : ''}`;
  }
  return `${e.seq} ${e.action} ${e.proto} ${addrToStr(e.src)}${portToStr(e.srcPort)} ${addrToStr(e.dst)}${portToStr(e.dstPort)}${e.log ? ' log' : ''}`;
}

/** Form used inside running-config (standard ACL shows plain "ip wildcard"). */
function aceToCfg(e: AclEntry, type: 'standard' | 'extended'): string {
  if (type === 'standard') return ` ${e.seq} ${e.action} ${e.src.any ? 'any' : e.src.wildcard === '0.0.0.0' ? `host ${e.src.ip}` : `${e.src.ip} ${e.src.wildcard}`}${e.log ? ' log' : ''}`;
  return ` ${aceToStr(e, type)}`;
}

export function renderIfaceConfig(d: Device, i: Iface): string[] {
  const out: string[] = [`interface ${i.name}`];
  if (i.description) out.push(` description ${i.description}`);
  const isSwitch = d.kind === 'switch' || d.kind === 'l3switch';
  if (i.type !== 'svi' && isSwitch) {
    if (!i.switchport) out.push(' no switchport');
    else {
      if (i.mode === 'access') {
        if (i.accessVlan !== 1) out.push(` switchport access vlan ${i.accessVlan}`);
        out.push(' switchport mode access');
      } else {
        if (i.nativeVlan !== 1) out.push(` switchport trunk native vlan ${i.nativeVlan}`);
        if (i.allowedVlans !== 'all') {
          const l = parseVlanList(i.allowedVlans);
          out.push(` switchport trunk allowed vlan ${l ? formatVlanList(l) : i.allowedVlans}`);
        }
        out.push(' switchport mode trunk');
      }
      const ps = i.portSecurity;
      if (ps && ps.enabled) {
        out.push(' switchport port-security');
        if (ps.maximum !== 1) out.push(` switchport port-security maximum ${ps.maximum}`);
        if (ps.violation !== 'shutdown') out.push(` switchport port-security violation ${ps.violation}`);
        if (ps.sticky) {
          out.push(' switchport port-security mac-address sticky');
          for (const m of ps.secureMacs) out.push(` switchport port-security mac-address sticky ${ciscoMacLocal(m)}`);
        }
      }
    }
  }
  if (i.ip && i.mask) out.push(` ip address ${i.ip} ${i.mask}`);
  else if (!i.switchport && i.type !== 'svi' && d.kind !== 'firewall') out.push(' no ip address');
  else if (d.kind === 'firewall' && !i.ip) out.push(' no ip address');
  else if (i.type === 'svi' && !i.ip) out.push(' no ip address');
  for (const h of i.helper) out.push(` ip helper-address ${h}`);
  if (i.aclIn) out.push(` ip access-group ${i.aclIn} in`);
  if (i.aclOut) out.push(` ip access-group ${i.aclOut} out`);
  if (i.nat) out.push(` ip nat ${i.nat}`);
  if (i.speed !== 'auto') out.push(` speed ${i.speed}`);
  if (i.duplex !== 'auto') out.push(` duplex ${i.duplex}`);
  if (i.poe === 'never') out.push(' power inline never');
  if (i.switchport && i.mode === 'access' && i.portfast) out.push(' spanning-tree portfast');
  if (i.bpduguard) out.push(' spanning-tree bpduguard enable');
  if (i.dhcpSnoopTrust && d.ios?.dhcpSnooping.enabled) out.push(' ip dhcp snooping trust');
  if (i.shutdown) out.push(' shutdown');
  return out;
}

function ciscoMacLocal(mac: string): string {
  const h = mac.replace(/[:.-]/g, '').toLowerCase();
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`;
}

export function renderRunningConfig(d: Device): string[] {
  const ios = d.ios!;
  const out: string[] = [];
  out.push('Building configuration...', '');
  const body: string[] = [];
  body.push('!', 'version 17.9', 'service timestamps debug datetime msec', 'service timestamps log datetime msec', 'service password-encryption', '!', `hostname ${d.name}`, '!');
  if (ios.enableSecret) body.push('enable secret 9 $9$Zx81kQ0b$Fq1u0Kc2l1p7mR', '!');
  if (ios.bannerMotd) body.push(`banner motd ^C${ios.bannerMotd}^C`, '!');
  if (ios.ipRouting && d.kind !== 'firewall') body.push('ip routing', '!');
  body.push(`ip domain name ${ios.domainName}`);
  if (ios.nameServers.length) body.push(`ip name-server ${ios.nameServers.join(' ')}`);
  for (const ex of ios.dhcpExcluded) body.push(`ip dhcp excluded-address ${ex.start}${ex.end !== ex.start ? ` ${ex.end}` : ''}`);
  body.push('!');
  for (const p of ios.dhcpPools) {
    body.push(`ip dhcp pool ${p.name}`);
    if (p.network && p.mask) body.push(` network ${p.network} ${p.mask}`);
    if (p.defaultRouter.length) body.push(` default-router ${p.defaultRouter.join(' ')}`);
    if (p.dns.length) body.push(` dns-server ${p.dns.join(' ')}`);
    if (p.domain) body.push(` domain-name ${p.domain}`);
    if (p.leaseDays !== 1 || p.leaseHours !== 0) body.push(` lease ${p.leaseDays}${p.leaseHours ? ` ${p.leaseHours}` : ''}`);
    body.push('!');
  }
  if (ios.dhcpSnooping.enabled) {
    if (ios.dhcpSnooping.vlans.length) body.push(`ip dhcp snooping vlan ${formatVlanList(ios.dhcpSnooping.vlans)}`);
    body.push('ip dhcp snooping', '!');
  }
  if (d.kind === 'switch' || d.kind === 'l3switch') {
    body.push('spanning-tree mode rapid-pvst', 'spanning-tree extend system-id', '!');
    const vlanIds = Object.keys(ios.vlans)
      .map(Number)
      .filter((v) => v !== 1)
      .sort((a, b) => a - b);
    for (const v of vlanIds) body.push(`vlan ${v}`, ` name ${ios.vlans[String(v)]}`, '!');
  }
  for (const i of d.ifaces) {
    body.push(...renderIfaceConfig(d, i), '!');
  }
  if (ios.defaultGateway) body.push(`ip default-gateway ${ios.defaultGateway}`);
  for (const r of ios.routes) body.push(`ip route ${r.net} ${r.mask} ${r.iface ?? ''}${r.iface && r.nextHop ? ' ' : ''}${r.nextHop ?? ''}${r.ad !== 1 ? ` ${r.ad}` : ''}`);
  for (const n of ios.natRules) body.push(`ip nat inside source list ${n.acl} interface ${n.outsideIface}${n.overload ? ' overload' : ''}`);
  body.push('!');
  for (const acl of ios.acls) {
    body.push(`ip access-list ${acl.type} ${acl.name}`);
    for (const e of acl.entries) {
      if (e.remark) body.push(` ${e.seq > 0 ? '' : ''}remark ${e.remark}`);
      body.push(aceToCfg(e, acl.type));
    }
    body.push('!');
  }
  body.push('line con 0', ' logging synchronous', 'line vty 0 15', ' transport input ssh', '!', 'end');
  const bytes = body.join('\n').length;
  out.push(`Current configuration : ${bytes} bytes`, ...body);
  return out;
}
