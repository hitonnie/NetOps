/**
 * Network state model. Everything here is plain serialisable data so it can be
 * saved to localStorage. Behaviour lives in engine.ts and the CLI modules.
 */

export type DeviceKind =
  | 'pc'
  | 'laptop'
  | 'printer'
  | 'server'
  | 'switch'
  | 'l3switch'
  | 'firewall'
  | 'ap'
  | 'isp'
  | 'iot'
  | 'rogue';

export type ZoneId =
  | 'mgr'
  | 'atlas'
  | 'borealis'
  | 'design'
  | 'server'
  | 'noc'
  | 'finance'
  | 'eng'
  | 'qa'
  | 'kitchen'
  | 'reception'
  | 'lounge'
  | 'workshop'
  | 'corridor';

export interface Point {
  x: number;
  y: number;
}

export interface Counters {
  inPkts: number;
  outPkts: number;
  inBytes: number;
  outBytes: number;
  inErrors: number;
  crc: number;
  collisions: number;
  lateCollisions: number;
  broadcasts: number;
  /** last-minute rates, bits/sec */
  inRate: number;
  outRate: number;
}

export interface PortSecurity {
  enabled: boolean;
  maximum: number;
  violation: 'shutdown' | 'restrict' | 'protect';
  sticky: boolean;
  secureMacs: string[];
  violations: number;
}

export type IfType = 'copper' | 'sfp' | 'svi' | 'wlan';

export interface Iface {
  id: string; // `${deviceId}|${name}`
  name: string; // full name, e.g. GigabitEthernet1/0/5
  mac: string;
  type: IfType;
  shutdown: boolean;
  description: string;
  // Layer 2
  switchport: boolean;
  mode: 'access' | 'trunk';
  accessVlan: number;
  nativeVlan: number;
  allowedVlans: string; // "all" or IOS list "10,20,30-35"
  // Layer 3
  ip: string | null;
  mask: string | null;
  helper: string[];
  aclIn: string | null;
  aclOut: string | null;
  nat: 'inside' | 'outside' | null;
  // Physical
  speed: 'auto' | '10' | '100' | '1000';
  duplex: 'auto' | 'full' | 'half';
  maxMbps: number;
  poe: 'auto' | 'never' | null;
  portfast: boolean;
  bpduguard: boolean;
  portSecurity: PortSecurity | null;
  dhcpSnoopTrust: boolean;
  errDisabled: string | null;
  hwFault: 'none' | 'crc' | 'dead';
  counters: Counters;
  /** wall port label for desk drops, e.g. "E-07" */
  wallPort?: string;
}

export interface StaticRoute {
  net: string;
  mask: string;
  nextHop: string | null;
  iface: string | null;
  ad: number;
}

export interface DhcpPool {
  name: string;
  network: string | null;
  mask: string | null;
  defaultRouter: string[];
  dns: string[];
  domain: string;
  leaseDays: number;
  leaseHours: number;
}

export interface DhcpBinding {
  ip: string;
  mac: string;
  expires: number; // sim minute; Infinity not serialisable so use large number
  deviceId: string | null; // null => phantom/stale lease (e.g. departed guest phone)
  pool: string;
}

export interface AddrSpec {
  any: boolean;
  ip: string;
  wildcard: string;
}

export interface PortMatch {
  op: 'eq' | 'neq' | 'gt' | 'lt' | 'range';
  ports: number[];
}

export interface AclEntry {
  seq: number;
  action: 'permit' | 'deny';
  proto: 'ip' | 'tcp' | 'udp' | 'icmp';
  src: AddrSpec;
  srcPort: PortMatch | null;
  dst: AddrSpec;
  dstPort: PortMatch | null;
  log: boolean;
  hits: number;
  remark?: string;
}

export interface Acl {
  name: string;
  type: 'standard' | 'extended';
  entries: AclEntry[];
}

export interface NatRule {
  acl: string;
  outsideIface: string;
  overload: boolean;
}

