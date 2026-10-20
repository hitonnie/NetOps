/**
 * Builds the initial office network. The design is a classic small-campus
 * layout: ISP → edge firewall → layer-3 core switch → three access switches.
 *
 *  VLAN 10 ENG 10.10.10.0/24      VLAN 50 OFFICE 10.10.50.0/24
 *  VLAN 20 DESIGN 10.10.20.0/24   VLAN 70 WIFI 10.10.70.0/24
 *  VLAN 30 QA 10.10.30.0/24       VLAN 99 MGMT 10.10.99.0/24
 *  VLAN 40 FINANCE 10.10.40.0/24  VLAN 100 SERVERS 10.10.100.0/24
 */
import { DESKS, EQUIP_POS, SPARE_WALL_PORTS, T } from '../world/layout';
import { ROSTER } from '../world/roster';
import {
  type Acl,
  type AclEntry,
  type Device,
  type DeviceKind,
  type Iface,
  type Link,
  type NetState,
  type ServiceState,
  type ZoneId,
  emptyHost,
  emptyIos,
  makeDevice,
  makeIface,
} from './model';
import { snapshotConfig } from './config';

export const VLANS: Record<number, string> = {
  1: 'default',
  10: 'ENG',
  20: 'DESIGN',
  30: 'QA',
  40: 'FINANCE',
  50: 'OFFICE',
  70: 'WIFI-CORP',
  99: 'MGMT',
  100: 'SERVERS',
  998: 'NATIVE-UNUSED',
  999: 'QUARANTINE',
};

export const SUBNETS: { vlan: number; name: string; net: string; gw: string }[] = [
  { vlan: 10, name: 'ENG', net: '10.10.10.0', gw: '10.10.10.1' },
  { vlan: 20, name: 'DESIGN', net: '10.10.20.0', gw: '10.10.20.1' },
  { vlan: 30, name: 'QA', net: '10.10.30.0', gw: '10.10.30.1' },
  { vlan: 40, name: 'FINANCE', net: '10.10.40.0', gw: '10.10.40.1' },
  { vlan: 50, name: 'OFFICE', net: '10.10.50.0', gw: '10.10.50.1' },
  { vlan: 70, name: 'WIFI', net: '10.10.70.0', gw: '10.10.70.1' },
  { vlan: 99, name: 'MGMT', net: '10.10.99.0', gw: '10.10.99.1' },
  { vlan: 100, name: 'SERVERS', net: '10.10.100.0', gw: '10.10.100.1' },
];

export const DNS_SERVER = '10.10.100.10';
export const MASK24 = '255.255.255.0';

const OUI = {
  cisco: '00:1b:54',
  ciscoAp: '70:db:98',
  dell: 'f8:bc:12',
  lenovo: '54:ee:75',
  hp: '3c:d9:2b',
  canon: '00:1e:8f',
  server: '00:50:56',
  axis: 'ac:cc:8e',
  poly: '64:16:7f',
  tplink: '50:c7:bf',
  rpi: 'b8:27:eb',
  netgear: 'a0:40:a0',
};

export function nextMac(net: NetState, vendor: keyof typeof OUI): string {
  net.macSeq++;
  const n = net.macSeq * 7919 + 0x1a2b;
  const b = [(n >>> 16) & 255, (n >>> 8) & 255, n & 255].map((x) => x.toString(16).padStart(2, '0'));
  return `${OUI[vendor]}:${b.join(':')}`;
}

export function vendorOf(mac: string): string {
  const p = mac.slice(0, 8).toLowerCase();
  const map: Record<string, string> = {
    [OUI.cisco]: 'Cisco Systems',
    [OUI.ciscoAp]: 'Cisco Systems',
    [OUI.dell]: 'Dell Inc.',
    [OUI.lenovo]: 'Lenovo',
    [OUI.hp]: 'HP Inc.',
    [OUI.canon]: 'Canon Inc.',
    [OUI.server]: 'VMware/Server NIC',
    [OUI.axis]: 'Axis Communications',
    [OUI.poly]: 'Poly (Plantronics)',
    [OUI.tplink]: 'TP-Link Technologies',
    [OUI.rpi]: 'Raspberry Pi Foundation',
    [OUI.netgear]: 'NETGEAR',
  };
  return map[p] ?? 'Unknown vendor';
}

