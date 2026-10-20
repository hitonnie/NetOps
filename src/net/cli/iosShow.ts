/** IOS "show" command output generators. */
import { hash } from '../../core/rng';
import { fmtSyslog, fmtClock, dayIndex, pad2 } from '../../core/time';
import { ROSTER, SERVICES_BY_DEPT } from '../../world/roster';
import { aceToStr, renderIfaceConfig, renderRunningConfig } from '../config';
import type { NetEngine } from '../engine';
import { cmpIp, inNetwork, maskToPrefix, networkOf } from '../ip';
import { type Device, type Iface, ciscoMac, formatVlanList, parseVlanList, shortIf } from '../model';
import { vendorOf } from '../topology';
import { pad, padL } from './shell';

const UPTIME_BASE = 23 * 1440 + 4 * 60 + 12;

function uptime(e: NetEngine, d: Device): string {
  const m = d.bootUntil > 0 ? Math.max(0, e.now - d.bootUntil) : UPTIME_BASE + e.now;
  const w = Math.floor(m / (7 * 1440));
  const days = Math.floor((m % (7 * 1440)) / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = Math.floor(m % 60);
  const parts: string[] = [];
  if (w) parts.push(`${w} week${w > 1 ? 's' : ''}`);
  if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
  parts.push(`${mm} minute${mm !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

export function showVersion(e: NetEngine, d: Device): string[] {
  const isFw = d.kind === 'firewall';
  return [
    'Cisco IOS XE Software, Version 17.09.04a',
    `Cisco IOS Software [Cupertino], ${isFw ? 'ISR Software (X86_64_LINUX_IOSD-UNIVERSALK9-M)' : 'Catalyst L3 Switch Software (CAT9K_IOSXE)'}, Version 17.9.4a, RELEASE SOFTWARE (fc3)`,
    'Technical Support: http://www.cisco.com/techsupport',
    'Copyright (c) 1986-2023 by Cisco Systems, Inc.',
    '',
    'ROM: IOS-XE ROMMON',
    `${d.name} uptime is ${uptime(e, d)}`,
    'Uptime for this control processor is ' + uptime(e, d),
    'System returned to ROM by Reload Command',
    'System image file is "flash:packages.conf"',
    '',
    `cisco ${d.model} processor with 1392536K/6147K bytes of memory.`,
    `${d.ifaces.filter((i) => i.type !== 'svi').length} Gigabit Ethernet interfaces`,
    '',
    `Model Number                       : ${d.model.split(' ')[0]}`,
    `System Serial Number               : ${d.serial}`,
    '',
    'Configuration register is 0x102',
  ];
}

export function showClock(e: NetEngine): string[] {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dd = dayIndex(e.now);
  const ms = String(Math.floor((e.now * 60000) % 1000)).padStart(3, '0');
  return [`*${fmtClock(e.now, true)}.${ms} UTC ${days[dd % 7]} Oct ${pad2(12 + dd)} 2026`];
}

function ipMethod(d: Device, i: Iface): string {
  if (!i.ip) return 'unset';
  return d.ios && d.ios.startup && d.ios.startup.includes(`"ip":"${i.ip}"`) ? 'NVRAM' : 'manual';
}

export function showIpIntBrief(e: NetEngine, d: Device): string[] {
  const out = [`${pad('Interface', 23)}${pad('IP-Address', 16)}OK? Method Status                Protocol`];
  for (const i of d.ifaces) {
    const o = e.oper(i);
    const status = o.ipStatus === 'administratively down' ? 'administratively down' : o.ipStatus;
    out.push(`${pad(i.name, 23)}${pad(i.ip ?? 'unassigned', 16)}YES ${pad(ipMethod(d, i), 7)}${pad(status, 22)}${o.proto}`);
  }
  return out;
}

function ifStatusLine(e: NetEngine, i: Iface): string {
  const o = e.oper(i);
  if (o.ipStatus === 'administratively down') return `${i.name} is administratively down, line protocol is down (disabled)`;
  if (o.status === 'err-disabled') return `${i.name} is down, line protocol is down (err-disabled)`;
  if (o.up) return `${i.name} is up, line protocol is up${i.type === 'svi' ? '' : ' (connected)'}`;
  if (i.type === 'svi') return `${i.name} is up, line protocol is down`;
  return `${i.name} is down, line protocol is down (notconnect)`;
}

export function showInterface(e: NetEngine, d: Device, i: Iface): string[] {
  const o = e.oper(i);
  const c = i.counters;
  const bw = i.type === 'svi' ? 1000000 : (o.speedMbps || i.maxMbps) * 1000;
  const util = o.linkId ? e.utilization(o.linkId) : 0;
  const load = Math.max(1, Math.min(255, Math.round(util * 255)));
  const rel = c.crc > 0 && o.up ? Math.max(180, 255 - Math.min(75, Math.round(c.crc / 200))) : 255;
  const out = [
    ifStatusLine(e, i),
    `  Hardware is ${i.type === 'svi' ? 'Ethernet SVI' : i.type === 'sfp' ? 'Gigabit Ethernet' : 'Gigabit Ethernet'}, address is ${ciscoMac(i.mac)} (bia ${ciscoMac(i.mac)})`,
  ];
  if (i.description) out.push(`  Description: ${i.description}`);
  if (i.ip && i.mask) out.push(`  Internet address is ${i.ip}/${maskToPrefix(i.mask)}`);
  out.push(
    `  MTU 1500 bytes, BW ${bw} Kbit/sec, DLY 10 usec,`,
    `     reliability ${rel}/255, txload ${load}/255, rxload ${Math.max(1, Math.round(load * 0.6))}/255`,
    '  Encapsulation ARPA, loopback not set',
    '  Keepalive set (10 sec)',
  );
  if (i.type !== 'svi') {
    if (o.up) {
      const dup = o.duplex === 'full' ? 'Full-duplex' : 'Half-duplex';
      out.push(`  ${dup}, ${o.speedMbps >= 1000 ? `${o.speedMbps / 1000}000Mb/s` : `${o.speedMbps}Mb/s`}, media type is ${i.type === 'sfp' ? '1000BaseSX SFP' : '10/100/1000BaseTX'}`);
    } else {
      out.push(`  ${i.duplex === 'auto' ? 'Auto-duplex' : i.duplex === 'full' ? 'Full-duplex' : 'Half-duplex'}, ${i.speed === 'auto' ? 'Auto-speed' : `${i.speed}Mb/s`}, media type is ${i.type === 'sfp' ? '1000BaseSX SFP' : '10/100/1000BaseTX'}`);
    }
    out.push('  input flow-control is off, output flow-control is unsupported');
  }
  const pps = (bits: number) => Math.round(bits / 8 / 800);
  out.push(
    '  ARP type: ARPA, ARP Timeout 04:00:00',
    `  Last input ${o.up ? '00:00:00' : 'never'}, output ${o.up ? '00:00:01' : 'never'}, output hang never`,
    '  Last clearing of "show interface" counters never',
    `  Input queue: 0/2000/0/0 (size/max/drops/flushes); Total output drops: ${util > 1 ? Math.round(c.outPkts * 0.04) : 0}`,
    '  Queueing strategy: fifo',
    `  Output queue: ${util > 1 ? 40 : 0}/40 (size/max)`,
    `  5 minute input rate ${c.inRate} bits/sec, ${pps(c.inRate)} packets/sec`,
    `  5 minute output rate ${c.outRate} bits/sec, ${pps(c.outRate)} packets/sec`,
    `     ${c.inPkts} packets input, ${c.inBytes} bytes, 0 no buffer`,
    `     Received ${c.broadcasts} broadcasts (${Math.round(c.broadcasts / 3)} multicasts)`,
    '     0 runts, 0 giants, 0 throttles',
    `     ${c.inErrors} input errors, ${c.crc} CRC, 0 frame, 0 overrun, 0 ignored`,
    '     0 watchdog, 0 multicast, 0 pause input',
    '     0 input packets with dribble condition detected',
    `     ${c.outPkts} packets output, ${c.outBytes} bytes, 0 underruns`,
    `     0 output errors, ${c.collisions} collisions, ${o.up ? 1 : 3} interface resets`,
    '     0 unknown protocol drops',
    `     0 babbles, ${c.lateCollisions} late collision, 0 deferred`,
    '     0 lost carrier, 0 no carrier, 0 pause output',
    '     0 output buffer failures, 0 output buffers swapped out',
  );
  return out;
}

function speedStr(e: NetEngine, i: Iface): { duplex: string; speed: string } {
  const o = e.oper(i);
  if (!o.up) return { duplex: i.duplex === 'auto' ? 'auto' : i.duplex, speed: i.speed === 'auto' ? 'auto' : i.speed };
  const duplex = i.duplex === 'auto' ? `a-${o.duplex}` : o.duplex;
  const speed = i.speed === 'auto' ? `a-${o.speedMbps}` : String(o.speedMbps);
  return { duplex, speed };
}

export function showIntStatus(e: NetEngine, d: Device): string[] {
  const out = [`${pad('Port', 10)}${pad('Name', 19)}${pad('Status', 13)}${pad('Vlan', 11)}${pad('Duplex', 7)}${padL('Speed', 6)} Type`];
  for (const i of d.ifaces) {
    if (i.type === 'svi') continue;
    const o = e.oper(i);
    const vlan = !i.switchport ? 'routed' : i.mode === 'trunk' ? 'trunk' : String(i.accessVlan);
    const { duplex, speed } = speedStr(e, i);
    out.push(`${pad(shortIf(i.name), 10)}${pad(i.description.slice(0, 18), 19)}${pad(o.status, 13)}${pad(vlan, 11)}${padL(duplex, 6)} ${padL(speed, 6)} ${i.type === 'sfp' ? '1000BaseSX SFP' : '10/100/1000BaseTX'}`);
  }
  return out;
}

export function showIntDescription(e: NetEngine, d: Device): string[] {
  const out = [`${pad('Interface', 31)}${pad('Status', 15)}${pad('Protocol', 9)}Description`];
  for (const i of d.ifaces) {
    const o = e.oper(i);
    out.push(`${pad(shortIf(i.name), 31)}${pad(o.ipStatus === 'administratively down' ? 'admin down' : o.ipStatus, 15)}${pad(o.proto, 9)}${i.description}`);
  }
  return out;
}

export function showIntTrunk(e: NetEngine, d: Device): string[] {
  const trunks = d.ifaces.filter((i) => i.switchport && i.mode === 'trunk' && e.oper(i).up);
  if (!trunks.length) return [''];
  const vlans = Object.keys(d.ios!.vlans).map(Number);
  const out = ['', `${pad('Port', 12)}${pad('Mode', 17)}${pad('Encapsulation', 15)}${pad('Status', 14)}Native vlan`];
  for (const i of trunks) out.push(`${pad(shortIf(i.name), 12)}${pad('on', 17)}${pad('802.1q', 15)}${pad('trunking', 14)}${i.nativeVlan}`);
  out.push('', `${pad('Port', 12)}Vlans allowed on trunk`);
  for (const i of trunks) {
    const l = parseVlanList(i.allowedVlans);
    out.push(`${pad(shortIf(i.name), 12)}${l === 'all' ? '1-4094' : l ? formatVlanList(l) : i.allowedVlans}`);
  }
  out.push('', `${pad('Port', 12)}Vlans allowed and active in management domain`);
  const active = (i: Iface) => vlans.filter((v) => {
    const l = parseVlanList(i.allowedVlans);
    return l === 'all' || (l && l.includes(v));
  });
  for (const i of trunks) out.push(`${pad(shortIf(i.name), 12)}${formatVlanList(active(i)) || 'none'}`);
  out.push('', `${pad('Port', 12)}Vlans in spanning tree forwarding state and not pruned`);
  for (const i of trunks) {
    const blocked = e.c.stpBlocked.has(i.id);
    out.push(`${pad(shortIf(i.name), 12)}${blocked ? 'none' : formatVlanList(active(i)) || 'none'}`);
  }
  return out;
}

export function showIntSwitchport(e: NetEngine, d: Device, i: Iface): string[] {
  if (!i.switchport || i.type === 'svi') return [`Name: ${shortIf(i.name)}`, 'Switchport: Disabled'];
  const vn = (v: number) => `${v} (${d.ios!.vlans[String(v)] ?? 'Inactive'})`;
  const l = parseVlanList(i.allowedVlans);
  return [
    `Name: ${shortIf(i.name)}`,
    'Switchport: Enabled',
    `Administrative Mode: ${i.mode === 'trunk' ? 'trunk' : 'static access'}`,
    `Operational Mode: ${e.oper(i).up ? (i.mode === 'trunk' ? 'trunk' : 'static access') : 'down'}`,
    'Administrative Trunking Encapsulation: dot1q',
    `Operational Trunking Encapsulation: ${i.mode === 'trunk' ? 'dot1q' : 'native'}`,
    'Negotiation of Trunking: Off',
    `Access Mode VLAN: ${vn(i.accessVlan)}`,
    `Trunking Native Mode VLAN: ${vn(i.nativeVlan)}`,
    'Administrative Native VLAN tagging: enabled',
    'Voice VLAN: none',
    `Trunking VLANs Enabled: ${l === 'all' ? 'ALL' : l ? formatVlanList(l) : i.allowedVlans}`,
    'Pruning VLANs Enabled: 2-1001',
    'Protected: false',
    'Unknown unicast blocked: disabled',
    'Unknown multicast blocked: disabled',
  ];
}

export function showVlanBrief(e: NetEngine, d: Device, full = false): string[] {
  const ios = d.ios!;
  const out = [`${pad('VLAN', 5)}${pad('Name', 33)}${pad('Status', 10)}Ports`, `${'-'.repeat(4)} ${'-'.repeat(32)} ${'-'.repeat(9)} ${'-'.repeat(31)}`];
  const ids = Object.keys(ios.vlans)
    .map(Number)
    .sort((a, b) => a - b);
  for (const v of ids) {
    const ports = d.ifaces.filter((i) => i.switchport && i.type !== 'svi' && i.mode === 'access' && i.accessVlan === v).map((i) => shortIf(i.name));
    const chunks: string[] = [];
    for (let k = 0; k < ports.length; k += 4) chunks.push(ports.slice(k, k + 4).join(', '));
    out.push(`${pad(v, 5)}${pad(ios.vlans[String(v)], 33)}${pad('active', 10)}${chunks[0] ?? ''}`);
    for (const ch of chunks.slice(1)) out.push(`${' '.repeat(48)}${ch}`);
  }
  // access ports assigned to VLANs that don't exist
  const missing = new Set(d.ifaces.filter((i) => i.switchport && i.type !== 'svi' && i.mode === 'access' && !ios.vlans[String(i.accessVlan)]).map((i) => i.accessVlan));
  void missing;
  for (const [id, n] of [
    [1002, 'fddi-default'],
    [1003, 'token-ring-default'],
    [1004, 'fddinet-default'],
    [1005, 'trnet-default'],
  ] as [number, string][])
    out.push(`${pad(id, 5)}${pad(n, 33)}act/unsup `);
  if (full) out.push('', 'VLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2', ...ids.map((v) => `${pad(v, 5)}enet  ${pad(100000 + v, 11)}1500  -      -      -        -    -        0      0`));
  return out;
}

export function showMacTable(e: NetEngine, d: Device, filter: { iface?: string; vlan?: number; mac?: string; dynamicOnly?: boolean }): string[] {
  let entries = e.c.macTables.get(d.id) ?? [];
  if (filter.iface) entries = entries.filter((m) => m.port === filter.iface);
  if (filter.vlan !== undefined) entries = entries.filter((m) => m.vlan === filter.vlan);
  if (filter.mac) {
    const want = filter.mac.replace(/[.:-]/g, '').toLowerCase();
    entries = entries.filter((m) => m.mac.replace(/[.:-]/g, '').toLowerCase() === want);
  }
  if (filter.dynamicOnly) entries = entries.filter((m) => m.type === 'DYNAMIC');
  const out = ['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----'];
  if (!filter.iface && !filter.mac && !filter.dynamicOnly) {
    out.push(` All    ${ciscoMac(d.ifaces[0].mac.slice(0, 15) + '00')}    STATIC      CPU`);
  }
  for (const m of entries) out.push(`${padL(m.vlan, 4)}    ${pad(ciscoMac(m.mac), 18)}${pad(m.type, 12)}${shortIf(m.port)}`);
  out.push(`Total Mac Addresses for this criterion: ${entries.length}`);
  return out;
}

function classful(net: string): { net: string; prefix: number } {
  const first = Number(net.split('.')[0]);
  if (first < 128) return { net: `${first}.0.0.0`, prefix: 8 };
  if (first < 192) return { net: net.split('.').slice(0, 2).join('.') + '.0.0', prefix: 16 };
  return { net: net.split('.').slice(0, 3).join('.') + '.0', prefix: 24 };
}

export function showIpRoute(e: NetEngine, d: Device, staticOnly = false): string[] {
  if (d.kind === 'switch' || (d.kind === 'l3switch' && !d.ios?.ipRouting)) {
    return [`Default gateway is ${d.ios?.defaultGateway ?? 'not set'}`, '', 'Host               Gateway           Last Use    Total Uses  Interface', 'ICMP redirect cache is empty'];
  }
  const routes = e.routeTable(d).filter((r) => !staticOnly || r.code.startsWith('S'));
  const def = routes.find((r) => r.code === 'S*');
  const out = [
    'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
    '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area ',
    '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
    '       E1 - OSPF external type 1, E2 - OSPF external type 2',
    '       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2',
    '       * - candidate default, U - per-user static route, o - ODR',
    '',
    def ? `Gateway of last resort is ${def.nextHop ?? def.iface} to network 0.0.0.0` : 'Gateway of last resort is not set',
    '',
  ];
  if (def) out.push(`S*    0.0.0.0/0 [${def.ad}/0] via ${def.nextHop ?? def.iface}`);
  const rest = routes.filter((r) => r !== def).sort((a, b) => cmpIp(a.net, b.net) || maskToPrefix(a.mask) - maskToPrefix(b.mask));
  const groups = new Map<string, typeof rest>();
  for (const r of rest) {
    const cf = classful(r.net);
    const k = `${cf.net}/${cf.prefix}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  for (const [k, rs] of groups) {
    const masks = new Set(rs.map((r) => r.mask));
    out.push(`      ${k} is ${masks.size > 1 ? 'variably subnetted' : 'subnetted'}, ${rs.length} subnets${masks.size > 1 ? `, ${masks.size} masks` : ''}`);
    for (const r of rs) {
      const target = `${r.net}/${maskToPrefix(r.mask)}`;
      if (r.code === 'C' || r.code === 'L') out.push(`${pad(r.code, 9)}${target} is directly connected, ${r.iface}`);
      else out.push(`${pad(r.code, 9)}${target} [${r.ad}/0] via ${r.nextHop ?? r.iface}`);
    }
  }
  return out;
}

export function showArp(e: NetEngine, d: Device, ipFilter?: string): string[] {
  const out = ['Protocol  Address          Age (min)  Hardware Addr   Type   Interface'];
  for (const a of e.arpTable(d)) {
    if (ipFilter && a.ip !== ipFilter) continue;
    out.push(`Internet  ${pad(a.ip, 17)}${padL(a.age < 0 ? '-' : a.age, 9)}   ${pad(ciscoMac(a.mac), 16)}ARPA   ${a.iface}`);
  }
  return out;
}

const PLATFORM: Record<string, string> = { switch: 'S I', l3switch: 'R S I', firewall: 'R I', ap: 'T B I' };

export function showCdp(e: NetEngine, d: Device, detail: boolean): string[] {
  const n = e.cdpNeighbors(d);
  if (detail) {
    const out: string[] = [];
    for (const x of n) {
      const ip = e.primaryIf(x.dev)?.ip;
      out.push(
        '-------------------------',
        `Device ID: ${x.dev.name}.corp.local`,
        'Entry address(es): ',
        `  IP address: ${ip ?? 'none'}`,
        `Platform: cisco ${x.dev.model.split(' ')[0]},  Capabilities: ${x.dev.kind === 'l3switch' ? 'Router Switch IGMP' : x.dev.kind === 'switch' ? 'Switch IGMP' : x.dev.kind === 'ap' ? 'Trans-Bridge' : 'Router'} `,
        `Interface: ${x.localIf},  Port ID (outgoing port): ${x.remoteIf}`,
        `Holdtime : ${x.hold} sec`,
        '',
        'Version :',
        'Cisco IOS Software, Version 17.9.4a',
        '',
        `Native VLAN: ${x.dev.ifaces.find((i) => i.name === x.remoteIf)?.nativeVlan ?? 1}`,
        'Duplex: full',
        '',
      );
    }
    out.push(`Total cdp entries displayed : ${n.length}`);
    return out;
  }
  const out = [
    'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge',
    '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone, ',
    '                  D - Remote, C - CVTA, M - Two-port Mac Relay ',
    '',
    'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID',
  ];
  const gi = (s: string) => shortIf(s).replace(/^Gi/, 'Gig ').replace(/^Te/, 'Ten ');
  for (const x of n) {
    const id = `${x.dev.name}.corp.local`;
    if (id.length > 16) out.push(id);
    out.push(`${pad(id.length > 16 ? '' : id, 17)}${pad(gi(x.localIf), 18)}${pad(x.hold, 11)}${pad(PLATFORM[x.dev.kind] ?? 'H', 12)}${pad(x.dev.model.split(' ')[0].slice(0, 9), 10)}${gi(x.remoteIf)}`);
  }
  out.push('', `Total cdp entries displayed : ${n.length}`);
  return out;
}

function fmtLease(t: number): string {
  if (t > 1e8) return 'Infinite';
  const dd = dayIndex(t);
  const m = ((t % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `Oct ${pad2(12 + dd)} 2026 ${pad2(h12)}:${pad2(m % 60)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function showDhcpBinding(e: NetEngine, d: Device): string[] {
  const ios = d.ios!;
  const out = [
    'Bindings from all pools not associated with VRF:',
    'IP address      Client-ID/              Lease expiration        Type       State      Interface',
    '                Hardware address/',
    '                User name',
  ];
  const binds = ios.dhcpBindings.filter((b) => b.expires > e.now).sort((a, b) => cmpIp(a.ip, b.ip));
  for (const b of binds) {
    const svi = d.ifaces.find((i) => i.ip && i.mask && inNetwork(b.ip, networkOf(i.ip, i.mask), i.mask));
    out.push(`${pad(b.ip, 16)}${pad('01' + ciscoMac(b.mac).replace(/\./g, '').replace(/(.{4})/g, '$1.').replace(/\.$/, ''), 24)}${pad(fmtLease(b.expires), 24)}${pad('Automatic', 11)}${pad('Active', 11)}${svi?.name ?? 'Unknown'}`);
  }
  return out;
}

export function showDhcpPool(e: NetEngine, d: Device): string[] {
  const out: string[] = [];
  for (const p of d.ios!.dhcpPools) {
    const st = e.poolStats(d, p);
    const binds = d.ios!.dhcpBindings.filter((b) => b.pool === p.name && b.expires > e.now);
    const last = binds.map((b) => b.ip).sort(cmpIp).pop();
    out.push(
      '',
      `Pool ${p.name} :`,
      ' Utilization mark (high/low)    : 100 / 0',
      ' Subnet size (first/next)       : 0 / 0 ',
      ` Total addresses                : ${st.total}`,
      ` Leased addresses               : ${st.leased}`,
      ` Excluded addresses             : ${st.excluded}`,
      ' Pending event                  : none',
    );
    if (p.network && p.mask) {
      const base = p.network.split('.').slice(0, 3).join('.');
      out.push(
        ' 1 subnet is currently in the pool :',
        ' Current index        IP address range                    Leased/Excluded/Total',
        ` ${pad(last ?? `${base}.1`, 21)}${pad(`${base}.1`, 17)}- ${pad(`${base}.254`, 18)}${pad(st.leased, 6)}/ ${pad(st.excluded, 6)}/ ${st.total}`,
      );
    } else out.push(' 0 subnets are currently in the pool (no "network" statement)');
  }
  return out;
}

export function showDhcpConflict(e: NetEngine, d: Device): string[] {
  const out = ['IP address        Detection method   Detection time          VRF'];
  for (const c of d.ios!.dhcpConflicts) out.push(`${pad(c.ip, 18)}${pad('Ping', 19)}${pad(fmtLease(c.detected), 24)}`);
  return out;
}

export function showAcls(e: NetEngine, d: Device, name?: string): string[] {
  const out: string[] = [];
  for (const a of d.ios!.acls) {
    if (name && a.name.toLowerCase() !== name.toLowerCase()) continue;
    out.push(`${a.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${a.name}`);
    for (const en of [...a.entries].sort((x, y) => x.seq - y.seq)) out.push(`    ${aceToStr(en, a.type)}${en.hits ? ` (${en.hits} match${en.hits > 1 ? 'es' : ''})` : ''}`);
  }
  if (name && !out.length) return [];
  return out;
}

export function showNat(e: NetEngine, d: Device): string[] {
  if (!d.ios?.natRules.length) return [];
  const out = ['Pro Inside global         Inside local          Outside local         Outside global'];
  const rows: string[] = [];
  const outsideIp = d.ifaces.find((i) => i.nat === 'outside')?.ip ?? '0.0.0.0';
  let port = 50000 + (Math.floor(e.now) % 900);
  for (const r of ROSTER) {
    const dev = Object.values(e.net.devices).find((x) => x.ownerId === r.id);
    if (!dev || !e.isUp(dev.id)) continue;
    const ip = e.primaryIf(dev)?.ip;
    if (!ip || ip.startsWith('169.')) continue;
    for (const s of SERVICES_BY_DEPT[r.dept]) {
      if (s.host.endsWith('.corp.local')) continue;
      if (hash(r.id + s.id + Math.floor(e.now / 5)) % 3 === 0) continue;
      const res = e.resolve(dev.id, s.host);
      if (!res.ok || !res.ip) continue;
      const rt = e.roundTrip(dev.id, res.ip, 'tcp', s.port, false);
      if (!rt.ok || rt.fwd.natBy !== d.id) continue;
      port += 7;
      rows.push(`tcp ${pad(`${outsideIp}:${port}`, 22)}${pad(`${ip}:${port}`, 22)}${pad(`${res.ip}:${s.port}`, 22)}${res.ip}:${s.port}`);
    }
  }
  for (const f of e.net.flows) {
    if (f.src === 'internet') continue;
    const src = e.net.devices[f.src];
    const ip = src && e.primaryIf(src)?.ip;
    if (!ip || f.blockedAt) continue;
    const rt = e.forward(f.src, f.dstIp, f.proto, f.port, { checkAcl: true, flowKey: f.id, count: false });
    if (!rt.ok || rt.natBy !== d.id) continue;
    for (let k = 0; k < (f.kind === 'c2' ? 1 : 3); k++) {
      port += 3;
      rows.push(`${f.proto} ${pad(`${outsideIp}:${port}`, 22)}${pad(`${ip}:${port}`, 22)}${pad(`${f.dstIp}:${f.port}`, 22)}${f.dstIp}:${f.port}`);
    }
  }
  return [...out, ...rows];
}

export function showPowerInline(e: NetEngine, d: Device, only?: Iface): string[] {
  const p = e.c.poe.get(d.id);
  if (!p) return ['% Power over Ethernet is not supported on this platform'];
  const out = [
    'Module   Available     Used     Remaining',
    '          (Watts)     (Watts)    (Watts) ',
    '------   ---------   --------   ---------',
    `1        ${padL(p.budget.toFixed(1), 9)}   ${padL(p.used.toFixed(1), 8)}   ${padL((p.budget - p.used).toFixed(1), 9)}`,
    'Interface Admin  Oper       Power   Device              Class Max',
    '                            (Watts)                            ',
    '--------- ------ ---------- ------- ------------------- ----- ----',
  ];
  for (const i of d.ifaces) {
    if (!i.poe || (only && i !== only)) continue;
    const o = e.oper(i);
    const peer = o.peer ? e.net.devices[o.peer.dev] : null;
    const devName = o.poeStatus === 'on' && peer ? peer.model.slice(0, 19) : 'n/a';
    const cls = o.poeStatus === 'on' && peer ? (peer.poeW > 15.4 ? '4' : '2') : 'n/a';
    out.push(`${pad(shortIf(i.name), 10)}${pad(i.poe, 7)}${pad(o.poeStatus === 'denied' ? 'faulty' : o.poeStatus, 11)}${padL(o.poeW.toFixed(1), 7)} ${pad(devName, 20)}${pad(cls, 6)}30.0`);
  }
  return out;
}

export function showPortSecurity(e: NetEngine, d: Device, i?: Iface): string[] {
  if (i) {
    const ps = i.portSecurity;
    if (!ps?.enabled) return ['Port Security              : Disabled'];
    const lastMac = ps.secureMacs[ps.secureMacs.length - 1];
    return [
      'Port Security              : Enabled',
      `Port Status                : ${i.errDisabled ? 'Secure-shutdown' : e.oper(i).up ? 'Secure-up' : 'Secure-down'}`,
      `Violation Mode             : ${ps.violation[0].toUpperCase()}${ps.violation.slice(1)}`,
      'Aging Time                 : 0 mins',
      'Aging Type                 : Absolute',
      'SecureStatic Address Aging : Disabled',
      `Maximum MAC Addresses      : ${ps.maximum}`,
      `Total MAC Addresses        : ${ps.secureMacs.length}`,
      `Configured MAC Addresses   : ${ps.sticky ? 0 : ps.secureMacs.length}`,
      `Sticky MAC Addresses       : ${ps.sticky ? ps.secureMacs.length : 0}`,
      `Last Source Address:Vlan   : ${lastMac ? `${ciscoMac(lastMac)}:${i.accessVlan}` : '0000.0000.0000:0'}`,
      `Security Violation Count   : ${ps.violations}`,
    ];
  }
  const out = [
    'Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action',
    '                (Count)       (Count)          (Count)',
    '---------------------------------------------------------------------------',
  ];
  for (const x of d.ifaces) {
    const ps = x.portSecurity;
    if (!ps?.enabled) continue;
    out.push(`${padL(shortIf(x.name), 11)}${padL(ps.maximum, 15)}${padL(ps.secureMacs.length, 13)}${padL(ps.violations, 19)}${padL(ps.violation[0].toUpperCase() + ps.violation.slice(1), 18)}`);
  }
  out.push('---------------------------------------------------------------------------', 'Total Addresses in System (excluding one mac per port)     : 0', 'Max Addresses limit in System (excluding one mac per port) : 4096');
  return out;
}

export function showSpanningTree(e: NetEngine, d: Device, vlanFilter?: number): string[] {
  const ios = d.ios!;
  const out: string[] = [];
  const isRoot = d.kind === 'l3switch';
  const core = Object.values(e.net.devices).find((x) => x.kind === 'l3switch');
  for (const vs of Object.keys(ios.vlans)) {
    const v = Number(vs);
    if (vlanFilter !== undefined && v !== vlanFilter) continue;
    const ports = d.ifaces.filter((i) => {
      if (!i.switchport || i.type === 'svi' || !e.oper(i).up) return false;
      if (i.mode === 'access') return i.accessVlan === v;
      const l = parseVlanList(i.allowedVlans);
      return l === 'all' || (l && l.includes(v));
    });
    if (!ports.length) continue;
    out.push(
      `VLAN${String(v).padStart(4, '0')}`,
      '  Spanning tree enabled protocol rstp',
      `  Root ID    Priority    ${24576 + v}`,
      `             Address     ${ciscoMac(core?.ifaces[0].mac ?? d.ifaces[0].mac)}`,
      isRoot ? '             This bridge is the root' : `             Cost        4`,
      isRoot ? '' : `             Port        ${ports.findIndex((p) => p.mode === 'trunk') + 1} (${ports.find((p) => p.mode === 'trunk')?.name ?? ''})`,
      '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec',
      '',
      `  Bridge ID  Priority    ${(isRoot ? 24576 : 32768) + v}  (priority ${isRoot ? 24576 : 32768} sys-id-ext ${v})`,
      `             Address     ${ciscoMac(d.ifaces[0].mac)}`,
      '',
      'Interface           Role Sts Cost      Prio.Nbr Type',
      '------------------- ---- --- --------- -------- --------------------------------',
    );
    for (const p of ports) {
      const blocked = e.c.stpBlocked.has(p.id);
      const role = blocked ? 'Altn' : !isRoot && p.mode === 'trunk' ? 'Root' : 'Desg';
      const sts = blocked ? 'BLK' : 'FWD';
      out.push(`${pad(shortIf(p.name), 20)}${pad(role, 5)}${pad(sts, 4)}${pad(4, 10)}${pad(`128.${d.ifaces.indexOf(p) + 1}`, 9)}P2p${p.portfast && p.mode === 'access' ? ' Edge' : ''}`);
    }
    out.push('');
  }
  return out.length ? out : ['No spanning tree instance exists.'];
}

export function showLogging(e: NetEngine, d: Device): string[] {
  return [
    'Syslog logging: enabled (0 messages dropped, 0 messages rate-limited, 0 flushes, 0 overruns, xml disabled, filtering disabled)',
    '',
    '    Console logging: level debugging, ' + (d.logs.length + 120) + ' messages logged, xml disabled,',
    '    Buffer logging:  level debugging, ' + (d.logs.length + 120) + ' messages logged, xml disabled,',
    '',
    `Log Buffer (16384 bytes):`,
    ...(d.logs.length ? d.logs.map((l) => l.msg) : ['(no messages since boot)']),
  ];
}

export function showCpu(e: NetEngine, d: Device): string[] {
  const cpu = d.kind === 'firewall' ? e.fwCpu : d.kind === 'l3switch' ? e.coreCpu : 6 + (hash(d.id + e.loadEpoch) % 5);
  const one = Math.max(1, Math.round(cpu * 0.95));
  const out = [`CPU utilization for five seconds: ${cpu}%/${Math.round(cpu / 6)}%; one minute: ${one}%; five minutes: ${Math.max(1, Math.round(cpu * 0.85))}%`, ' PID Runtime(ms)     Invoked      uSecs   5Sec   1Min   5Min TTY Process '];
  const procs: [string, number][] =
    d.kind === 'firewall'
      ? [
          ['IP Input', cpu * 0.55],
          ['FW Inspect (ZBF)', cpu * 0.25],
          ['IP NAT Ager', cpu * 0.05],
          ['ARP Input', 0.3],
        ]
      : [
          ['IP Input', cpu * 0.3],
          ['Spanning Tree', 0.6],
          ['ARP Input', 0.4],
          ['DHCPD Receive', 0.2],
          ['CDP Protocol', 0.1],
        ];
  procs.forEach(([n, p], k) => out.push(`${padL(100 + k * 37, 4)}${padL(1000 + k * 3311, 12)}${padL(5000 + k * 911, 12)}${padL(120 + k * 7, 11)}${padL(p.toFixed(2) + '%', 7)}${padL(p.toFixed(2) + '%', 7)}${padL(p.toFixed(2) + '%', 7)}   0 ${n}`));
  return out;
}

export function showSnooping(e: NetEngine, d: Device): string[] {
  const sn = d.ios!.dhcpSnooping;
  const out = [
    `Switch DHCP snooping is ${sn.enabled ? 'enabled' : 'disabled'}`,
    'Switch DHCP gleaning is disabled',
    'DHCP snooping is configured on following VLANs:',
    sn.vlans.length ? formatVlanList(sn.vlans) : 'none',
    'DHCP snooping is operational on following VLANs:',
    sn.enabled && sn.vlans.length ? formatVlanList(sn.vlans) : 'none',
    'Insertion of option 82 is disabled',
    '',
    'Interface                  Trusted    Allow option    Rate limit (pps)',
    '-----------------------    -------    ------------    ----------------',
  ];
  for (const i of d.ifaces) if (i.dhcpSnoopTrust && sn.enabled) out.push(`${pad(i.name, 27)}${pad('yes', 11)}${pad('yes', 16)}unlimited`);
  return out;
}

export function showRunIface(d: Device, i: Iface): string[] {
  return ['Building configuration...', '', `Current configuration : ${renderIfaceConfig(d, i).join('\n').length + 20} bytes`, '!', ...renderIfaceConfig(d, i), 'end'];
}

export function showRun(d: Device): string[] {
  return renderRunningConfig(d);
}

export function showStartup(d: Device): string[] {
  if (!d.ios?.startup) return ['startup-config is not present'];
  // render the startup snapshot by temporarily materialising it
  const clone = JSON.parse(JSON.stringify(d)) as Device;
  const snap = JSON.parse(d.ios.startup);
  clone.name = snap.name;
  clone.ios = { ...clone.ios!, ...snap.ios };
  for (const ic of snap.ifaces) {
    const i = clone.ifaces.find((x) => x.name === ic.name);
    if (i) Object.assign(i, ic);
  }
  const lines = renderRunningConfig(clone);
  lines[0] = 'Using ' + lines.join('\n').length + ' out of 2097152 bytes';
  return lines;
}

export function syslogTime(t: number): string {
  return fmtSyslog(t);
}

export { vendorOf };