export interface IosConfig {
  vlans: Record<string, string>; // vlan id → name
  ipRouting: boolean;
  defaultGateway: string | null;
  routes: StaticRoute[];
  dhcpPools: DhcpPool[];
  dhcpExcluded: { start: string; end: string }[];
  dhcpBindings: DhcpBinding[];
  dhcpConflicts: { ip: string; detected: number }[];
  acls: Acl[];
  natRules: NatRule[];
  dhcpSnooping: { enabled: boolean; vlans: number[] };
  poeBudgetW: number;
  domainName: string;
  nameServers: string[];
  /** JSON snapshot of the saved (startup) configuration */
  startup: string | null;
  bannerMotd: string;
  enableSecret: string | null;
}

export interface HostConfig {
  dhcp: boolean;
  ip: string | null;
  mask: string | null;
  gateway: string | null;
  dns: string[];
  /** remembered static settings shown in the GUI */
  staticIp: string;
  staticMask: string;
  staticGateway: string;
  staticDns: string[];
  dnsFromDhcp: boolean;
  leaseObtained: number;
  leaseExpires: number;
  dhcpServer: string | null;
  domain: string;
  dnsCache: { name: string; ip: string; expires: number }[];
  lastDhcpAttempt: number;
  ipConflict: boolean;
}

export interface ServiceState {
  id: string;
  name: string; // daemon / Windows service name
  label: string;
  proto: 'tcp' | 'udp';
  ports: number[];
  running: boolean;
  enabled: boolean;
  failed: string | null; // failure reason when crashed
}

export interface DnsRecord {
  name: string; // fqdn
  type: 'A' | 'CNAME';
  value: string;
}

export interface ServerState {
  os: string;
  services: ServiceState[];
  dnsZone: DnsRecord[] | null;
  dnsForwarders: string[];
  diskUsedPct: number;
  cpuPct: number;
  backupWindow: { startHour: number; endHour: number } | null;
}

export interface ApState {
  ssid: string;
  channel: number;
  txPower: 'low' | 'medium' | 'high';
  radioOn: boolean;
  rangePx: number;
  drawW: number;
  injectorPowered: boolean;
}

export interface Proc {
  name: string;
  pid: number;
  mem: number;
  suspicious?: boolean;
}

export interface PcState {
  os: 'windows' | 'macos';
  compromised: boolean;
  malware: { proc: string; c2Ip: string; c2Port: number; since: number } | null;
  edrIsolated: boolean;
  reimageUntil: number;
  scanUntil: number;
  procs: Proc[];
  printerQueue: string | null; // printer device id
  wifiProfile: string;
}

export interface PrinterState {
  status: 'ready' | 'offline' | 'jam';
  jobs: number;
  pagesToday: number;
}

export interface RogueState {
  vendor: string;
  description: string;
  dhcp: { net: string; mask: string; gw: string; dns: string } | null;
  discoveredBy: string | null;
  /** extra MAC addresses behind this device (e.g. a desk switch with a 2nd laptop) */
  extraMacs: string[];
  /** sends spanning-tree BPDUs (unmanaged/managed switch) */
  sendsBpdu: boolean;
  /** unmanaged desk switch: bridges all of its ports together */
  bridge: boolean;
  /** link to restore when the device is removed (it was spliced into an existing cable) */
  restoreLink: { a: [string, string]; b: [string, string] } | null;
}

export interface LogLine {
  t: number;
  msg: string;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  model: string;
  zone: ZoneId;
  pos: Point;
  powered: boolean;
  powerFault: boolean;
  bootUntil: number;
  ifaces: Iface[];
  host: HostConfig | null;
  ios: IosConfig | null;
  server: ServerState | null;
  ap: ApState | null;
  pc: PcState | null;
  printer: PrinterState | null;
  rogue: RogueState | null;
  logs: LogLine[];
  ownerId: string | null;
  serial: string;
  /** PoE draw in watts when powered from a switch port (0 = mains powered) */
  poeW: number;
  /** devices bought from the shop or added as rogue */
  addedAt: number;
  notes: string;
}