function serial(net: NetState, prefix: string): string {
  return `${prefix}${(net.macSeq * 104729 + 4241).toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
}

function addDevice(net: NetState, d: Device): Device {
  net.devices[d.id] = d;
  return d;
}

let linkSeq = 0;
export function connect(net: NetState, a: [string, string], b: [string, string], medium: Link['medium'], kind: Link['kind']): Link {
  linkSeq++;
  let id = `L${linkSeq}`;
  while (net.links[id]) {
    linkSeq++;
    id = `L${linkSeq}`;
  }
  const l: Link = { id, a: { dev: a[0], iface: a[1] }, b: { dev: b[0], iface: b[1] }, medium, status: 'ok', kind };
  net.links[id] = l;
  return l;
}

const posOf = (id: string) => ({ ...EQUIP_POS[id] });

// ---------------------------------------------------------------------------
// IOS device builders

function accessSwitch(net: NetState, id: string, name: string, zone: ZoneId, model: string, mgmtIp: string, vlans: number[], poeBudget: number): Device {
  const d = makeDevice(id, name, 'switch', model, zone, posOf(id));
  d.serial = serial(net, 'FOC');
  const ios = emptyIos();
  for (const v of [...vlans, 99, 998, 999]) ios.vlans[String(v)] = VLANS[v];
  ios.defaultGateway = '10.10.99.1';
  ios.poeBudgetW = poeBudget;
  ios.nameServers = [DNS_SERVER];
  ios.bannerMotd = 'Authorized access only. Activity is logged.';
  d.ios = ios;
  for (let p = 1; p <= 24; p++) {
    d.ifaces.push(
      makeIface(id, `GigabitEthernet1/0/${p}`, nextMac(net, 'cisco'), {
        switchport: true,
        mode: 'access',
        accessVlan: 999,
        shutdown: true,
        description: '',
        poe: 'auto',
        portfast: true,
        bpduguard: true,
        maxMbps: 1000,
      }),
    );
  }
  for (let p = 1; p <= 4; p++) {
    d.ifaces.push(
      makeIface(id, `GigabitEthernet1/1/${p}`, nextMac(net, 'cisco'), {
        type: 'sfp',
        switchport: true,
        mode: 'access',
        accessVlan: 999,
        shutdown: true,
        maxMbps: 1000,
      }),
    );
  }
  d.ifaces.push(makeIface(id, 'Vlan99', nextMac(net, 'cisco'), { type: 'svi', ip: mgmtIp, mask: MASK24, description: 'Management' }));
  return addDevice(net, d);
}

function port(d: Device, name: string): Iface {
  const i = d.ifaces.find((x) => x.name === name);
  if (!i) throw new Error(`no iface ${name} on ${d.id}`);
  return i;
}

function setAccess(d: Device, p: number, vlan: number, desc: string) {
  const i = port(d, `GigabitEthernet1/0/${p}`);
  i.mode = 'access';
  i.accessVlan = vlan;
  i.shutdown = false;
  i.description = desc;
}

function setTrunk(d: Device, name: string, allowed: string, desc: string) {
  const i = port(d, name);
  i.mode = 'trunk';
  i.nativeVlan = 998;
  i.allowedVlans = allowed;
  i.shutdown = false;
  i.description = desc;
  i.portfast = false;
  i.bpduguard = false;
  i.dhcpSnoopTrust = true;
}

function ace(seq: number, action: 'permit' | 'deny', proto: AclEntry['proto'], src: string, dst: string, dport?: number, remark?: string): AclEntry {
  const spec = (s: string) => {
    if (s === 'any') return { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' };
    const [ip, wc] = s.split(' ');
    if (ip === 'host') return { any: false, ip: wc, wildcard: '0.0.0.0' };
    return { any: false, ip, wildcard: wc ?? '0.0.0.0' };
  };
  return {
    seq,
    action,
    proto,
    src: spec(src),
    srcPort: null,
    dst: spec(dst),
    dstPort: dport ? { op: 'eq', ports: [dport] } : null,
    log: false,
    hits: 0,
    remark,
  };
}

// ---------------------------------------------------------------------------
// Host builders

function hostDevice(net: NetState, id: string, name: string, kind: DeviceKind, model: string, zone: ZoneId, pos: { x: number; y: number }, vendor: keyof typeof OUI, wireless = false): Device {
  const d = makeDevice(id, name, kind, model, zone, pos);
  d.serial = serial(net, kind === 'printer' ? 'PRN' : 'SN');
  d.host = emptyHost();
  d.host.domain = 'corp.local';
  d.ifaces.push(
    makeIface(id, wireless ? 'Wi-Fi' : 'Ethernet', nextMac(net, vendor), {
      type: wireless ? 'wlan' : 'copper',
      maxMbps: wireless ? 400 : 1000,
    }),
  );
  return addDevice(net, d);
}

function setStatic(d: Device, ip: string, mask: string, gw: string, dns: string[]) {
  const h = d.host!;
  h.dhcp = false;
  h.dnsFromDhcp = false;
  h.ip = ip;
  h.mask = mask;
  h.gateway = gw;
  h.dns = [...dns];
  h.staticIp = ip;
  h.staticMask = mask;
  h.staticGateway = gw;
  h.staticDns = [...dns];
  d.ifaces[0].ip = ip;
  d.ifaces[0].mask = mask;
}

function svc(id: string, name: string, label: string, proto: 'tcp' | 'udp', ports: number[]): ServiceState {
  return { id, name, label, proto, ports, running: true, enabled: true, failed: null };
}

const WIN_PROCS = ['System', 'svchost.exe', 'explorer.exe', 'msedge.exe', 'Teams.exe', 'OneDrive.exe', 'SecurityHealthService.exe', 'RuntimeBroker.exe'];

function pcProcs(dept: string) {
  const extra =
    dept === 'Engineering' || dept === 'QA'
      ? ['Code.exe', 'docker-desktop.exe', 'WindowsTerminal.exe', 'git.exe']
      : dept === 'Design'
        ? ['Figma.exe', 'Photoshop.exe', 'AfterFX.exe']
        : ['EXCEL.EXE', 'OUTLOOK.EXE', 'AcroRd32.exe'];
  return [...WIN_PROCS, ...extra].map((name, i) => ({ name, pid: 400 + i * 132 + name.length * 7, mem: 20 + ((name.length * 37) % 400) }));
}

// ---------------------------------------------------------------------------

export function buildNetwork(): NetState {
  linkSeq = 0;
  const net: NetState = {
    devices: {},
    links: {},
    flows: [],
    wireless: { foreign: [] },
    ispOutage: false,
    ispTicketOpen: false,
    ispUpstreamFilter: false,
    version: 1,
    macSeq: 0,
    guestDevices: 9,
    ispMbps: 500,
    lteBackup: false,
  };

  // --- ISP handoff ------------------------------------------------------------
  const isp = addDevice(net, makeDevice('isp-gw', 'ISP-GW', 'isp', 'Provider CPE (managed by ISP)', 'server', posOf('isp-gw')));
  isp.serial = 'ISP-CIRCUIT-88213';
  isp.ifaces.push(makeIface('isp-gw', 'GigabitEthernet0/0', nextMac(net, 'netgear'), { ip: '203.0.113.1', mask: '255.255.255.252', description: 'Customer handoff' }));

  // --- Edge firewall ----------------------------------------------------------
  const fw = makeDevice('fw-edge', 'FW-EDGE', 'firewall', 'ISR4331 (IOS-XE, zone firewall)', 'server', posOf('fw-edge'));
  fw.serial = serial(net, 'FDO');
  const fwIos = emptyIos();
  fwIos.ipRouting = true;
  fwIos.vlans = {};
  fwIos.nameServers = ['8.8.8.8'];
  fwIos.routes = [
    { net: '0.0.0.0', mask: '0.0.0.0', nextHop: '203.0.113.1', iface: null, ad: 1 },
    { net: '10.10.0.0', mask: '255.255.0.0', nextHop: '10.0.0.2', iface: null, ad: 1 },
  ];
  const natAcl: Acl = { name: 'NAT-INSIDE', type: 'standard', entries: [ace(10, 'permit', 'ip', '10.10.0.0 0.0.255.255', 'any')] };
  const outsideIn: Acl = {
    name: 'OUTSIDE-IN',
    type: 'extended',
    entries: [
      ace(10, 'permit', 'tcp', 'any', 'host 203.0.113.2', 443, 'Customer portal / VPN (static PAT to SRV-APP)'),
      ace(20, 'permit', 'icmp', 'any', 'host 203.0.113.2'),
      ace(100, 'deny', 'ip', 'any', 'any'),
    ],
  };
  outsideIn.entries[2].log = true;
  const insideOut: Acl = { name: 'INSIDE-OUT', type: 'extended', entries: [ace(10, 'permit', 'ip', '10.10.0.0 0.0.255.255', 'any')] };
  fwIos.acls = [natAcl, outsideIn, insideOut];
  fwIos.natRules = [{ acl: 'NAT-INSIDE', outsideIface: 'GigabitEthernet0/0/0', overload: true }];
  fwIos.bannerMotd = 'FW-EDGE — changes require a ticket. Return traffic is inspected (stateful).';
  fw.ios = fwIos;
  fw.ifaces.push(
    makeIface('fw-edge', 'GigabitEthernet0/0/0', nextMac(net, 'cisco'), { ip: '203.0.113.2', mask: '255.255.255.252', nat: 'outside', aclIn: 'OUTSIDE-IN', description: 'OUTSIDE - ISP circuit 500M' }),
    makeIface('fw-edge', 'GigabitEthernet0/0/1', nextMac(net, 'cisco'), { ip: '10.0.0.1', mask: '255.255.255.252', nat: 'inside', aclIn: 'INSIDE-OUT', description: 'INSIDE - to CORE-SW1' }),
    makeIface('fw-edge', 'GigabitEthernet0/0/2', nextMac(net, 'cisco'), { shutdown: true, description: 'unused' }),
  );
  addDevice(net, fw);

  // --- Core layer-3 switch ----------------------------------------------------
  const core = makeDevice('core-sw1', 'CORE-SW1', 'l3switch', 'C9300-24T (layer 3)', 'server', posOf('core-sw1'));
  core.serial = serial(net, 'FOC');
  const cios = emptyIos();
  cios.ipRouting = true;
  for (const [v, n] of Object.entries(VLANS)) cios.vlans[v] = n;
  cios.routes = [{ net: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.0.0.1', iface: null, ad: 1 }];
  cios.nameServers = [DNS_SERVER];
  cios.bannerMotd = 'CORE-SW1 — Brightloop Software HQ core. Authorized access only.';
  const pools: [string, string, string][] = [
    ['ENG', '10.10.10.0', '10.10.10.1'],
    ['DESIGN', '10.10.20.0', '10.10.20.1'],
    ['QA', '10.10.30.0', '10.10.30.1'],
    ['FINANCE', '10.10.40.0', '10.10.40.1'],
    ['OFFICE', '10.10.50.0', '10.10.50.1'],
    ['WIFI', '10.10.70.0', '10.10.70.1'],
  ];
  for (const [name, network, gw] of pools) {
    cios.dhcpPools.push({ name, network, mask: MASK24, defaultRouter: [gw], dns: [DNS_SERVER], domain: 'corp.local', leaseDays: 1, leaseHours: 0 });
    const base = network.split('.').slice(0, 3).join('.');
    cios.dhcpExcluded.push({ start: `${base}.1`, end: `${base}.20` });
  }
  const finIn: Acl = {
    name: 'FIN-IN',
    type: 'extended',
    entries: [
      ace(5, 'permit', 'icmp', '10.10.40.0 0.0.0.255', 'any', undefined, 'Allow ping for troubleshooting'),
      ace(10, 'permit', 'udp', '10.10.40.0 0.0.0.255', `host ${DNS_SERVER}`, 53, 'DNS'),
      ace(20, 'permit', 'tcp', '10.10.40.0 0.0.0.255', 'host 10.10.100.40', 443, 'ERP application'),
      ace(30, 'deny', 'ip', '10.10.40.0 0.0.0.255', '10.10.0.0 0.0.255.255', undefined, 'No lateral access to other internal VLANs'),
      ace(40, 'permit', 'ip', '10.10.40.0 0.0.0.255', 'any', undefined, 'Internet'),
    ],
  };
  cios.acls = [finIn];
  core.ios = cios;
  for (let p = 1; p <= 24; p++) {
    core.ifaces.push(
      makeIface('core-sw1', `GigabitEthernet1/0/${p}`, nextMac(net, 'cisco'), { switchport: true, mode: 'access', accessVlan: 999, shutdown: true, portfast: true }),
    );
  }
  for (let p = 1; p <= 8; p++) {
    core.ifaces.push(makeIface('core-sw1', `GigabitEthernet1/1/${p}`, nextMac(net, 'cisco'), { type: 'sfp', switchport: true, mode: 'access', accessVlan: 999, shutdown: true }));
  }
  for (const s of SUBNETS) {
    core.ifaces.push(
      makeIface('core-sw1', `Vlan${s.vlan}`, nextMac(net, 'cisco'), {
        type: 'svi',
        ip: s.gw,
        mask: MASK24,
        description: `${s.name} gateway`,
        aclIn: s.vlan === 40 ? 'FIN-IN' : null,
      }),
    );
  }
  // routed uplink to firewall
  const g24 = port(core, 'GigabitEthernet1/0/24');
  Object.assign(g24, { switchport: false, shutdown: false, ip: '10.0.0.2', mask: '255.255.255.252', description: 'Routed link to FW-EDGE', portfast: false });
  const serverPorts: [number, string][] = [
    [1, 'SRV-DC01'],
    [2, 'SRV-FILE'],
    [3, 'SRV-GIT'],
    [4, 'SRV-APP'],
    [5, 'SRV-BACKUP'],
  ];
  for (const [p, n] of serverPorts) setAccess(core, p, 100, n);
  setAccess(core, 10, 99, 'NOC-PC');
  addDevice(net, core);
  connect(net, ['isp-gw', 'GigabitEthernet0/0'], ['fw-edge', 'GigabitEthernet0/0/0'], 'copper', 'wan');
  connect(net, ['fw-edge', 'GigabitEthernet0/0/1'], ['core-sw1', 'GigabitEthernet1/0/24'], 'copper', 'uplink');

  // --- Access switches --------------------------------------------------------
  const swEng = accessSwitch(net, 'sw-eng', 'SW-ENG', 'eng', 'C9200-24P', '10.10.99.11', [10, 70], 370);
  const swDqa = accessSwitch(net, 'sw-dqa', 'SW-DQA', 'design', 'C9200-24P', '10.10.99.12', [20, 30, 70], 370);
  const swOff = accessSwitch(net, 'sw-office', 'SW-OFFICE', 'finance', 'WS-C2960X-24PSQ-L', '10.10.99.13', [40, 50, 70], 110);

  setTrunk(swEng, 'GigabitEthernet1/1/1', '10,70,99', 'UPLINK to CORE-SW1 Gi1/1/1');
  setTrunk(swDqa, 'GigabitEthernet1/1/1', '20,30,70,99', 'UPLINK to CORE-SW1 Gi1/1/2');
  setTrunk(swOff, 'GigabitEthernet1/1/1', '40,50,70,99', 'UPLINK to CORE-SW1 Gi1/1/3');
  setTrunk(core, 'GigabitEthernet1/1/1', '10,70,99', 'DOWNLINK to SW-ENG');
  setTrunk(core, 'GigabitEthernet1/1/2', '20,30,70,99', 'DOWNLINK to SW-DQA');
  setTrunk(core, 'GigabitEthernet1/1/3', '40,50,70,99', 'DOWNLINK to SW-OFFICE');
  connect(net, ['sw-eng', 'GigabitEthernet1/1/1'], ['core-sw1', 'GigabitEthernet1/1/1'], 'fiber', 'uplink');
  connect(net, ['sw-dqa', 'GigabitEthernet1/1/1'], ['core-sw1', 'GigabitEthernet1/1/2'], 'fiber', 'uplink');
  connect(net, ['sw-office', 'GigabitEthernet1/1/1'], ['core-sw1', 'GigabitEthernet1/1/3'], 'fiber', 'uplink');

  // --- Servers ----------------------------------------------------------------
  const servers: [string, string, string, string, ServiceState[]][] = [
    ['srv-dc01', 'SRV-DC01', '10.10.100.10', 'Ubuntu 22.04 · BIND9 DNS', [svc('dns', 'named', 'DNS (BIND9)', 'udp', [53]), svc('ntp', 'chronyd', 'NTP', 'udp', [123])]],
    ['srv-file', 'SRV-FILE', '10.10.100.20', 'Ubuntu 22.04 · Samba', [svc('smb', 'smbd', 'SMB file shares', 'tcp', [445])]],
    ['srv-git', 'SRV-GIT', '10.10.100.30', 'Ubuntu 22.04 · GitLab CE', [svc('gitlab', 'gitlab', 'GitLab web & CI', 'tcp', [443, 80])]],
    ['srv-app', 'SRV-APP', '10.10.100.40', 'Ubuntu 22.04 · nginx', [svc('nginx', 'nginx', 'nginx (ERP, staging, wiki)', 'tcp', [443, 80]), svc('erp', 'erp-api', 'ERP application', 'tcp', [8443])]],
    ['srv-backup', 'SRV-BACKUP', '10.10.100.50', 'Ubuntu 22.04 · restic', [svc('backup', 'restic-backup', 'Backup agent (offsite)', 'tcp', [8000])]],
  ];
  serverPorts.forEach(([p], idx) => {
    const [id, name, ip, os, services] = servers[idx];
    const d = hostDevice(net, id, name, 'server', 'PowerEdge R650', 'server', posOf(id), 'server');
    d.ifaces[0].name = 'eth0';
    d.ifaces[0].id = `${id}|eth0`;
    setStatic(d, ip, MASK24, '10.10.100.1', [DNS_SERVER]);
    services.push(svc('ssh', 'sshd', 'OpenSSH', 'tcp', [22]));
    d.server = {
      os,
      services,
      dnsZone: null,
      dnsForwarders: [],
      diskUsedPct: 41 + idx * 7,
      cpuPct: 6 + idx * 3,
      backupWindow: id === 'srv-backup' ? { startHour: 1, endHour: 5 } : null,
    };
    connect(net, [id, 'eth0'], ['core-sw1', `GigabitEthernet1/0/${p}`], 'copper', 'server');
  });
  const dc = net.devices['srv-dc01'];
  dc.server!.dnsForwarders = ['8.8.8.8', '1.1.1.1'];
  dc.server!.dnsZone = [
    { name: 'dc01.corp.local', type: 'A', value: '10.10.100.10' },
    { name: 'ns1.corp.local', type: 'CNAME', value: 'dc01.corp.local' },
    { name: 'files.corp.local', type: 'A', value: '10.10.100.20' },
    { name: 'git.corp.local', type: 'A', value: '10.10.100.30' },
    { name: 'ci.corp.local', type: 'CNAME', value: 'git.corp.local' },
    { name: 'app.corp.local', type: 'A', value: '10.10.100.40' },
    { name: 'erp.corp.local', type: 'CNAME', value: 'app.corp.local' },
    { name: 'staging.corp.local', type: 'CNAME', value: 'app.corp.local' },
    { name: 'wiki.corp.local', type: 'CNAME', value: 'app.corp.local' },
    { name: 'backup.corp.local', type: 'A', value: '10.10.100.50' },
    { name: 'prn-eng.corp.local', type: 'A', value: '10.10.10.5' },
    { name: 'prn-dsgn.corp.local', type: 'A', value: '10.10.20.5' },
    { name: 'prn-fin.corp.local', type: 'A', value: '10.10.40.5' },
    { name: 'core-sw1.corp.local', type: 'A', value: '10.10.99.1' },
    { name: 'sw-eng.corp.local', type: 'A', value: '10.10.99.11' },
    { name: 'sw-dqa.corp.local', type: 'A', value: '10.10.99.12' },
    { name: 'sw-office.corp.local', type: 'A', value: '10.10.99.13' },
    { name: 'noc.corp.local', type: 'A', value: '10.10.99.50' },
  ];

  // --- Employee PCs and laptops ----------------------------------------------
  const zoneSwitch: Record<string, Device> = { 'sw-eng': swEng, 'sw-dqa': swDqa, 'sw-office': swOff };
  const deptVlan: Record<string, number> = { Engineering: 10, Design: 20, QA: 30, Finance: 40, Office: 50, Management: 50 };
  for (const desk of DESKS) {
    const sw = zoneSwitch[desk.switchId];
    const emp = ROSTER.find((r) => r.desk === desk.id);
    const vlan = emp ? deptVlan[emp.dept] : desk.zone === 'eng' ? 10 : desk.zone === 'design' ? 20 : desk.zone === 'qa' ? 30 : desk.zone === 'finance' ? 40 : 50;
    const swPort = port(sw, `GigabitEthernet1/0/${desk.switchPort}`);
    swPort.wallPort = desk.port;
    if (!emp) {
      // spare desk: port left shut down in quarantine VLAN until provisioned
      swPort.description = `${desk.port} (spare desk)`;
      continue;
    }
    setAccess(sw, desk.switchPort, vlan, `${desk.port} ${emp.name}`);
    if (emp.device === 'laptop') {
      swPort.description = `${desk.port} ${emp.name} (dock - unused)`;
      const id = `lt-${desk.id.toLowerCase()}`;
      const d = hostDevice(net, id, `${desk.id.split('-')[0]}-LT${desk.id.split('-')[1]}`, 'laptop', 'ThinkPad X1 Carbon', desk.zone, { ...desk.pcPos }, 'lenovo', true);
      d.ownerId = emp.id;
      d.pc = { os: 'windows', compromised: false, malware: null, edrIsolated: false, reimageUntil: 0, scanUntil: 0, procs: pcProcs(emp.dept), printerQueue: null, wifiProfile: 'CorpNet' };
      continue;
    }
    const id = `pc-${desk.id.toLowerCase()}`;
    const d = hostDevice(net, id, `${desk.id.split('-')[0]}-PC${desk.id.split('-')[1]}`, 'pc', emp.dept === 'Design' ? 'Precision 3660 Workstation' : 'OptiPlex 7010', desk.zone, { ...desk.pcPos }, 'dell');
    d.ownerId = emp.id;
    d.pc = { os: 'windows', compromised: false, malware: null, edrIsolated: false, reimageUntil: 0, scanUntil: 0, procs: pcProcs(emp.dept), printerQueue: null, wifiProfile: 'CorpNet' };
    connect(net, [id, 'Ethernet'], [sw.id, `GigabitEthernet1/0/${desk.switchPort}`], 'copper', 'access');
  }
  // finance ports have port-security (sticky) — populated with the PC MACs
  for (let p = 1; p <= 4; p++) {
    const i = port(swOff, `GigabitEthernet1/0/${p}`);
    const link = Object.values(net.links).find((l) => l.b.dev === 'sw-office' && l.b.iface === i.name);
    const pc = link ? net.devices[link.a.dev] : undefined;
    i.portSecurity = { enabled: true, maximum: 1, violation: 'shutdown', sticky: true, secureMacs: pc ? [pc.ifaces[0].mac] : [], violations: 0 };
  }

  // --- Printers ---------------------------------------------------------------
  const printers: [string, string, string, string, Device, number, keyof typeof OUI, string][] = [
    ['prn-eng', 'PRN-ENG', 'HP LaserJet M507', '10.10.10.5', swEng, 13, 'hp', 'eng'],
    ['prn-dsgn', 'PRN-DSGN', 'Canon imagePROGRAF TM-300', '10.10.20.5', swDqa, 13, 'canon', 'design'],
    ['prn-fin', 'PRN-FIN', 'HP Color LaserJet M554', '10.10.40.5', swOff, 7, 'hp', 'finance'],
  ];
  for (const [id, name, model, ip, sw, p, vendor, zone] of printers) {
    const d = hostDevice(net, id, name, 'printer', model, zone as ZoneId, posOf(id), vendor);
    const gw = ip.split('.').slice(0, 3).join('.') + '.1';
    setStatic(d, ip, MASK24, gw, [DNS_SERVER]);
    d.printer = { status: 'ready', jobs: 0, pagesToday: 0 };
    const vlan = Number(ip.split('.')[2]);
    setAccess(sw, p, vlan, `${name} printer`);
    connect(net, [id, 'Ethernet'], [sw.id, `GigabitEthernet1/0/${p}`], 'copper', 'access');
  }

  // --- Access points ----------------------------------------------------------
  const aps: [string, string, Device, number, string, number][] = [
    // channels chosen so no two APs within interference range share a channel
    ['ap-eng', 'AP-ENG', swEng, 14, '10.10.70.2', 1],
    ['ap-dsgn', 'AP-DSGN', swDqa, 14, '10.10.70.3', 11],
    ['ap-qa', 'AP-QA', swDqa, 16, '10.10.70.4', 11],
    ['ap-mtg', 'AP-MTG', swOff, 11, '10.10.70.5', 6],
    ['ap-lobby', 'AP-LOBBY', swOff, 12, '10.10.70.6', 1],
  ];
  for (const [id, name, sw, p, ip, ch] of aps) {
    const d = makeDevice(id, name, 'ap', 'Catalyst 9120AXI', sw.zone, posOf(id));
    d.serial = serial(net, 'FJC');
    d.host = emptyHost();
    d.ifaces.push(makeIface(id, 'GigabitEthernet0', nextMac(net, 'ciscoAp'), {}));
    setStatic(d, ip, MASK24, '10.10.70.1', [DNS_SERVER]);
    d.ap = { ssid: 'CorpNet', channel: ch, txPower: 'high', radioOn: true, rangePx: 14 * T, drawW: 25.5, injectorPowered: false };
    d.poeW = 25.5;
    addDevice(net, d);
    setAccess(sw, p, 70, `${name} access point`);
    port(sw, `GigabitEthernet1/0/${p}`).portfast = true;
    connect(net, [id, 'GigabitEthernet0'], [sw.id, `GigabitEthernet1/0/${p}`], 'copper', 'access');
  }

  // --- IoT on SW-OFFICE -------------------------------------------------------
  const cam = hostDevice(net, 'cam-lobby', 'CAM-LOBBY', 'iot', 'Axis P3265 dome camera', 'reception', posOf('cam-lobby'), 'axis');
  cam.poeW = 6.5;
  setAccess(swOff, 8, 50, 'CAM-LOBBY camera');
  connect(net, ['cam-lobby', 'Ethernet'], ['sw-office', 'GigabitEthernet1/0/8'], 'copper', 'access');
  const vc = hostDevice(net, 'vc-atlas', 'VC-ATLAS', 'iot', 'Poly Studio X50 video bar', 'atlas', posOf('vc-atlas'), 'poly');
  vc.poeW = 25;
  setAccess(swOff, 9, 50, 'VC-ATLAS video bar');
  connect(net, ['vc-atlas', 'Ethernet'], ['sw-office', 'GigabitEthernet1/0/9'], 'copper', 'access');

  // --- Spare wall ports in meeting rooms (active, OFFICE VLAN) ----------------
  for (const w of SPARE_WALL_PORTS) {
    const sw = zoneSwitch[w.switchId];
    const i = port(sw, `GigabitEthernet1/0/${w.switchPort}`);
    i.wallPort = w.label;
    if (w.zone === 'atlas' || w.zone === 'borealis') setAccess(sw, w.switchPort, 50, `${w.label} meeting room wall port`);
    else i.description = `${w.label} wall port (unused)`;
  }

  // --- NOC workstation --------------------------------------------------------
  const noc = hostDevice(net, 'noc-pc', 'NOC-PC', 'pc', 'Precision 3660 (NOC)', 'noc', posOf('noc-pc'), 'dell');
  setStatic(noc, '10.10.99.50', MASK24, '10.10.99.1', [DNS_SERVER]);
  noc.pc = { os: 'windows', compromised: false, malware: null, edrIsolated: false, reimageUntil: 0, scanUntil: 0, procs: pcProcs('Engineering'), printerQueue: null, wifiProfile: 'CorpNet' };
  noc.notes = 'Your workstation. Use it to test reachability from the management VLAN.';
  connect(net, ['noc-pc', 'Ethernet'], ['core-sw1', 'GigabitEthernet1/0/10'], 'copper', 'access');

  // snapshot startup configs
  for (const d of Object.values(net.devices)) if (d.ios) d.ios.startup = snapshotConfig(d);
  return net;
}

export function deskPortIface(desk: { switchId: string; switchPort: number }): string {
  return `GigabitEthernet1/0/${desk.switchPort}`;
}

export { OUI };