export interface LinkEnd {
  dev: string;
  iface: string; // iface full name
}

export interface Link {
  id: string;
  a: LinkEnd;
  b: LinkEnd;
  medium: 'copper' | 'fiber';
  /** degraded = crimped/kinked cable: link up at reduced speed with CRC errors */
  status: 'ok' | 'damaged' | 'unplugged' | 'degraded';
  kind: 'access' | 'uplink' | 'server' | 'wan' | 'rogue';
}

/** Background/special traffic injected by scenarios (backups, malware, floods). */
export interface Flow {
  id: string;
  src: string; // device id, or 'internet'
  srcIp?: string; // for internet-originated floods
  dstIp: string;
  proto: 'tcp' | 'udp' | 'icmp';
  port: number;
  mbps: number;
  label: string;
  kind: 'backup' | 'c2' | 'scan' | 'dos' | 'sync' | 'storm';
  /** dynamic: blocked by ACL this minute */
  blockedAt?: string | null;
}

export interface WirelessEnv {
  /** foreign APs (e.g. neighbouring business) that interfere */
  foreign: { id: string; ssid: string; channel: number; pos: Point; strength: number }[];
}

export interface NetState {
  devices: Record<string, Device>;
  links: Record<string, Link>;
  flows: Flow[];
  wireless: WirelessEnv;
  ispOutage: boolean;
  ispTicketOpen: boolean;
  ispUpstreamFilter: boolean;
  /** monotonic counter bumped on every change that can alter forwarding */
  version: number;
  macSeq: number;
  /** phantom DHCP clients (phones, guests) consuming wifi leases */
  guestDevices: number;
  /** capacity of the internet circuit in Mbps */
  ispMbps: number;
  lteBackup: boolean;
}

// ---------------------------------------------------------------------------
// Factories

export function emptyCounters(): Counters {
  return {
    inPkts: 0,
    outPkts: 0,
    inBytes: 0,
    outBytes: 0,
    inErrors: 0,
    crc: 0,
    collisions: 0,
    lateCollisions: 0,
    broadcasts: 0,
    inRate: 0,
    outRate: 0,
  };
}

export function makeIface(devId: string, name: string, mac: string, opts: Partial<Iface> = {}): Iface {
  return {
    id: `${devId}|${name}`,
    name,
    mac,
    type: 'copper',
    shutdown: false,
    description: '',
    switchport: false,
    mode: 'access',
    accessVlan: 1,
    nativeVlan: 1,
    allowedVlans: 'all',
    ip: null,
    mask: null,
    helper: [],
    aclIn: null,
    aclOut: null,
    nat: null,
    speed: 'auto',
    duplex: 'auto',
    maxMbps: 1000,
    poe: null,
    portfast: false,
    bpduguard: false,
    portSecurity: null,
    dhcpSnoopTrust: false,
    errDisabled: null,
    hwFault: 'none',
    counters: emptyCounters(),
    ...opts,
  };
}

export function emptyIos(): IosConfig {
  return {
    vlans: { '1': 'default' },
    ipRouting: false,
    defaultGateway: null,
    routes: [],
    dhcpPools: [],
    dhcpExcluded: [],
    dhcpBindings: [],
    dhcpConflicts: [],
    acls: [],
    natRules: [],
    dhcpSnooping: { enabled: false, vlans: [] },
    poeBudgetW: 0,
    domainName: 'corp.local',
    nameServers: [],
    startup: null,
    bannerMotd: '',
    enableSecret: null,
  };
}

export function emptyHost(): HostConfig {
  return {
    dhcp: true,
    ip: null,
    mask: null,
    gateway: null,
    dns: [],
    staticIp: '',
    staticMask: '255.255.255.0',
    staticGateway: '',
    staticDns: [],
    dnsFromDhcp: true,
    leaseObtained: 0,
    leaseExpires: 0,
    dhcpServer: null,
    domain: '',
    dnsCache: [],
    lastDhcpAttempt: -999,
    ipConflict: false,
  };
}

export function makeDevice(id: string, name: string, kind: DeviceKind, model: string, zone: ZoneId, pos: Point): Device {
  return {
    id,
    name,
    kind,
    model,
    zone,
    pos,
    powered: true,
    powerFault: false,
    bootUntil: 0,
    ifaces: [],
    host: null,
    ios: null,
    server: null,
    ap: null,
    pc: null,
    printer: null,
    rogue: null,
    logs: [],
    ownerId: null,
    serial: '',
    poeW: 0,
    addedAt: 0,
    notes: '',
  };
}

export function isIos(d: Device): boolean {
  return d.kind === 'switch' || d.kind === 'l3switch' || d.kind === 'firewall';
}

export function isEndpoint(d: Device): boolean {
  return d.kind === 'pc' || d.kind === 'laptop' || d.kind === 'printer' || d.kind === 'server';
}

export function isSwitch(d: Device): boolean {
  return d.kind === 'switch' || d.kind === 'l3switch';
}

/** Short interface name: GigabitEthernet1/0/5 → Gi1/0/5 */
export function shortIf(name: string): string {
  return name
    .replace(/^GigabitEthernet/, 'Gi')
    .replace(/^TenGigabitEthernet/, 'Te')
    .replace(/^FastEthernet/, 'Fa')
    .replace(/^Wireless/, 'Wl');
}

export const IF_TYPES = ['GigabitEthernet', 'TenGigabitEthernet', 'FastEthernet', 'Vlan'] as const;

/**
 * Normalise user input like "gi1/0/5", "g 1/0/5", "Gig1/0/5", "vlan10", "int vlan 10"
 * into a canonical full interface name. Returns null if the type prefix is unknown.
 */
export function normalizeIfName(input: string): string | null {
  const s = input.replace(/\s+/g, '');
  const m = /^([a-zA-Z-]+)([\d/.]+)$/.exec(s);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const nums = m[2];
  const candidates = IF_TYPES.filter((t) => t.toLowerCase().startsWith(prefix));
  // IOS treats "g"/"gi" as GigabitEthernet even though "Vlan" doesn't conflict
  let type: string | undefined;
  if (prefix === 't' || prefix === 'te') type = 'TenGigabitEthernet';
  else if (candidates.length === 1) type = candidates[0];
  else if (candidates.length > 1) type = candidates.find((c) => c.toLowerCase() === prefix) ?? candidates[0];
  if (!type) return null;
  return `${type}${nums}`;
}

/** Parse an IOS VLAN list like "10,20,30-32" (or "all"). */
export function parseVlanList(s: string): number[] | 'all' | null {
  const t = s.trim().toLowerCase();
  if (t === 'all') return 'all';
  if (t === 'none') return [];
  const out = new Set<number>();
  for (const part of t.split(',')) {
    if (!part) return null;
    const r = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!r) return null;
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    if (a < 1 || b > 4094 || b < a) return null;
    for (let v = a; v <= b; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

export function formatVlanList(v: number[] | 'all'): string {
  if (v === 'all') return 'all';
  if (v.length === 0) return 'none';
  const sorted = [...v].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(',');
}

export function vlanAllowed(iface: Iface, vlan: number): boolean {
  const l = parseVlanList(iface.allowedVlans);
  if (l === 'all') return true;
  return !!l && l.includes(vlan);
}

export function fmtMac(mac: string): string {
  // "aa:bb:cc:dd:ee:ff" → "aabb.ccdd.eeff" (Cisco) handled by callers if needed
  return mac;
}

export function ciscoMac(mac: string): string {
  const h = mac.replace(/[:.-]/g, '').toLowerCase();
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`;
}

export function windowsMac(mac: string): string {
  return mac.replace(/[:.]/g, '-').toUpperCase();
}

export function findIface(d: Device, name: string): Iface | undefined {
  return d.ifaces.find((i) => i.name === name);
}
