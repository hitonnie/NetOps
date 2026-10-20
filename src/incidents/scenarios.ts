/**
 * Incident scenario library. Each scenario injects a concrete root cause into
 * the simulated network, describes only the observable symptoms, and verifies
 * the outcome (not a specific command), so any valid fix is accepted.
 */
import { pick, range } from '../core/rng';
import { INTERNET_HOSTS } from '../net/internet';
import { type Device, type Iface, shortIf } from '../net/model';
import type { Incident } from '../sim/types';
import { EQUIP_POS, T } from '../world/layout';
import { ROSTER, type RosterEntry } from '../world/roster';
import type { ScenarioDef, ScenarioHost } from './types';

type D = Record<string, any>;
const data = (inc: Incident) => inc.data as D;

function first(r: RosterEntry | null): string {
  return r ? r.name.split(' ')[0] : 'A user';
}

function wired(h: ScenarioHost, pred?: (r: RosterEntry, d: Device) => boolean): { r: RosterEntry; d: Device }[] {
  const out: { r: RosterEntry; d: Device }[] = [];
  for (const r of ROSTER) {
    const d = h.deviceOf(r.id);
    if (!d || d.kind !== 'pc') continue;
    if (!h.e.isUp(d.id)) continue;
    const ap = h.accessPort(d.id);
    if (!ap || !h.e.oper(ap.port).up) continue;
    if (h.s.incidents.some((i) => i.status !== 'resolved' && i.affectedDevs.includes(d.id))) continue;
    if (pred && !pred(r, d)) continue;
    out.push({ r, d });
  }
  return out;
}

function preferPresent(h: ScenarioHost, list: { r: RosterEntry; d: Device }[]) {
  const present = list.filter((x) => h.employee(x.r.id)?.present);
  return present.length ? present : list;
}

function names(h: ScenarioHost, devs: string[]): string {
  const ns = devs.map((d) => h.ownerOf(d)?.name ?? h.dev(d)?.name).filter(Boolean) as string[];
  if (ns.length <= 3) return ns.join(', ');
  return `${ns.slice(0, 3).join(', ')} and ${ns.length - 3} more`;
}

function sw(h: ScenarioHost, id: string): Device {
  return h.dev(id);
}

function port(h: ScenarioHost, swId: string, name: string): Iface {
  return h.dev(swId).ifaces.find((i) => i.name === name)!;
}

function configLog(h: ScenarioHost, devId: string, who: string) {
  h.e.log(devId, `%SYS-5-CONFIG_I: Configured from console by ${who}`);
}

const employeeDevs = (h: ScenarioHost, pred: (r: RosterEntry, d: Device) => boolean) =>
  ROSTER.map((r) => ({ r, d: h.deviceOf(r.id) }))
    .filter((x): x is { r: RosterEntry; d: Device } => !!x.d && pred(x.r, x.d))
    .map((x) => x.d.id);

const allOnline = (h: ScenarioHost, devs: string[]) => devs.every((d) => h.hostOnline(d));
const whyOffline = (h: ScenarioHost, devs: string[]) => {
  const bad = devs.filter((d) => !h.hostOnline(d));
  return bad.length ? `${bad.length} of ${devs.length} affected device(s) still have no working IP connectivity (${names(h, bad)}).` : '';
};

function internetOk(h: ScenarioHost, dev: string): boolean {
  const c = h.e.checkService(dev, 'github.com', 'tcp', 443);
  return c.ok && c.quality >= 0.6;
}

function sampleWired(h: ScenarioHost, n = 4): string[] {
  const list = ['pc-eng-02', 'pc-dsn-01', 'pc-fin-02', 'pc-qa-01', 'pc-rcp-01', 'pc-eng-05'].filter((d) => h.e.net.devices[d]);
  return list.slice(0, n);
}

/** Does any ACL along the inside path or on the firewall deny this flow? */
export function fwBlocks(h: ScenarioHost, srcIp: string, dstIp: string, proto: 'tcp' | 'udp', port: number): boolean {
  const fw = h.dev('fw-edge');
  for (const i of fw.ifaces) {
    if (i.nat === 'inside' && i.aclIn && h.e.aclDenies(fw, i.aclIn, { src: srcIp, dst: dstIp, proto, port }, false)) return true;
    if (i.nat === 'outside' && i.aclOut && h.e.aclDenies(fw, i.aclOut, { src: srcIp, dst: dstIp, proto, port }, false)) return true;
  }
  const core = h.dev('core-sw1');
  for (const i of core.ifaces) if (i.type === 'svi' && i.aclIn && i.ip && i.mask && srcIp.startsWith(i.ip.split('.').slice(0, 3).join('.')) && h.e.aclDenies(core, i.aclIn, { src: srcIp, dst: dstIp, proto, port }, false)) return true;
  return false;
}

const INTERNAL_SVC: Record<string, { host: string; port: number; label: string }> = {
  Engineering: { host: 'git.corp.local', port: 443, label: 'git.corp.local' },
  QA: { host: 'staging.corp.local', port: 443, label: 'the staging site' },
  Design: { host: 'files.corp.local', port: 445, label: 'the file share' },
  Finance: { host: 'erp.corp.local', port: 443, label: 'the ERP' },
  Office: { host: 'erp.corp.local', port: 443, label: 'the ERP' },
  Management: { host: 'wiki.corp.local', port: 443, label: 'the wiki' },
};

// ---------------------------------------------------------------------------

export const SCENARIOS: ScenarioDef[] = [
  // ======================================================================== PHYSICAL / SWITCHING
  {
    id: 'port-shutdown',
    name: 'Access port administratively shut down',
    category: 'Switching',
    severity: 3,
    minDay: 0,
    weight: 1,
    detect: 'users',
    workHoursOnly: true,
    inject(h, opts?: { target?: string }) {
      let cands = wired(h);
      if (opts?.target) cands = cands.filter((x) => x.r.id === opts.target);
      if (!cands.length) return null;
      const t = pick(h.rng, preferPresent(h, cands));
      const ap = h.accessPort(t.d.id)!;
      ap.port.shutdown = true;
      configLog(h, ap.sw.id, 'contractor on vty1 (10.10.99.77)');
      h.e.log(ap.sw.id, `%LINK-5-CHANGED: Interface ${ap.port.name}, changed state to administratively down`);
      h.invalidate();
      return { data: { dev: t.d.id, emp: t.r.id, sw: ap.sw.id, port: ap.port.name }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)} can't connect to anything`, symptom: `${r?.name} (${r?.dept}, desk ${r?.desk}) says their PC suddenly shows "No Internet access" and nothing loads — not even internal tools. People at neighbouring desks are working normally.`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    checklist: () => [
      { id: 'find', text: "Trace the user's desk to its switch port" },
      { id: 'fix', text: 'Bring the switch port back into service' },
      { id: 'verify', text: 'Confirm the PC has an IP and reaches its gateway' },
    ],
    checkItem(h, inc, id) {
      const d = data(inc);
      const p = port(h, d.sw, d.port);
      if (id === 'find') return (d._viewed ?? []).includes(d.sw) || !p.shutdown;
      if (id === 'fix') return !p.shutdown;
      return h.hostOnline(d.dev);
    },
    resolved: (h, inc) => h.hostOnline(data(inc).dev),
    whyNot: (h, inc) => whyOffline(h, [data(inc).dev]),
    hints: (inc) => {
      const d = data(inc);
      return [
        "Start at the user's PC: open it and run 'ipconfig'. 'Media disconnected' means there's no link at all — a Layer 1/2 problem, not DHCP or DNS.",
        `Follow the cable: the PC panel's Connections section shows it lands on ${d.sw.toUpperCase()} ${shortIf(d.port)}. On that switch try 'show interfaces status' or 'show ip interface brief'.`,
        `${shortIf(d.port)} shows "administratively down". Enter 'configure terminal', 'interface ${shortIf(d.port)}', then 'no shutdown'.`,
      ];
    },
    manual: ['troubleshooting-method', 'interface-states', 'cli-basics'],
    rootCause: (inc) => `${shortIf(data(inc).port)} on ${data(inc).sw.toUpperCase()} had been administratively shut down by a contractor tidying up "unused" ports (see 'show logging').`,
    fix: (inc) => `interface ${shortIf(data(inc).port)} → no shutdown`,
    solution: (inc) => [{ cli: data(inc).sw, cmds: ['enable', 'configure terminal', `interface ${shortIf(data(inc).port)}`, 'no shutdown', 'end'] }],
  },
  {
    id: 'cable-unplugged',
    name: 'Desk cable knocked loose',
    category: 'Physical',
    severity: 4,
    minDay: 0,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(h, wired(h));
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const link = h.e.linkOf(t.d.ifaces[0].id)!;
      link.status = 'unplugged';
      h.invalidate();
      return { data: { dev: t.d.id, link: link.id }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)}: "my computer has no network"`, symptom: `${r?.name} (desk ${r?.desk}): "My PC says there's no network. I didn't change anything! The cleaners were vacuuming around the desks this morning, not sure if related."`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    resolved: (h, inc) => h.e.net.links[data(inc).link]?.status === 'ok' && h.hostOnline(data(inc).dev),
    whyNot: (h, inc) => (h.e.net.links[data(inc).link]?.status !== 'ok' ? 'The desk cable is still not properly connected.' : whyOffline(h, [data(inc).dev])),
    hints: (inc) => [
      "Physical layer first: does the PC have link? 'ipconfig' says 'Media disconnected' when the NIC sees no cable.",
      `The switch side ('show interfaces status' on the access switch) shows the port as "notconnect" — not disabled. That points at the cable or the PC's NIC.`,
      `Select the PC and use "Reseat cable" in its Physical section.`,
    ],
    manual: ['interface-states', 'physical-layer'],
    rootCause: () => 'The patch cable under the desk had been pulled out of the floor box.',
    fix: () => 'Reseated the patch cable (Physical → Reseat cable).',
    solution: (inc) => [{ act: 'reseat-cable', dev: data(inc).dev }],
  },
  {
    id: 'cable-degraded',
    name: 'Crushed patch cable (CRC errors, 100 Mb/s)',
    category: 'Physical',
    severity: 3,
    minDay: 1,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(h, wired(h));
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const link = h.e.linkOf(t.d.ifaces[0].id)!;
      link.status = 'degraded';
      h.invalidate();
      const ap = h.accessPort(t.d.id)!;
      return { data: { dev: t.d.id, link: link.id, sw: ap.sw.id, port: ap.port.name }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)}: network "really slow"`, symptom: `${r?.name} (desk ${r?.desk}) says everything is painfully slow — git pulls stall, video calls freeze, pages half-load. Colleagues say their connections are fine.`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    resolved: (h, inc) => h.e.net.links[data(inc).link]?.status === 'ok',
    whyNot: () => 'The link still shows CRC errors and only negotiates 100 Mb/s.',
    hints: (inc) => [
      'Slow for one user only? Look at that user\'s switch port counters, not the core.',
      `On ${data(inc).sw.toUpperCase()} run 'show interfaces ${shortIf(data(inc).port)}' — check speed/duplex, CRC and input errors. Run it twice: are the CRC counters climbing?`,
      'Rising CRC errors with the link stuck at 100 Mb/s = bad cabling. Replace the patch cable (Physical → Replace cable; needs a spare from the Shop).',
    ],
    manual: ['physical-layer', 'interface-counters'],
    rootCause: () => 'A chair castor had crushed the desk patch cable: two pairs were damaged, so the link fell back to 100 Mb/s with constant CRC errors.',
    fix: () => 'Replaced the patch cable.',
    solution: (inc) => [{ act: 'replace-cable', dev: data(inc).dev }],
  },
  {
    id: 'wrong-access-vlan',
    name: 'Typo in access VLAN after a desk move',
    category: 'Switching',
    severity: 3,
    minDay: 0,
    weight: 1,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(h, wired(h));
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const ap = h.accessPort(t.d.id)!;
      const typo: Record<number, number> = { 10: 11, 20: 2, 30: 3, 40: 14, 50: 5 };
      const old = ap.port.accessVlan;
      const wrong = typo[old] ?? old + 1;
      ap.port.accessVlan = wrong;
      ap.sw.ios!.vlans[String(wrong)] = `VLAN${String(wrong).padStart(4, '0')}`;
      configLog(h, ap.sw.id, 'helpdesk on vty0 (10.10.99.52)');
      h.invalidate();
      h.forceRenew([t.d.id]);
      return { data: { dev: t.d.id, sw: ap.sw.id, port: ap.port.name, vlan: old, wrong }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)}: "limited connectivity" after desk move`, symptom: `${r?.name} moved desks yesterday (helpdesk re-patched the port). This morning their PC says "No internet" and nothing internal loads either.`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    resolved: (h, inc) => h.hostOnline(data(inc).dev),
    whyNot: (h, inc) => whyOffline(h, [data(inc).dev]),
    hints: (inc, h) => [
      "Run 'ipconfig' on the PC. A 169.254.x.x address means DHCP failed — the PC has link, but no DHCP server answered in its broadcast domain (VLAN).",
      `Compare the port's VLAN with the department's VLAN: 'show interfaces status' or 'show vlan brief' on ${data(inc).sw.toUpperCase()}. ${h.ownerOf(data(inc).dev)?.dept ?? 'These'} users belong in VLAN ${data(inc).vlan}.`,
      `Fix the access VLAN: 'interface ${shortIf(data(inc).port)}' → 'switchport access vlan ${data(inc).vlan}'. Then 'ipconfig /renew' on the PC (or wait for it to retry).`,
    ],
    manual: ['vlans', 'dhcp', 'apipa'],
    rootCause: (inc) => `During the desk move the port was set to VLAN ${data(inc).wrong} instead of ${data(inc).vlan}. IOS silently created VLAN ${data(inc).wrong}, which has no gateway or DHCP — so the PC fell back to APIPA.`,
    fix: (inc) => `switchport access vlan ${data(inc).vlan} on ${shortIf(data(inc).port)} (and optionally 'no vlan ${data(inc).wrong}').`,
    solution: (inc) => [{ cli: data(inc).sw, cmds: ['enable', 'conf t', `int ${shortIf(data(inc).port)}`, `switchport access vlan ${data(inc).vlan}`, 'end'] }, { renew: [data(inc).dev] }],
  },
  {
    id: 'trunk-allowed-missing',
    name: 'VLAN pruned from the access-switch trunk',
    category: 'Switching',
    severity: 2,
    minDay: 1,
    weight: 0.9,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const up = port(h, 'sw-dqa', 'GigabitEthernet1/1/1');
      if (up.allowedVlans !== '20,30,70,99') return null;
      up.allowedVlans = '20,70,99';
      configLog(h, 'sw-dqa', 'netadmin2 on vty0 (10.10.99.51)');
      h.invalidate();
      const affected = h.hostsInVlan(30).map((d) => d.id);
      if (!affected.length) return null;
      return { data: {}, affected };
    },
    alert: () => ({ title: 'QA team offline — Design (same switch) is fine', symptom: 'Several QA engineers report that nothing works: no internal tools, no Internet. Designers sitting on the same floor and switch are working normally. A colleague mentions "Pat was cleaning up trunk configs yesterday".', area: 'QA (VLAN 30)' }),
    resolved: (h, inc) => allOnline(h, inc.affectedDevs),
    whyNot: (h, inc) => whyOffline(h, inc.affectedDevs),
    hints: () => [
      'Same switch, one VLAN broken, another fine → the problem is VLAN-specific, not the switch or its uplink cable.',
      "Compare 'show interfaces trunk' on SW-DQA and on CORE-SW1 (Gi1/1/2). Look at the 'Vlans allowed' rows.",
      "VLAN 30 is missing from SW-DQA's uplink. On Gi1/1/1: 'switchport trunk allowed vlan add 30' (never forget the word add!).",
    ],
    manual: ['trunks', 'vlans'],
    rootCause: () => 'VLAN 30 had been removed from the allowed list on SW-DQA Gi1/1/1, so QA traffic could no longer cross the trunk to the core (its gateway).',
    fix: () => "SW-DQA Gi1/1/1 → 'switchport trunk allowed vlan add 30'.",
    solution: () => [{ cli: 'sw-dqa', cmds: ['enable', 'conf t', 'int gi1/1/1', 'switchport trunk allowed vlan add 30', 'end'] }],
  },
  {
    id: 'native-vlan-mismatch',
    name: 'Native VLAN mismatch on uplink trunk',
    category: 'Switching',
    severity: 2,
    minDay: 2,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const up = port(h, 'sw-dqa', 'GigabitEthernet1/1/1');
      if (up.nativeVlan !== 998) return null;
      up.nativeVlan = 20;
      configLog(h, 'sw-dqa', 'netadmin2 on vty0 (10.10.99.51)');
      h.invalidate();
      const affected = h.hostsInVlan(20).filter((d) => d.kind !== 'printer').map((d) => d.id);
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Design team cannot reach anything', symptom: 'Designers report total loss of connectivity since about the time a "VLAN tidy-up" change went in on the Design/QA switch. QA, on the same switch, is unaffected. The design printer still prints from designers\' PCs.', area: 'Design (VLAN 20)' }),
    tick(h) {
      const a = port(h, 'sw-dqa', 'GigabitEthernet1/1/1');
      const b = port(h, 'core-sw1', 'GigabitEthernet1/1/2');
      if (a.nativeVlan !== b.nativeVlan && Math.floor(h.now) % 3 === 0) {
        h.e.log('core-sw1', `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet1/1/2 (${b.nativeVlan}), with SW-DQA GigabitEthernet1/1/1 (${a.nativeVlan}).`);
        h.e.log('sw-dqa', `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet1/1/1 (${a.nativeVlan}), with CORE-SW1 GigabitEthernet1/1/2 (${b.nativeVlan}).`);
      }
    },
    resolved: (h, inc) => allOnline(h, inc.affectedDevs),
    whyNot: (h, inc) => whyOffline(h, inc.affectedDevs),
    hints: () => [
      "Local printing works but nothing beyond the switch does → the VLAN isn't making it across the uplink. Check the logs: 'show logging' on SW-DQA.",
      "CDP reports a native VLAN mismatch. Compare 'show interfaces trunk' on both ends: SW-DQA Gi1/1/1 and CORE-SW1 Gi1/1/2.",
      "SW-DQA's native VLAN was changed to 20, so Design frames leave untagged and land in VLAN 998 on the core. Set 'switchport trunk native vlan 998' on SW-DQA Gi1/1/1.",
    ],
    manual: ['trunks', 'native-vlan', 'cdp'],
    rootCause: () => 'SW-DQA Gi1/1/1 had its native VLAN set to 20 (core uses 998). Design traffic was sent untagged and the core placed it into VLAN 998 — away from its gateway.',
    fix: () => "SW-DQA Gi1/1/1 → 'switchport trunk native vlan 998'.",
    solution: () => [{ cli: 'sw-dqa', cmds: ['enable', 'conf t', 'int gi1/1/1', 'switchport trunk native vlan 998', 'end'] }],
  },
  {
    id: 'vlan-deleted',
    name: 'VLAN deleted from access switch',
    category: 'Switching',
    severity: 2,
    minDay: 2,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const s = sw(h, 'sw-eng');
      if (!s.ios!.vlans['10']) return null;
      delete s.ios!.vlans['10'];
      configLog(h, 'sw-eng', 'netadmin2 on vty0 (10.10.99.51)');
      h.invalidate();
      const affected = employeeDevs(h, (r, d) => r.dept === 'Engineering' && d.kind === 'pc');
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Engineering desktops all offline', symptom: 'Every engineer on a desktop lost connectivity at once. People on laptops (Wi-Fi) in Engineering are still working. The engineering printer is offline too.', area: 'Engineering (wired)' }),
    resolved: (h, inc) => allOnline(h, inc.affectedDevs),
    whyNot: (h, inc) => whyOffline(h, inc.affectedDevs),
    hints: () => [
      'Wired users on one switch are down but Wi-Fi users on the same switch are fine → compare what is different: their VLAN (10 vs 70).',
      "On SW-ENG: 'show vlan brief' and 'show interfaces status'. Ports in a VLAN that doesn't exist show as 'inactive'.",
      "VLAN 10 was deleted. Recreate it: 'vlan 10' then 'name ENG'. The ports come back automatically.",
    ],
    manual: ['vlans', 'interface-states'],
    rootCause: () => "VLAN 10 had been deleted from SW-ENG's VLAN database ('no vlan 10'), making every access port in VLAN 10 inactive.",
    fix: () => "SW-ENG → 'vlan 10', 'name ENG'.",
    solution: () => [{ cli: 'sw-eng', cmds: ['enable', 'conf t', 'vlan 10', 'name ENG', 'end'] }],
  },
  {
    id: 'duplex-mismatch',
    name: 'Hard-coded speed/duplex on an access port',
    category: 'Physical',
    severity: 3,
    minDay: 2,
    weight: 0.6,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(h, wired(h));
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const ap = h.accessPort(t.d.id)!;
      ap.port.speed = '100';
      ap.port.duplex = 'full';
      configLog(h, ap.sw.id, 'helpdesk on vty0 (10.10.99.52)');
      h.invalidate();
      return { data: { dev: t.d.id, sw: ap.sw.id, port: ap.port.name }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)}: everything crawls`, symptom: `${r?.name} (desk ${r?.desk}): "Since the helpdesk 'fixed' my flaky network yesterday, everything is painfully slow. Big downloads crawl and video calls keep breaking up."`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    resolved: (h, inc) => {
      const d = data(inc);
      const p = port(h, d.sw, d.port);
      return !h.e.oper(p).duplexMismatch && h.hostOnline(d.dev);
    },
    whyNot: () => 'The port still negotiates a different duplex than the PC (late collisions / CRC errors keep rising).',
    hints: (inc) => [
      'One slow user: check their access port in detail with "show interfaces".',
      `On ${data(inc).sw.toUpperCase()} 'show interfaces ${shortIf(data(inc).port)}': note "Full-duplex, 100Mb/s" (not auto) and growing late collisions/CRC. Compare with 'show running-config interface ${shortIf(data(inc).port)}'.`,
      'The switch port is hard-coded to 100/full while the PC auto-negotiates and falls back to half duplex. Set "speed auto" and "duplex auto" on the port.',
    ],
    manual: ['duplex', 'interface-counters'],
    rootCause: () => 'The access port was hard-coded to speed 100 / duplex full. The PC (auto-negotiating) fell back to half duplex → duplex mismatch with late collisions and CRC errors.',
    fix: () => "On the port: 'speed auto' and 'duplex auto'.",
    solution: (inc) => [{ cli: data(inc).sw, cmds: ['enable', 'conf t', `int ${shortIf(data(inc).port)}`, 'speed auto', 'duplex auto', 'end'] }],
  },
  {
    id: 'uplink-failure',
    name: 'Failed fiber optic on access-switch uplink',
    category: 'Physical',
    severity: 1,
    minDay: 2,
    weight: 0.6,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const p = port(h, 'sw-eng', 'GigabitEthernet1/1/1');
      if (p.hwFault !== 'none') return null;
      p.hwFault = 'dead';
      h.e.log('sw-eng', '%SFF8472-5-THRESHOLD_VIOLATION: Gi1/1/1: Rx power low alarm; Operating value: -40.0 dBm, Threshold value: -17.0 dBm.');
      h.e.log('sw-eng', '%PHY-4-SFP_NOT_SUPPORTED: The SFP in Gi1/1/1 is not responding');
      h.invalidate();
      const redundant = h.hasUpgrade('redundant-uplinks');
      const affected = redundant ? [] : employeeDevs(h, (r) => r.dept === 'Engineering');
      return { data: { redundant }, affected };
    },
    alert: (h, inc) =>
      data(inc).redundant
        ? { title: 'SW-ENG primary uplink down (redundant path active)', symptom: 'Monitoring: SW-ENG Gi1/1/1 went down. Spanning tree moved traffic to the backup uplink — users are not affected, but there is no redundancy left until it is repaired.', area: 'Engineering IDF' }
        : { title: 'Entire Engineering area offline', symptom: 'All engineers — wired and Wi-Fi — lost connectivity at the same moment. The engineering printer is unreachable too. Other departments are fine.', area: 'Engineering (all)' },
    resolved: (h, inc) => port(h, 'sw-eng', 'GigabitEthernet1/1/1').hwFault === 'none' || (!data(inc).redundant && allOnline(h, inc.affectedDevs) && inc.affectedDevs.length > 0),
    whyNot: (h, inc) => (data(inc).redundant ? 'The failed optic in SW-ENG Gi1/1/1 has not been replaced yet.' : whyOffline(h, inc.affectedDevs)),
    hints: () => [
      'Everyone behind one switch (wired AND Wi-Fi) is down → suspect what they share: the switch itself or its uplink to the core.',
      "Check SW-ENG ('show interfaces status', 'show logging') and CORE-SW1's Gi1/1/1. The SFP on SW-ENG Gi1/1/1 reports no light.",
      'Replace the optic: select SW-ENG, open the port Gi1/1/1 and use "Replace optic/fiber" (needs a spare from the Shop). Alternatively move the uplink to a spare SFP port and configure it as a trunk.',
    ],
    manual: ['physical-layer', 'uplinks', 'stp'],
    rootCause: (inc) => (data(inc).redundant ? 'The SFP optic in SW-ENG Gi1/1/1 failed; spanning tree failed over to the redundant uplink.' : 'The SFP optic in SW-ENG Gi1/1/1 failed. With a single uplink, the whole engineering switch was cut off from the core.'),
    fix: () => 'Replaced the failed optic (Shop: fiber patch + SFP).',
    solution: () => [{ act: 'replace-optic', dev: 'sw-eng', args: { iface: 'GigabitEthernet1/1/1' } }],
  },
  {
    id: 'port-security',
    name: 'Port-security violation from an unauthorised desk switch',
    category: 'Switching',
    severity: 3,
    minDay: 1,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(
        h,
        wired(h, (r) => r.dept === 'Finance'),
      );
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const ap = h.accessPort(t.d.id)!;
      const link = h.e.linkOf(t.d.ifaces[0].id)!;
      const pos = { x: t.d.pos.x + 14, y: t.d.pos.y + 8 };
      const rogueId = `rogue-hub-${Math.floor(h.now)}`;
      delete h.e.net.links[link.id];
      const rogue = h.addRogue({ id: rogueId, name: 'UNKNOWN-DEVICE', model: 'NETGEAR GS105 5-port unmanaged switch', vendor: 'netgear', swId: ap.sw.id, port: ap.port.name, ip: null, mask: null, extraMacs: 1, pos });
      rogue.rogue!.bridge = true;
      rogue.rogue!.description = 'A small unmanaged desk switch with a personal laptop plugged into it.';
      rogue.rogue!.restoreLink = { a: [t.d.id, t.d.ifaces[0].name], b: [ap.sw.id, ap.port.name] };
      // PC now hangs off the desk switch
      rogue.ifaces.push({ ...rogue.ifaces[0], id: `${rogueId}|port2`, name: 'port2', mac: rogue.ifaces[0].mac.replace(/..$/, 'ee') });
      h.e.net.links[`L${rogueId}`] = { id: `L${rogueId}`, a: { dev: t.d.id, iface: t.d.ifaces[0].name }, b: { dev: rogueId, iface: 'port2' }, medium: 'copper', status: 'ok', kind: 'rogue' };
      h.invalidate();
      return { data: { dev: t.d.id, sw: ap.sw.id, port: ap.port.name, rogue: rogueId }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)} (Finance): network died at desk`, symptom: `${r?.name}: "My computer lost the network right after lunch. It was fine this morning." (Finance desks use port security.)`, area: `Finance · desk ${r?.desk}` };
    },
    checklist: () => [
      { id: 'remove', text: 'Remove the unauthorised device from the desk' },
      { id: 'recover', text: 'Recover the err-disabled switch port' },
      { id: 'verify', text: 'Confirm the PC is back online' },
    ],
    checkItem(h, inc, id) {
      const d = data(inc);
      if (id === 'remove') return !h.e.net.devices[d.rogue];
      if (id === 'recover') return !port(h, d.sw, d.port).errDisabled;
      return h.hostOnline(d.dev);
    },
    resolved: (h, inc) => !h.e.net.devices[data(inc).rogue] && h.hostOnline(data(inc).dev),
    whyNot: (h, inc) => (h.e.net.devices[data(inc).rogue] ? 'The unauthorised device is still connected at the desk.' : whyOffline(h, [data(inc).dev])),
    hints: (inc) => [
      `Check the user's switch port on ${data(inc).sw.toUpperCase()}: 'show interfaces status' — what state is ${shortIf(data(inc).port)} in? Then 'show logging'.`,
      "The port is err-disabled by a port-security violation: more MAC addresses appeared than allowed (maximum 1). 'show port-security interface …' shows the violation count. Look at the desk in the office view — there's an extra device.",
      `Remove the unknown device (select it → "Remove device"), then recover the port with 'shutdown' followed by 'no shutdown' on ${shortIf(data(inc).port)}.`,
    ],
    manual: ['port-security', 'interface-states', 'rogue-devices'],
    rootCause: () => 'The user connected a personal 5-port desk switch (and their own laptop) to the wall port. Port security saw a second MAC address and err-disabled the port.',
    fix: (inc) => `Removed the desk switch; 'shutdown' + 'no shutdown' on ${shortIf(data(inc).port)}.`,
    solution: (inc) => [
      { act: 'remove-device', dev: data(inc).rogue },
      { cli: data(inc).sw, cmds: ['enable', 'conf t', `int ${shortIf(data(inc).port)}`, 'shutdown', 'no shutdown', 'end'] },
    ],
  },
  // ======================================================================== DHCP / ADDRESSING
  {
    id: 'dhcp-exhaustion',
    name: 'Wi-Fi DHCP scope exhausted',
    category: 'DHCP',
    severity: 2,
    minDay: 1,
    weight: 0.9,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const core = sw(h, 'core-sw1');
      const ios = core.ios!;
      const ex = ios.dhcpExcluded.find((x) => x.start === '10.10.70.1' && x.end === '10.10.70.20');
      const pool = ios.dhcpPools.find((p) => p.name === 'WIFI');
      if (!ex || !pool) return null;
      ex.end = '10.10.70.240';
      pool.leaseDays = 7;
      const laptops = Object.values(h.e.net.devices).filter((d) => d.kind === 'laptop');
      ios.dhcpBindings = ios.dhcpBindings.filter((b) => b.pool !== 'WIFI');
      for (let k = 241; k <= 254; k++) ios.dhcpBindings.push({ ip: `10.10.70.${k}`, mac: `a4:5e:60:${(k * 7).toString(16).padStart(2, '0').slice(-2)}:${(k * 13).toString(16).padStart(2, '0').slice(-2)}:${k.toString(16)}`, expires: h.now + 6 * 1440, deviceId: null, pool: 'WIFI' });
      configLog(h, 'core-sw1', 'netadmin2 on vty0 (10.10.99.51)');
      h.e.log('core-sw1', '%DHCPD-4-NO_ADDRESS: DHCP pool WIFI has no free addresses (exhausted)');
      h.invalidate();
      h.forceRenew(laptops.map((d) => d.id));
      return { data: {}, affected: laptops.map((d) => d.id) };
    },
    alert: () => ({ title: 'Wi-Fi: "connected, no internet" for laptop users', symptom: 'Laptop users report Wi-Fi shows "No internet, secured". Desktops are fine. Yesterday someone reserved addresses for new "smart office" sensors and lengthened guest leases.', area: 'Wi-Fi users (VLAN 70)' }),
    resolved: (h, inc) => allOnline(h, inc.affectedDevs),
    whyNot: (h, inc) => whyOffline(h, inc.affectedDevs),
    hints: () => [
      "On a laptop run 'ipconfig': a 169.254.x.x address means no DHCP offer arrived. Wi-Fi association itself is fine.",
      "On CORE-SW1 (the DHCP server) check 'show ip dhcp pool' and 'show running-config | include excluded'. How many addresses are actually leasable?",
      "The exclusion 10.10.70.1–10.10.70.240 leaves only 14 addresses, all taken by stale guest leases. Fix the exclusion (no … then 'ip dhcp excluded-address 10.10.70.1 10.10.70.20'), consider 'lease 1' in the WIFI pool and 'clear ip dhcp binding *'.",
    ],
    manual: ['dhcp', 'apipa'],
    rootCause: () => 'The WIFI pool exclusion was widened to 10.10.70.1–240 and the lease time raised to 7 days. The remaining 14 addresses were all held by stale guest-phone leases.',
    fix: () => 'Restored the exclusion to .1–.20, set the lease back to 1 day and cleared stale bindings.',
    solution: () => [
      { cli: 'core-sw1', cmds: ['enable', 'conf t', 'no ip dhcp excluded-address 10.10.70.1 10.10.70.240', 'ip dhcp excluded-address 10.10.70.1 10.10.70.20', 'ip dhcp pool WIFI', 'lease 1', 'end', 'clear ip dhcp binding *'] },
      { wait: 4 },
    ],
  },
  {
    id: 'dhcp-wrong-gateway',
    name: 'Wrong default-router in DHCP pool',
    category: 'DHCP',
    severity: 2,
    minDay: 1,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const pool = sw(h, 'core-sw1').ios!.dhcpPools.find((p) => p.name === 'DESIGN');
      if (!pool || pool.defaultRouter[0] !== '10.10.20.1') return null;
      pool.defaultRouter = ['10.10.20.254'];
      configLog(h, 'core-sw1', 'netadmin2 on vty0 (10.10.99.51)');
      const affected = employeeDevs(h, (r, d) => r.dept === 'Design' && d.kind === 'pc');
      h.invalidate();
      h.forceRenew(affected);
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Design: no Internet or file share — printer works', symptom: 'After this morning\'s reboot, designers on desktops cannot reach the file share, Figma or email. Printing to the design printer still works. Designers on Wi-Fi are fine.', area: 'Design (VLAN 20, wired)' }),
    resolved: (h, inc) => allOnline(h, inc.affectedDevs),
    whyNot: (h, inc) => whyOffline(h, inc.affectedDevs) + ' (Clients only pick up new DHCP options when they renew — try "Ask users to restart" or ipconfig /renew.)',
    hints: () => [
      "Same-subnet traffic (the printer) works but anything off-subnet fails → suspect the default gateway. Check 'ipconfig /all' on an affected PC.",
      "The PCs received gateway 10.10.20.254 — which doesn't exist. Where do they get it? 'show running-config | section dhcp' on CORE-SW1.",
      "In 'ip dhcp pool DESIGN' set 'default-router 10.10.20.1'. Then have clients renew (ipconfig /renew or the incident's 'Ask users to restart' action).",
    ],
    manual: ['dhcp', 'default-gateway'],
    rootCause: () => 'The DESIGN DHCP pool handed out 10.10.20.254 as the default router (a typo from a planned gateway migration). The real gateway is the core SVI 10.10.20.1.',
    fix: () => "ip dhcp pool DESIGN → 'default-router 10.10.20.1'; clients renewed their leases.",
    solution: (inc) => [{ cli: 'core-sw1', cmds: ['enable', 'conf t', 'ip dhcp pool DESIGN', 'default-router 10.10.20.1', 'end'] }, { renew: inc.affectedDevs }],
  },
  {
    id: 'dhcp-wrong-dns',
    name: 'Wrong DNS server in DHCP pool',
    category: 'DNS',
    severity: 2,
    minDay: 2,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const pool = sw(h, 'core-sw1').ios!.dhcpPools.find((p) => p.name === 'ENG');
      if (!pool || pool.dns[0] !== '10.10.100.10') return null;
      pool.dns = ['10.10.100.11'];
      configLog(h, 'core-sw1', 'netadmin2 on vty0 (10.10.99.51)');
      const affected = employeeDevs(h, (r, d) => r.dept === 'Engineering' && d.kind === 'pc');
      h.invalidate();
      h.forceRenew(affected);
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Engineering: "can\'t resolve git.corp.local"', symptom: 'Engineers on desktops get "server not found" for git.corp.local, GitHub and the wiki. One engineer says pinging 10.10.100.30 directly works fine.', area: 'Engineering (wired)' }),
    resolved: (h, inc) => inc.affectedDevs.every((d) => h.e.resolve(d, 'git.corp.local').ok),
    whyNot: () => 'Some affected PCs still cannot resolve names (they keep the old DNS server until they renew).',
    hints: () => [
      'IP connectivity works (ping by IP succeeds) but names fail → DNS. Which DNS server is the PC using? (ipconfig /all)',
      "The PCs use 10.10.100.11 — the DNS server is 10.10.100.10 (SRV-DC01). The setting comes from the ENG DHCP pool on CORE-SW1.",
      "'ip dhcp pool ENG' → 'dns-server 10.10.100.10', then have clients renew their leases.",
    ],
    manual: ['dns', 'dhcp'],
    rootCause: () => 'The ENG DHCP pool advertised DNS server 10.10.100.11 (typo) instead of 10.10.100.10.',
    fix: () => "ip dhcp pool ENG → 'dns-server 10.10.100.10'; clients renewed.",
    solution: (inc) => [{ cli: 'core-sw1', cmds: ['enable', 'conf t', 'ip dhcp pool ENG', 'dns-server 10.10.100.10', 'end'] }, { renew: inc.affectedDevs }],
  },
  {
    id: 'static-wrong-gateway',
    name: 'User set a static IP with the wrong gateway',
    category: 'Addressing',
    severity: 4,
    minDay: 0,
    weight: 0.9,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(h, wired(h));
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const i = t.d.ifaces[0];
      if (!i.ip) return null;
      const base = i.ip.split('.').slice(0, 3).join('.');
      const gw = `${base}.254`;
      // mimic a user typing static settings from an outdated wiki page
      const hh = t.d.host!;
      hh.dhcp = false;
      hh.dnsFromDhcp = false;
      hh.ip = i.ip;
      hh.mask = '255.255.255.0';
      hh.gateway = gw;
      hh.dns = ['10.10.100.10'];
      hh.staticIp = i.ip;
      hh.staticMask = '255.255.255.0';
      hh.staticGateway = gw;
      hh.staticDns = ['10.10.100.10'];
      h.invalidate();
      return { data: { dev: t.d.id, gw }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      return { title: `${first(r)}: internet and internal apps down`, symptom: `${r?.name}: "I followed a wiki page to 'fix my network' and now nothing loads — although I can still reach the printer next to me."`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    resolved: (h, inc) => h.hostOnline(data(inc).dev),
    whyNot: (h, inc) => whyOffline(h, [data(inc).dev]),
    hints: () => [
      "Same-subnet works, everything else fails → check the default gateway in 'ipconfig /all'. Is DHCP enabled?",
      "The PC is static with gateway x.x.x.254 — nothing answers there ('ping' it). The real gateway is .1 on the core switch.",
      "Open the PC → Network settings and switch back to 'Obtain an IP address automatically (DHCP)' (or 'netsh interface ip set address \"Ethernet\" dhcp').",
    ],
    manual: ['default-gateway', 'ip-addressing'],
    rootCause: (inc) => `The user configured a static IP with default gateway ${data(inc).gw}, which doesn't exist.`,
    fix: () => 'Switched the PC back to DHCP.',
    solution: (inc) => [{ act: 'pc-dhcp', dev: data(inc).dev }],
  },
  {
    id: 'static-wrong-mask',
    name: 'Static IP with an oversized subnet mask',
    category: 'Addressing',
    severity: 4,
    minDay: 1,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(h, wired(h, (r) => r.dept !== 'Office'));
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const i = t.d.ifaces[0];
      if (!i.ip) return null;
      const hh = t.d.host!;
      const gw = hh.gateway!;
      hh.dhcp = false;
      hh.dnsFromDhcp = false;
      hh.mask = '255.255.0.0';
      hh.staticIp = i.ip;
      hh.staticMask = '255.255.0.0';
      hh.staticGateway = gw;
      hh.staticDns = [...hh.dns];
      i.mask = '255.255.0.0';
      h.invalidate();
      return { data: { dev: t.d.id }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const r = h.ownerOf(data(inc).dev);
      const svc = INTERNAL_SVC[r?.dept ?? 'Engineering'];
      return { title: `${first(r)}: internal tools time out, Internet OK`, symptom: `${r?.name} can browse the Internet and use email, but ${svc.label} and other internal servers time out. Their PC was set up manually last week "to fix Wi-Fi".`, area: `${r?.dept} · desk ${r?.desk}` };
    },
    resolved: (h, inc) => {
      const r = h.ownerOf(data(inc).dev);
      const svc = INTERNAL_SVC[r?.dept ?? 'Engineering'];
      return h.e.checkService(data(inc).dev, svc.host, 'tcp', svc.port).ok;
    },
    whyNot: () => 'The PC still cannot reach internal servers in other subnets.',
    hints: () => [
      "Internet works but other internal subnets don't: compare the PC's mask with the network's (/24). Check 'ipconfig /all'.",
      "With mask 255.255.0.0 the PC thinks 10.10.100.x is on its own LAN and ARPs for it directly instead of using the gateway. 'arp -a' / 'tracert' show it.",
      'Put the PC back on DHCP (or fix the mask to 255.255.255.0).',
    ],
    manual: ['ip-addressing', 'subnetting', 'arp'],
    rootCause: () => 'The PC had a static /16 mask. Destinations in 10.10.0.0/16 were treated as local, so traffic to the server VLAN never went to the default gateway.',
    fix: () => 'Restored DHCP (correct /24 mask).',
    solution: (inc) => [{ act: 'pc-dhcp', dev: data(inc).dev }],
  },
  {
    id: 'duplicate-ip',
    name: 'Duplicate IP: PC configured with the printer\'s address',
    category: 'Addressing',
    severity: 3,
    minDay: 2,
    weight: 0.6,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const cands = preferPresent(
        h,
        wired(h, (r) => r.dept === 'Design'),
      );
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const hh = t.d.host!;
      hh.dhcp = false;
      hh.dnsFromDhcp = false;
      hh.ip = '10.10.20.5';
      hh.mask = '255.255.255.0';
      hh.gateway = '10.10.20.1';
      hh.dns = ['10.10.100.10'];
      Object.assign(hh, { staticIp: '10.10.20.5', staticMask: '255.255.255.0', staticGateway: '10.10.20.1', staticDns: ['10.10.100.10'], ipConflict: true });
      t.d.ifaces[0].ip = '10.10.20.5';
      t.d.ifaces[0].mask = '255.255.255.0';
      h.invalidate();
      return { data: { dev: t.d.id, ip: '10.10.20.5' }, affected: [t.d.id, 'prn-dsgn'] };
    },
    alert: () => ({ title: 'Design printer: jobs vanish at random', symptom: 'Designers report that roughly half of their print jobs to PRN-DSGN never come out, and someone says their PC showed an "IP address conflict" pop-up.', area: 'Design (VLAN 20)' }),
    tick(h, inc) {
      if (Math.floor(h.now) % 4 === 0 && h.e.duplicateIps().some((x) => x.ip === data(inc).ip)) {
        const pc = h.dev(data(inc).dev);
        h.e.log('core-sw1', `%IP-4-DUPADDR: Duplicate address 10.10.20.5 on Vlan20, sourced by ${pc.ifaces[0].mac.replace(/:/g, '').replace(/(.{4})(?!$)/g, '$1.')}`);
      }
    },
    resolved: (h, inc) => !h.e.duplicateIps().some((x) => x.ip === data(inc).ip) && h.hostOnline(data(inc).dev) && h.e.isUp('prn-dsgn'),
    whyNot: () => 'Two devices still answer for 10.10.20.5.',
    hints: () => [
      "Intermittent failures to ONE address smell like a duplicate IP. Check 'show logging' on CORE-SW1 and 'show ip arp 10.10.20.5' (run it a few times).",
      "The DUPADDR log names a MAC address. Find it: 'show mac address-table address <mac>' on SW-DQA, or look for the PC whose ipconfig shows '(Duplicate)'.",
      "That designer's PC was statically set to 10.10.20.5 — the printer's reserved address. Switch the PC back to DHCP.",
    ],
    manual: ['duplicate-ip', 'arp', 'mac-table'],
    rootCause: (inc, h) => `${h.ownerOf(data(inc).dev)?.name}'s PC was manually configured with 10.10.20.5 — the design printer's static address — so ARP replies flapped between the two.`,
    fix: () => 'Reverted the PC to DHCP.',
    solution: (inc) => [{ act: 'pc-dhcp', dev: data(inc).dev }],
  },
  // ======================================================================== DNS / SERVICES
  {
    id: 'dns-service-down',
    name: 'DNS service crashed',
    category: 'DNS',
    severity: 1,
    minDay: 0,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const s = h.dev('srv-dc01').server!.services.find((x) => x.id === 'dns')!;
      if (!s.running) return null;
      s.running = false;
      s.failed = 'oom';
      h.serverLog('srv-dc01', 'kernel: [1993021.551] Out of memory: Killed process 812 (named) total-vm:2310044kB');
      h.serverLog('srv-dc01', 'systemd[1]: named.service: Main process exited, code=killed, status=9/KILL');
      h.serverLog('srv-dc01', 'systemd[1]: named.service: Failed with result \'oom-kill\'.');
      h.invalidate();
      const affected = employeeDevs(h, () => true);
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Company-wide: websites and apps won\'t load', symptom: 'Calls from every department: browsers say "server not found", Slack and email won\'t connect, internal tools fail. One engineer says "ping 8.8.8.8 works though".', area: 'Company-wide' }),
    resolved: (h) => h.dev('srv-dc01').server!.services.find((x) => x.id === 'dns')!.running && sampleWired(h).every((d) => h.e.resolve(d, 'git.corp.local').ok),
    whyNot: () => 'Name resolution is still failing for users.',
    hints: () => [
      "Pinging an IP works but names fail → DNS. Try 'nslookup git.corp.local' on any PC. Which server does it use?",
      "The DNS server is SRV-DC01 (10.10.100.10). It answers ping, so the server is up — is the DNS service? On SRV-DC01: 'systemctl status named'.",
      "named was killed by the OOM killer. Restart it: 'sudo systemctl restart named' (or Services → Restart in the server panel).",
    ],
    manual: ['dns', 'servers'],
    rootCause: () => 'The BIND DNS service (named) on SRV-DC01 was killed by the out-of-memory killer, so nobody could resolve names.',
    fix: () => "'sudo systemctl restart named' on SRV-DC01.",
    solution: () => [{ act: 'restart-service', dev: 'srv-dc01', args: { svc: 'named' } }],
  },
  {
    id: 'dns-record-wrong',
    name: 'Stale DNS A record after a server migration',
    category: 'DNS',
    severity: 3,
    minDay: 2,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const z = h.dev('srv-dc01').server!.dnsZone!;
      const rec = z.find((r) => r.name === 'git.corp.local');
      if (!rec || rec.value !== '10.10.100.30') return null;
      rec.value = '10.10.100.31';
      h.serverLog('srv-dc01', 'named[812]: zone corp.local/IN: loaded serial 2026101202 (updated by migration script)');
      h.invalidate();
      const affected = employeeDevs(h, (r) => r.dept === 'Engineering' || r.dept === 'QA');
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Git & CI unreachable for Engineering/QA', symptom: 'Pushes and pipeline pages to git.corp.local time out for everyone. The rest of the network is fine. The infra team migrated GitLab to "new hardware" last night but swears it is running.', area: 'Engineering & QA' }),
    resolved: (h) => ['pc-eng-02', 'pc-qa-01'].every((d) => !h.e.net.devices[d] || h.e.checkService(d, 'git.corp.local', 'tcp', 443).ok),
    whyNot: () => 'git.corp.local still does not lead users to a working GitLab.',
    hints: () => [
      "Is GitLab itself up? SRV-GIT is 10.10.100.30 (see the IP plan in the manual). Try 'ping git.corp.local' vs 'ping 10.10.100.30'.",
      "'nslookup git.corp.local' returns 10.10.100.31 — nothing lives there. The record lives on the DNS server SRV-DC01.",
      'Open SRV-DC01 → DNS tab and change the git.corp.local A record back to 10.10.100.30.',
    ],
    manual: ['dns'],
    rootCause: () => 'The migration script updated git.corp.local to 10.10.100.31, but GitLab stayed on 10.10.100.30.',
    fix: () => 'Corrected the git.corp.local A record to 10.10.100.30.',
    solution: () => [{ act: 'dns-set', dev: 'srv-dc01', args: { name: 'git.corp.local', type: 'A', value: '10.10.100.30' } }],
  },
  {
    id: 'smb-crash',
    name: 'File-sharing service stopped',
    category: 'Services',
    severity: 3,
    minDay: 0,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const s = h.dev('srv-file').server!.services.find((x) => x.id === 'smb')!;
      if (!s.running) return null;
      s.running = false;
      s.failed = 'exit-code';
      h.serverLog('srv-file', 'smbd[1204]: [2026/10/12 09:12:44] ../../source3/smbd/server.c:1734(main) smbd version 4.15.13 started.');
      h.serverLog('srv-file', 'smbd[1204]: Unable to open printcap file /etc/printcap for read!');
      h.serverLog('srv-file', 'systemd[1]: smbd.service: Main process exited, code=exited, status=1/FAILURE');
      h.invalidate();
      const affected = employeeDevs(h, (r) => r.dept === 'Design');
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Design: shared drive unavailable', symptom: 'Designers get "\\\\files\\design is not accessible" when opening project files. Figma and email work.', area: 'Design' }),
    resolved: (h) => h.dev('srv-file').server!.services.find((x) => x.id === 'smb')!.running && h.e.checkService('pc-dsn-01', 'files.corp.local', 'tcp', 445).ok,
    whyNot: () => 'The SMB service on SRV-FILE is still not accepting connections.',
    hints: () => [
      "Does the name resolve and the server answer ping? From a design PC: 'nslookup files.corp.local', 'ping files.corp.local', then 'tnc files.corp.local -Port 445'.",
      "Ping works but TCP 445 fails → the service, not the network. On SRV-FILE check 'systemctl status smbd' or 'ss -tulpn'.",
      "'sudo systemctl restart smbd' (or Services → Restart).",
    ],
    manual: ['servers', 'ports'],
    rootCause: () => 'The Samba daemon (smbd) on SRV-FILE had exited after an update.',
    fix: () => "'sudo systemctl restart smbd'.",
    solution: () => [{ act: 'restart-service', dev: 'srv-file', args: { svc: 'smbd' } }],
  },
  {
    id: 'server-disk-full',
    name: 'GitLab server disk full',
    category: 'Services',
    severity: 2,
    minDay: 2,
    weight: 0.6,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const srv = h.dev('srv-git').server!;
      const s = srv.services.find((x) => x.id === 'gitlab')!;
      if (!s.running) return null;
      srv.diskUsedPct = 100;
      s.running = false;
      s.failed = 'disk';
      h.serverLog('srv-git', 'gitlab-runsvdir[933]: puma: ERROR -- : Errno::ENOSPC: No space left on device @ io_write - /var/log/gitlab/puma/puma_stdout.log');
      h.serverLog('srv-git', 'systemd-journald[402]: Failed to write entry (9 items, 412 bytes), ignoring: No space left on device');
      h.serverLog('srv-git', 'systemd[1]: gitlab.service: Failed with result \'exit-code\'.');
      h.invalidate();
      const affected = employeeDevs(h, (r) => r.dept === 'Engineering' || r.dept === 'QA');
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Git pushes fail, CI pages error', symptom: 'Engineers get "HTTP 502" from git.corp.local and pipelines are stuck. Ping to the server works. Someone enabled debug logging on the CI runners last week.', area: 'Engineering & QA' }),
    resolved: (h) => {
      const srv = h.dev('srv-git').server!;
      return srv.diskUsedPct < 95 && srv.services.find((x) => x.id === 'gitlab')!.running;
    },
    whyNot: (h) => (h.dev('srv-git').server!.diskUsedPct >= 95 ? 'SRV-GIT is still out of disk space.' : 'GitLab is not running yet.'),
    hints: () => [
      "The server answers ping, so look at the service. On SRV-GIT: 'systemctl status gitlab' and 'journalctl -u gitlab'.",
      "'No space left on device' — check 'df -h' and 'du -sh /var/log/*'. The systemd journal has grown huge.",
      "Free space with 'sudo journalctl --vacuum-size=500M', then 'sudo systemctl restart gitlab'. (Restarting before freeing space will fail.)",
    ],
    manual: ['servers'],
    rootCause: () => 'Debug-level CI logs filled the root filesystem on SRV-GIT (100%), so GitLab could not write and crashed.',
    fix: () => 'Vacuumed the journal, then restarted GitLab.',
    solution: () => [
      { act: 'free-disk', dev: 'srv-git' },
      { act: 'restart-service', dev: 'srv-git', args: { svc: 'gitlab' } },
    ],
  },
  // ======================================================================== ROUTING / ACL / NAT
  {
    id: 'default-route-missing',
    name: 'Default route removed from the core',
    category: 'Routing',
    severity: 1,
    minDay: 1,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const ios = sw(h, 'core-sw1').ios!;
      const before = ios.routes.length;
      ios.routes = ios.routes.filter((r) => !(r.net === '0.0.0.0' && r.mask === '0.0.0.0'));
      if (ios.routes.length === before) return null;
      configLog(h, 'core-sw1', 'vendor-support on vty2 (10.10.99.60)');
      h.invalidate();
      return { data: {}, affected: employeeDevs(h, () => true) };
    },
    alert: () => ({ title: 'Company-wide Internet outage', symptom: 'Nobody can reach any external site or SaaS app. Internal tools (git, wiki, ERP, file share) still work. The ISP\'s status page shows no problems. A vendor did "routing maintenance" on the core this morning.', area: 'Company-wide' }),
    resolved: (h) => sampleWired(h).every((d) => internetOk(h, d)),
    whyNot: () => 'Wired users still cannot reach the Internet.',
    hints: () => [
      "Internal works, external doesn't. Find where packets stop: 'tracert 8.8.8.8' from a PC.",
      "The trace stops at the core (10.10.x.1). On CORE-SW1: 'show ip route' — is there a 'Gateway of last resort'?",
      "Restore it: 'ip route 0.0.0.0 0.0.0.0 10.0.0.1' (the firewall's inside interface).",
    ],
    manual: ['routing', 'default-gateway'],
    rootCause: () => 'During vendor maintenance the static default route on CORE-SW1 was removed, so traffic to unknown (Internet) destinations was dropped.',
    fix: () => "CORE-SW1: 'ip route 0.0.0.0 0.0.0.0 10.0.0.1'.",
    solution: () => [{ cli: 'core-sw1', cmds: ['enable', 'conf t', 'ip route 0.0.0.0 0.0.0.0 10.0.0.1', 'end'] }],
  },
  {
    id: 'fw-return-route',
    name: 'Firewall return route typo',
    category: 'Routing',
    severity: 1,
    minDay: 3,
    weight: 0.6,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const ios = h.dev('fw-edge').ios!;
      const r = ios.routes.find((x) => x.net === '10.10.0.0' && x.nextHop === '10.0.0.2');
      if (!r) return null;
      r.nextHop = '10.0.0.6';
      configLog(h, 'fw-edge', 'secops on vty0 (10.10.99.58)');
      h.invalidate();
      return { data: {}, affected: employeeDevs(h, () => true) };
    },
    alert: () => ({ title: 'Internet down — ISP says the line is fine', symptom: 'No one can reach the Internet; internal services work. The ISP confirms the circuit is up and passing traffic. Security changed some firewall settings during the lunch break.', area: 'Company-wide' }),
    resolved: (h) => sampleWired(h).every((d) => internetOk(h, d)),
    whyNot: () => 'Replies from the Internet still are not making it back inside.',
    hints: () => [
      "A trace from a PC to 8.8.8.8 dies right after the core — but can the firewall itself ping 8.8.8.8? (Open FW-EDGE and try.)",
      "If the firewall can reach the Internet but users can't, think about the RETURN path. 'show ip route' on FW-EDGE: is there a route back to 10.10.0.0/16?",
      "The route points to 10.0.0.6, which isn't on any connected subnet, so it isn't installed. Replace it: 'no ip route 10.10.0.0 255.255.0.0 10.0.0.6' and 'ip route 10.10.0.0 255.255.0.0 10.0.0.2'.",
    ],
    manual: ['routing', 'nat'],
    rootCause: () => "The firewall's route back to the internal networks (10.10.0.0/16) had a typo in its next hop (10.0.0.6), so it was never installed and return traffic was dropped.",
    fix: () => "FW-EDGE: 'ip route 10.10.0.0 255.255.0.0 10.0.0.2' (and remove the typo).",
    solution: () => [{ cli: 'fw-edge', cmds: ['enable', 'conf t', 'no ip route 10.10.0.0 255.255.0.0 10.0.0.6', 'ip route 10.10.0.0 255.255.0.0 10.0.0.2', 'end'] }],
  },
  {
    id: 'acl-erp-block',
    name: 'ACL change blocks ERP for Finance',
    category: 'ACL/NAT',
    severity: 2,
    minDay: 2,
    weight: 0.8,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const acl = sw(h, 'core-sw1').ios!.acls.find((a) => a.name === 'FIN-IN');
      const e = acl?.entries.find((x) => x.seq === 20);
      if (!e || e.dstPort?.ports[0] !== 443) return null;
      e.dstPort = { op: 'eq', ports: [8443] };
      configLog(h, 'core-sw1', 'secops on vty0 (10.10.99.58)');
      h.invalidate();
      return { data: {}, affected: employeeDevs(h, (r, d) => r.dept === 'Finance' && d.kind === 'pc') };
    },
    alert: () => ({ title: "Finance can't open the ERP", symptom: 'All of Finance gets "This site can\'t be reached" for erp.corp.local. Managers and Reception can use the ERP normally. Security "tightened the finance ACL" yesterday evening.', area: 'Finance (VLAN 40)' }),
    resolved: (h, inc) => inc.affectedDevs.every((d) => h.e.checkService(d, 'erp.corp.local', 'tcp', 443).ok),
    whyNot: () => 'Finance PCs still cannot open the ERP over HTTPS.',
    hints: () => [
      "Works for other VLANs, not Finance → something applies only to VLAN 40. Check 'show ip interface vlan 40' on CORE-SW1 — any ACL?",
      "'show access-lists FIN-IN': look at the entry for 10.10.100.40 and the match counters. Which port does the ERP use (see nslookup / tnc erp.corp.local -Port 443)?",
      "Entry 20 permits port 8443 instead of 443. In 'ip access-list extended FIN-IN': 'no 20', then '20 permit tcp 10.10.40.0 0.0.0.255 host 10.10.100.40 eq 443'.",
    ],
    manual: ['acl', 'ports'],
    rootCause: () => 'FIN-IN entry 20 was changed to permit TCP/8443 instead of 443, so ERP traffic fell through to the "deny internal" line.',
    fix: () => "FIN-IN: '20 permit tcp 10.10.40.0 0.0.0.255 host 10.10.100.40 eq 443'.",
    solution: () => [{ cli: 'core-sw1', cmds: ['enable', 'conf t', 'ip access-list extended FIN-IN', 'no 20', '20 permit tcp 10.10.40.0 0.0.0.255 host 10.10.100.40 eq 443', 'end'] }],
  },
  {
    id: 'nat-acl-wifi',
    name: 'NAT ACL excludes the Wi-Fi subnet',
    category: 'ACL/NAT',
    severity: 2,
    minDay: 3,
    weight: 0.6,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const acl = h.dev('fw-edge').ios!.acls.find((a) => a.name === 'NAT-INSIDE');
      if (!acl || acl.entries.some((e) => e.action === 'deny')) return null;
      acl.entries.unshift({ seq: 5, action: 'deny', proto: 'ip', src: { any: false, ip: '10.10.70.0', wildcard: '0.0.0.255' }, srcPort: null, dst: { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' }, dstPort: null, log: false, hits: 0 });
      configLog(h, 'fw-edge', 'secops on vty0 (10.10.99.58)');
      h.invalidate();
      return { data: {}, affected: Object.values(h.e.net.devices).filter((d) => d.kind === 'laptop').map((d) => d.id) };
    },
    alert: () => ({ title: 'Wi-Fi users: no Internet, internal sites OK', symptom: 'Laptop users on Wi-Fi can open the wiki and ERP but no external websites. Wired desktops are completely fine. Security mentioned "restricting guest Internet access" today.', area: 'Wi-Fi (VLAN 70)' }),
    resolved: (h, inc) => inc.affectedDevs.every((d) => !h.e.isUp(d) || internetOk(h, d) || !h.e.c.wlan.get(d)),
    whyNot: () => 'Wi-Fi clients still cannot reach the Internet.',
    hints: () => [
      "Internal OK, external broken, only for one subnet. Where are private addresses translated to the public IP? (Hint: 'show ip nat translations' on FW-EDGE — any 10.10.70.x?)",
      "NAT only translates sources permitted by the NAT ACL. 'show access-lists NAT-INSIDE' on FW-EDGE.",
      "Entry 5 denies 10.10.70.0/24 from NAT. In 'ip access-list standard NAT-INSIDE' remove it with 'no 5'.",
    ],
    manual: ['nat', 'acl'],
    rootCause: () => 'A deny for 10.10.70.0/24 was inserted at the top of NAT-INSIDE. Wi-Fi traffic left with private source addresses and the ISP dropped it.',
    fix: () => "FW-EDGE NAT-INSIDE: 'no 5'.",
    solution: () => [{ cli: 'fw-edge', cmds: ['enable', 'conf t', 'ip access-list standard NAT-INSIDE', 'no 5', 'end'] }],
  },
  // ======================================================================== WIRELESS / POWER / PERFORMANCE
  {
    id: 'poe-budget',
    name: 'PoE budget exceeded on SW-OFFICE',
    category: 'Physical',
    severity: 2,
    minDay: 2,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      if (h.hasUpgrade('poe-injectors') || h.hasUpgrade('sw-office-upgrade')) return null;
      if (h.e.net.devices['signage-lobby']) return null;
      const s = sw(h, 'sw-office');
      const p = port(h, 'sw-office', 'GigabitEthernet1/0/10');
      const d = h.addRogue({ id: 'signage-lobby', name: 'SIGNAGE-LOBBY', model: 'LG 55" PoE++ digital signage', vendor: 'netgear', swId: 'sw-office', port: 'GigabitEthernet1/0/10', ip: null, mask: null, pos: { ...EQUIP_POS['signage-lobby'] } });
      d.kind = 'iot';
      d.rogue = null;
      d.host = { ...emptyHostLite() };
      d.poeW = 60;
      p.shutdown = false;
      p.accessVlan = 50;
      p.description = 'Lobby signage (Facilities ticket FAC-2211)';
      configLog(h, s.id, 'helpdesk on vty0 (10.10.99.52)');
      h.invalidate();
      const affected = Object.values(h.e.net.devices).filter((x) => x.kind === 'laptop' && x.ownerId === 'm-dwhitfield').map((x) => x.id);
      return { data: {}, affected };
    },
    alert: () => ({ title: 'Wi-Fi dead in meeting rooms & reception', symptom: "No Wi-Fi in Atlas, Borealis, the manager's office or reception since mid-morning. Engineering and Design Wi-Fi are fine. Facilities installed a new digital sign in the lobby today.", area: 'Meeting rooms · Reception · Manager office' }),
    resolved: (h) => h.e.isUp('ap-mtg') && h.e.isUp('ap-lobby'),
    whyNot: () => 'AP-MTG and/or AP-LOBBY still have no power.',
    hints: () => [
      'Which APs cover those areas? AP-MTG and AP-LOBBY — both hang off SW-OFFICE. Are they powered? (Their LEDs in the office view; the AP panels.)',
      "On SW-OFFICE: 'show power inline' — compare Available vs Used, and look for ports in a 'faulty'/denied state. 'show logging' shows ILPOWER messages.",
      "The new 60 W sign on Gi1/0/10 consumed the remaining PoE budget. Free power with 'power inline never' on Gi1/0/10 (it can use its own power adapter), or buy PoE injectors / a bigger switch.",
    ],
    manual: ['poe', 'wireless'],
    rootCause: () => 'A 60 W PoE++ digital sign was enabled on SW-OFFICE Gi1/0/10. The 110 W budget ran out and the switch denied power to AP-MTG and AP-LOBBY.',
    fix: () => "'power inline never' on Gi1/0/10 (sign uses its own PSU) — or PoE injectors / switch upgrade.",
    solution: () => [{ cli: 'sw-office', cmds: ['enable', 'conf t', 'int gi1/0/10', 'power inline never', 'end'] }, { wait: 6 }],
  },
  {
    id: 'ap-interference',
    name: 'Co-channel interference from a neighbour\'s AP',
    category: 'Wireless',
    severity: 3,
    minDay: 1,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const ap = h.dev('ap-dsgn');
      if (h.e.net.wireless.foreign.length) return null;
      h.e.net.wireless.foreign.push({ id: 'nbr1', ssid: 'Northwind-Guest', channel: ap.ap!.channel, pos: { x: ap.pos.x + 3 * T, y: -2 * T }, strength: 1 });
      h.invalidate();
      const affected = Object.values(h.e.net.devices).filter((d) => d.kind === 'laptop' && (d.ownerId?.startsWith('d-') ?? false)).map((d) => d.id);
      return { data: { channel: ap.ap!.channel }, affected };
    },
    alert: () => ({ title: 'Design: Wi-Fi very slow, calls freezing', symptom: 'Designers on laptops say Wi-Fi is "connected, full bars" but painfully slow and video calls keep freezing. Wired desktops nearby are fine. A new company moved in upstairs last week.', area: 'Design Wi-Fi' }),
    resolved: (h) => {
      const w = [...h.e.c.wlan.values()].filter((x) => x.ap === 'ap-dsgn');
      const intf = w.length ? Math.max(...w.map((x) => x.interference)) : 0;
      return intf < 0.3;
    },
    whyNot: () => 'Interference on AP-DSGN\'s channel is still high.',
    hints: () => [
      "On a design laptop: 'netsh wlan show interfaces' (signal is fine?) and 'netsh wlan show networks' — which other networks are visible and on which channels?",
      'A strong foreign network shares AP-DSGN\'s channel. In 2.4 GHz only channels 1, 6 and 11 don\'t overlap.',
      'Open AP-DSGN → Wireless and move it to another non-overlapping channel (1, 6 or 11) that the foreign network isn\'t using. The Wi-Fi map layer shows your own APs\' channels so you can avoid them too.',
    ],
    manual: ['wireless'],
    rootCause: (inc) => `A neighbouring business installed a high-power AP ("Northwind-Guest") on channel ${data(inc).channel} — the same channel as AP-DSGN — causing heavy co-channel interference.`,
    fix: () => 'Moved AP-DSGN to a free non-overlapping channel.',
    solution: () => [{ act: 'ap-set', dev: 'ap-dsgn', args: { channel: 1 } }],
  },
  {
    id: 'backup-congestion',
    name: 'Offsite backup saturating the Internet circuit',
    category: 'Performance',
    severity: 2,
    minDay: 2,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      const srv = h.dev('srv-backup').server!;
      const s = srv.services.find((x) => x.id === 'backup')!;
      if (h.e.net.flows.some((f) => f.kind === 'backup')) return null;
      srv.backupWindow = { startHour: 9, endHour: 17 };
      srv.cpuPct = 78;
      s.running = true;
      h.addFlow({ id: 'backup-1', src: 'srv-backup', dstIp: '34.117.59.81', proto: 'tcp', port: 443, mbps: h.e.net.ispMbps * 0.97, label: 'restic backup → backup.cloudvault.io', kind: 'backup' });
      h.serverLog('srv-backup', 'restic-backup[2201]: starting full snapshot of /srv/vm-images (1.9 TiB) → s3:backup.cloudvault.io/brightloop');
      h.serverLog('srv-backup', 'restic-backup[2201]: schedule override: window 09:00-17:00 (set by jlee)');
      return { data: {}, affected: employeeDevs(h, () => true) };
    },
    alert: () => ({ title: 'Everyone: Internet painfully slow', symptom: 'Video calls drop and SaaS apps crawl for every department. Internal tools feel normal. No changes were made to the network. Backups were "moved to a better schedule" yesterday.', area: 'Company-wide' }),
    tick(h) {
      const s = h.dev('srv-backup').server!.services.find((x) => x.id === 'backup')!;
      const has = h.e.net.flows.some((f) => f.kind === 'backup');
      if (!s.running && has) h.removeFlows((f) => f.kind === 'backup');
      for (const f of h.e.net.flows) if (f.kind === 'backup') f.mbps = h.e.net.ispMbps * 0.97;
    },
    resolved: (h) => h.e.wanUtil() < 0.85,
    whyNot: (h) => `The Internet circuit is still ${Math.round(h.e.wanUtil() * 100)}% utilised.`,
    hints: () => [
      "Slow Internet for everyone, internal OK → look at the Internet edge. On FW-EDGE: 'show interfaces gi0/0/0' — check txload and the output rate.",
      "The circuit is full. Who is sending? 'show ip nat translations' on FW-EDGE shows many sessions from 10.10.100.50 to 34.117.59.81:443.",
      "10.10.100.50 is SRV-BACKUP. Stop or reschedule the job: 'sudo systemctl stop restic-backup' (or the server panel). A bigger circuit won't help — the backup fills any pipe.",
    ],
    manual: ['congestion', 'nat', 'servers'],
    rootCause: () => "SRV-BACKUP's offsite backup window was changed to business hours; a full 1.9 TiB snapshot saturated the 500 Mb/s Internet circuit.",
    fix: () => 'Stopped the backup job and restored the overnight window.',
    solution: () => [{ act: 'stop-service', dev: 'srv-backup', args: { svc: 'restic-backup' } }],
    cleanup(h) {
      h.removeFlows((f) => f.kind === 'backup');
      const srv = h.dev('srv-backup').server!;
      srv.backupWindow = { startHour: 1, endHour: 5 };
      srv.cpuPct = 18;
    },
  },
  {
    id: 'isp-outage',
    name: 'ISP upstream outage',
    category: 'Routing',
    severity: 1,
    minDay: 3,
    weight: 0.35,
    detect: 'monitoring',
    workHoursOnly: true,
    inject(h) {
      if (h.e.net.ispOutage) return null;
      h.e.net.ispOutage = true;
      h.e.net.ispTicketOpen = false;
      h.s.ispRestoreAt = h.now + range(h.rng, 200, 260);
      h.invalidate();
      return { data: {}, affected: h.hasUpgrade('lte-backup') ? [] : employeeDevs(h, () => true) };
    },
    alert: (h) => ({
      title: h.hasUpgrade('lte-backup') ? 'ISP circuit down — running on LTE backup' : 'Internet circuit down',
      symptom: h.hasUpgrade('lte-backup') ? 'Monitoring: the primary ISP path is down. The LTE backup is carrying traffic at reduced speed. Get the ISP to fix the circuit.' : 'Monitoring: probes to 8.8.8.8 and 1.1.1.1 failing from all sites. The ISP gateway (203.0.113.1) still answers ping.',
      area: 'Company-wide (Internet)',
    }),
    checklist: () => [
      { id: 'locate', text: 'Confirm the fault is beyond your edge (traceroute from FW-EDGE)' },
      { id: 'ticket', text: 'Open a ticket with the ISP (ISP-GW panel)' },
      { id: 'comms', text: 'Send the manager a status update' },
      { id: 'verify', text: 'Verify Internet access once the ISP restores service' },
    ],
    checkItem(h, inc, id) {
      if (id === 'locate') return (data(inc)._viewed ?? []).includes('fw-edge') || h.e.net.ispTicketOpen;
      if (id === 'ticket') return h.e.net.ispTicketOpen;
      if (id === 'comms') return inc.statusUpdates > 0;
      return !h.e.net.ispOutage;
    },
    resolved: (h) => !h.e.net.ispOutage && h.e.net.ispTicketOpen,
    whyNot: (h) => (h.e.net.ispOutage ? 'The ISP has not restored the circuit yet. Did you open a ticket with them?' : 'Service is back, but the ISP ticket was never opened (open it so the RFO is tracked).'),
    hints: () => [
      "Check your own edge first: can FW-EDGE ping 203.0.113.1 (the ISP gateway)? Can it ping 8.8.8.8? 'traceroute 8.8.8.8' from FW-EDGE.",
      'Your side is fine up to the ISP gateway; the fault is in the provider network. Nothing to reconfigure — escalate.',
      'Open the ISP-GW device panel and click "Open ticket with ISP", then keep the manager informed with a status update from the incident card.',
    ],
    manual: ['isp', 'troubleshooting-method'],
    rootCause: () => 'A fiber cut in the provider\'s metro network took the Internet circuit down. Nothing was wrong on the company side.',
    fix: () => 'Escalated to the ISP, communicated status, verified service after restoration.',
    solution: () => [{ act: 'isp-ticket', dev: 'isp-gw' }, { wait: 50 }],
  },
  // ======================================================================== SECURITY
  {
    id: 'malware-c2',
    name: 'Compromised endpoint beaconing to C2',
    category: 'Security',
    security: true,
    severity: 1,
    minDay: 1,
    weight: 0.75,
    detect: 'ids',
    workHoursOnly: false,
    inject(h) {
      const cands = wired(h, (r) => r.dept !== 'Management');
      if (!cands.length) return null;
      const t = pick(h.rng, cands);
      const bad = pick(
        h.rng,
        INTERNET_HOSTS.filter((x) => x.malicious),
      );
      const port = pick(h.rng, bad.tcp);
      const proc = pick(h.rng, ['svch0st.exe', 'OneDriveUpdater64.exe', 'WinDefendHelper.exe', 'chrome_updater.exe', 'TeamsUpdate32.exe']);
      t.d.pc!.compromised = true;
      t.d.pc!.malware = { proc, c2Ip: bad.ip, c2Port: port, since: h.now };
      h.addFlow({ id: `c2-${t.d.id}`, src: t.d.id, dstIp: bad.ip, proto: 'tcp', port, mbps: 0.3, label: `beacon → ${bad.name}`, kind: 'c2' });
      h.invalidate();
      const ip = t.d.ifaces[0].ip;
      h.e.log('fw-edge', `%FW-6-SESS_AUDIT_TRAIL_START: (target:class)-(INSIDE:OUTSIDE) Start tcp session: initiator (${ip}:51734) -- responder (${bad.ip}:${port})`);
      if (h.hasUpgrade('ids')) {
        const acl = h.dev('fw-edge').ios!.acls.find((a) => a.name === 'INSIDE-OUT')!;
        if (!acl.entries.some((e) => e.dst.ip === bad.ip)) acl.entries.unshift({ seq: 2, action: 'deny', proto: 'ip', src: { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' }, srcPort: null, dst: { any: false, ip: bad.ip, wildcard: '0.0.0.0' }, dstPort: null, log: true, hits: 0, remark: 'IPS auto-block (threat intel)' });
        h.invalidate();
      }
      return { data: { dev: t.d.id, ip, c2: bad.ip, c2name: bad.name, port, proc }, affected: [t.d.id] };
    },
    alert(h, inc) {
      const d = data(inc);
      const ap = h.accessPort(d.dev);
      const who = h.hasUpgrade('ids') && ap ? `${h.dev(d.dev).name} on ${ap.sw.name} ${shortIf(ap.port.name)}` : `internal host ${d.ip}`;
      return {
        title: 'IDS: command-and-control beaconing',
        symptom: `The IDS flagged periodic HTTPS sessions every ~60 s from ${who} to ${d.c2} (${d.c2name}), a domain on threat-intel lists for malware C2. Beacon interval jitter ±2 s.${h.hasUpgrade('ids') ? ' The IPS auto-blocked the C2 address at the edge.' : ''}`,
        area: h.hasUpgrade('ids') ? `${h.ownerOf(d.dev)?.dept} · ${h.dev(d.dev).name}` : `Unknown host ${d.ip}`,
      };
    },
    checklist: () => [
      { id: 'identify', text: 'Identify the infected host (IP → MAC → switch port → desk)' },
      { id: 'contain', text: 'Contain it (shut its port, quarantine VLAN 999, or EDR isolate)' },
      { id: 'block', text: 'Block the C2 address on FW-EDGE (INSIDE-OUT ACL)' },
      { id: 'eradicate', text: 'Eradicate: EDR scan or re-image the PC' },
      { id: 'recover', text: 'Recover: return the user to the network' },
    ],
    checkItem(h, inc, id) {
      const d = data(inc);
      const pc = h.e.net.devices[d.dev];
      const contained = (() => {
        if (!pc) return true;
        if (pc.pc?.edrIsolated) return true;
        const ap = h.accessPort(d.dev);
        return !ap || ap.port.shutdown || ap.port.accessVlan === 999 || !h.e.oper(ap.port).up;
      })();
      if (id === 'identify') return (d._viewed ?? []).includes(d.dev) || contained;
      if (id === 'contain') return contained || !!d._contained;
      if (id === 'block') return fwBlocks(h, d.ip, d.c2, 'tcp', d.port);
      if (id === 'eradicate') return !!pc && !pc.pc?.compromised && !(d.second && h.e.net.devices[d.second]?.pc?.compromised);
      return !!pc && !pc.pc?.compromised && !pc.pc?.edrIsolated && h.hostOnline(d.dev);
    },
    tick(h, inc) {
      const d = data(inc);
      const pc = h.e.net.devices[d.dev];
      if (!pc) return;
      if (this.checkItem!(h, inc, 'contain')) d._contained = true;
      if (pc.pc?.compromised && Math.floor(h.now) % 2 === 0) {
        const f = h.e.net.flows.find((x) => x.id === `c2-${d.dev}`);
        if (f && !f.blockedAt) h.e.log('fw-edge', `%FW-6-SESS_AUDIT_TRAIL_START: (target:class)-(INSIDE:OUTSIDE) Start tcp session: initiator (${d.ip}:${51000 + (Math.floor(h.now) % 900)}) -- responder (${d.c2}:${d.port})`);
        else if (f?.blockedAt === 'fw-edge') h.e.log('fw-edge', `%SEC-6-IPACCESSLOGP: list INSIDE-OUT denied tcp ${d.ip}(${51000 + (Math.floor(h.now) % 900)}) -> ${d.c2}(${d.port}), 1 packet`);
      }
      if (!pc.pc?.compromised) h.removeFlows((f) => f.id === `c2-${d.dev}` || (f.src === d.dev && f.kind === 'scan'));
      if (d.second) {
        const s2 = h.e.net.devices[d.second];
        if (s2 && !s2.pc?.compromised) h.removeFlows((f) => f.id === `c2-${d.second}`);
      }
    },
    escalate(h, inc, level) {
      const d = data(inc);
      const pc = h.e.net.devices[d.dev];
      if (!pc?.pc?.compromised || d._contained) return null;
      if (level === 1) {
        const others = wired(h, (r, dev) => dev.id !== d.dev && dev.ifaces[0].ip?.split('.')[2] === d.ip.split('.')[2]);
        const t = others.length ? pick(h.rng, others) : null;
        h.addFlow({ id: `scan-${d.dev}`, src: d.dev, dstIp: '10.10.100.20', proto: 'tcp', port: 445, mbps: 3, label: 'SMB scan', kind: 'scan' });
        if (t) {
          t.d.pc!.compromised = true;
          t.d.pc!.malware = { ...pc.pc.malware!, since: h.now };
          h.addFlow({ id: `c2-${t.d.id}`, src: t.d.id, dstIp: d.c2, proto: 'tcp', port: d.port, mbps: 0.3, label: 'beacon', kind: 'c2' });
          d.second = t.d.id;
          inc.affectedDevs.push(t.d.id);
          return `Lateral movement: ${pc.name} is scanning SMB (TCP 445) and a second host, ${t.d.name}, has started beaconing to the same C2. Re-image both.`;
        }
        return `Lateral movement: ${pc.name} is now scanning internal hosts on TCP 445.`;
      }
      if (level === 2) {
        h.s.satisfaction = Math.max(0, h.s.satisfaction - 12);
        return 'Data exfiltration: ~2.3 GB was uploaded from the infected host to the C2 server. Legal and the CEO have been informed.';
      }
      return null;
    },
    resolved(h, inc) {
      const d = data(inc);
      const pc = h.e.net.devices[d.dev];
      const second = d.second ? h.e.net.devices[d.second] : null;
      return !!pc && !pc.pc?.compromised && !(second?.pc?.compromised) && fwBlocks(h, d.ip, d.c2, 'tcp', d.port) && !pc.pc?.edrIsolated && h.hostOnline(d.dev);
    },
    whyNot(h, inc) {
      const d = data(inc);
      const pc = h.e.net.devices[d.dev];
      if (pc?.pc?.compromised) return 'The infected PC has not been cleaned yet.';
      if (d.second && h.e.net.devices[d.second]?.pc?.compromised) return 'The second (laterally infected) PC is still compromised.';
      if (!fwBlocks(h, d.ip, d.c2, 'tcp', d.port)) return `${d.c2} is not blocked at the edge firewall.`;
      return 'The user has not been returned to the network yet (port still shut / quarantined / isolated).';
    },
    hints: (inc) => {
      const d = data(inc);
      return [
        `You only have an IP (${d.ip}). Find its MAC: 'show ip arp ${d.ip}' on CORE-SW1. Then 'show mac address-table address <mac>' on the core and on the access switch it points to.`,
        'Contain first: shut that access port (or move it to VLAN 999 "QUARANTINE"). On the PC itself, \'netstat -ano\' and \'tasklist\' reveal the suspicious process.',
        `Block the C2 for every host: on FW-EDGE 'ip access-list extended INSIDE-OUT' → '5 deny ip any host ${d.c2}'. Re-image (or EDR-scan) the PC, then restore its port.`,
      ];
    },
    manual: ['incident-response', 'malware', 'mac-table', 'acl'],
    rootCause: (inc, h) => `${h.ownerOf(data(inc).dev)?.name ?? 'A user'} opened a phishing attachment; malware (${data(inc).proc}) beaconed to ${data(inc).c2name} (${data(inc).c2}).`,
    fix: () => 'Identified the host via ARP/MAC tables, contained it, blocked the C2 at the firewall, re-imaged and restored the PC.',
    solution: (inc) => [
      { cli: 'fw-edge', cmds: ['enable', 'conf t', 'ip access-list extended INSIDE-OUT', `5 deny ip any host ${data(inc).c2}`, 'end'] },
      { act: 'reimage', dev: data(inc).dev },
      { wait: 50 },
    ],
  },
  {
    id: 'rogue-dhcp',
    name: 'Rogue DHCP server (consumer router)',
    category: 'Security',
    security: true,
    severity: 2,
    minDay: 2,
    weight: 0.7,
    detect: 'users',
    workHoursOnly: true,
    inject(h) {
      if (h.e.net.devices['rogue-tplink']) return null;
      const p = port(h, 'sw-dqa', 'GigabitEthernet1/0/15');
      p.shutdown = false;
      p.accessVlan = 30;
      p.description = 'QA-BENCH test bench (temp - device testing)';
      h.addRogue({ id: 'rogue-tplink', name: 'UNKNOWN-DEVICE', model: 'TP-Link Archer AX55 (consumer router)', vendor: 'tplink', swId: 'sw-dqa', port: 'GigabitEthernet1/0/15', ip: '192.168.0.1', mask: '255.255.255.0', dhcp: { net: '192.168.0.0', mask: '255.255.255.0', gw: '192.168.0.1', dns: '192.168.0.1' }, pos: { ...EQUIP_POS['rogue-tplink'] } });
      h.invalidate();
      const qa = employeeDevs(h, (r, d) => r.dept === 'QA' && d.kind === 'pc');
      h.forceRenew(qa);
      let affected = qa.filter((d) => h.dev(d).ifaces[0].ip?.startsWith('192.168.'));
      if (!affected.length && qa.length) {
        // guarantee at least one victim
        const v = qa[0];
        const hh = h.dev(v).host!;
        const i = h.dev(v).ifaces[0];
        Object.assign(hh, { ip: '192.168.0.142', mask: '255.255.255.0', gateway: '192.168.0.1', dns: ['192.168.0.1'], dhcpServer: '192.168.0.1', leaseObtained: h.now, leaseExpires: h.now + 1440, domain: 'lan' });
        i.ip = '192.168.0.142';
        i.mask = '255.255.255.0';
        h.invalidate();
        affected = [v];
      }
      return { data: { sw: 'sw-dqa', port: 'GigabitEthernet1/0/15', rogue: 'rogue-tplink' }, affected };
    },
    tick(h, inc) {
      // more PCs may pick up a rogue lease as they renew — they belong to this incident
      for (const d of h.hostsInVlan(30)) if (d.ifaces[0].ip?.startsWith('192.168.') && !inc.affectedDevs.includes(d.id)) inc.affectedDevs.push(d.id);
    },
    alert: (h, inc) => ({ title: 'QA: machines losing network, odd 192.168.0.x address', symptom: `${names(h, inc.affectedDevs)} lost access to everything after restarting. One of them noticed their IP is now 192.168.0.something. Someone brought "test equipment" to the QA bench this morning.`, area: 'QA (VLAN 30)' }),
    checklist: () => [
      { id: 'find', text: 'Find where the rogue DHCP server is connected' },
      { id: 'contain', text: 'Disconnect it (shut the port or remove the device)' },
      { id: 'recover', text: 'Get affected PCs to renew a correct 10.10.30.x lease' },
      { id: 'harden', text: 'Optional: enable DHCP snooping on SW-DQA (VLAN 30, uplink trusted)' },
    ],
    checkItem(h, inc, id) {
      const d = data(inc);
      const gone = !h.e.net.devices[d.rogue] || port(h, d.sw, d.port).shutdown;
      if (id === 'find') return gone || (d._viewed ?? []).includes(d.rogue);
      if (id === 'contain') return gone;
      if (id === 'recover') return allOnline(h, inc.affectedDevs);
      const sn = h.dev('sw-dqa').ios!.dhcpSnooping;
      return sn.enabled && sn.vlans.includes(30) && port(h, 'sw-dqa', 'GigabitEthernet1/1/1').dhcpSnoopTrust;
    },
    resolved(h, inc) {
      const d = data(inc);
      const gone = !h.e.net.devices[d.rogue] || port(h, d.sw, d.port).shutdown || !h.e.oper(port(h, d.sw, d.port)).up;
      return gone && allOnline(h, inc.affectedDevs) && inc.affectedDevs.every((x) => h.dev(x).ifaces[0].ip?.startsWith('10.10.30.'));
    },
    whyNot(h, inc) {
      const d = data(inc);
      if (h.e.net.devices[d.rogue] && !port(h, d.sw, d.port).shutdown) return 'The rogue DHCP server is still connected.';
      return whyOffline(h, inc.affectedDevs) || 'Some PCs still hold a 192.168.0.x lease — they must renew.';
    },
    hints: () => [
      "On an affected PC: 'ipconfig /all'. Who is the DHCP server? Which gateway did it hand out?",
      "Find the rogue's MAC: 'arp -a' on the PC (192.168.0.1). The OUI (first half) identifies the vendor. Then 'show mac address-table address <mac>' on SW-DQA.",
      "It's on SW-DQA Gi1/0/15 (the QA bench wall port). Shut that port or remove the device, then have the PCs renew. Prevent repeats with DHCP snooping ('ip dhcp snooping', 'ip dhcp snooping vlan 30', 'ip dhcp snooping trust' on the uplink).",
    ],
    manual: ['rogue-devices', 'dhcp', 'dhcp-snooping', 'mac-table'],
    rootCause: () => 'A consumer router was plugged into the QA bench wall port with its LAN side facing the network. Its DHCP server answered faster than the real one and handed out 192.168.0.x addresses.',
    fix: () => 'Shut SW-DQA Gi1/0/15 / removed the router; clients renewed. (DHCP snooping prevents a repeat.)',
    solution: (inc) => [{ cli: 'sw-dqa', cmds: ['enable', 'conf t', 'int gi1/0/15', 'shutdown', 'end'] }, { renew: inc.affectedDevs }],
  },
  {
    id: 'rogue-scanner',
    name: 'Unknown device scanning the network',
    category: 'Security',
    security: true,
    severity: 2,
    minDay: 1,
    weight: 0.6,
    detect: 'ids',
    workHoursOnly: false,
    inject(h) {
      if (h.e.net.devices['rogue-pi']) return null;
      const p = port(h, 'sw-office', 'GigabitEthernet1/0/14');
      if (p.shutdown) return null;
      const d = h.addRogue({ id: 'rogue-pi', name: 'UNKNOWN-DEVICE', model: 'Raspberry Pi 4 (unknown owner)', vendor: 'rpi', swId: 'sw-office', port: 'GigabitEthernet1/0/14', ip: null, mask: null, pos: { ...EQUIP_POS['rogue-pi'] } });
      d.host = { ...emptyHostLite(), dhcp: true };
      h.invalidate();
      h.forceRenew([d.id]);
      const ip = d.ifaces[0].ip ?? '10.10.50.0';
      h.addFlow({ id: 'scan-pi', src: d.id, dstIp: '10.10.100.20', proto: 'tcp', port: 445, mbps: 4, label: 'nmap scan', kind: 'scan' });
      return { data: { rogue: d.id, ip, sw: 'sw-office', port: 'GigabitEthernet1/0/14' }, affected: [] };
    },
    alert: (h, inc) => ({ title: 'IDS: internal port scan detected', symptom: `The IDS sees ${data(inc).ip} sweeping the server VLAN (TCP 22, 80, 443, 445, 3389) — over 4,000 connection attempts in 5 minutes. The address isn't assigned to any known asset.`, area: h.hasUpgrade('ids') ? 'Meeting room Atlas · SW-OFFICE Gi1/0/14' : `Office VLAN 50 (${data(inc).ip})` }),
    resolved(h, inc) {
      const d = data(inc);
      return !h.e.net.devices[d.rogue] || port(h, d.sw, d.port).shutdown;
    },
    whyNot: () => 'The scanning device is still connected to the network.',
    hints: (inc) => [
      `Start from the IP: on CORE-SW1 'show ip arp ${data(inc).ip}' gives the MAC. Is it a vendor you recognise?`,
      "Follow the MAC: 'show mac address-table address <mac>' on CORE-SW1 (→ uplink to SW-OFFICE), then on SW-OFFICE.",
      `It's on SW-OFFICE Gi1/0/14 — the Atlas meeting room wall port (ATL-02). Shut the port and/or physically remove the device.`,
    ],
    manual: ['rogue-devices', 'mac-table', 'incident-response'],
    rootCause: () => 'An unidentified Raspberry Pi had been hidden behind the TV in meeting room Atlas and was running network scans.',
    fix: () => 'Located it via ARP/MAC tables, shut SW-OFFICE Gi1/0/14 and removed the device.',
    solution: () => [{ act: 'remove-device', dev: 'rogue-pi' }],
    cleanup(h) {
      h.removeFlows((f) => f.id === 'scan-pi');
    },
  },
  {
    id: 'dos-flood',
    name: 'SYN flood against the customer portal',
    category: 'Security',
    security: true,
    severity: 1,
    minDay: 3,
    weight: 0.5,
    detect: 'monitoring',
    workHoursOnly: false,
    inject(h) {
      if (h.e.net.flows.some((f) => f.kind === 'dos')) return null;
      // a state-exhaustion SYN flood: hurts the firewall CPU far more than the pipe
      const mbps = h.e.net.ispMbps * 0.36;
      h.addFlow({ id: 'dos-1', src: 'internet', srcIp: '198.51.100.23', dstIp: '203.0.113.2', proto: 'tcp', port: 443, mbps, label: 'SYN flood', kind: 'dos' });
      h.addFlow({ id: 'dos-2', src: 'internet', srcIp: '198.51.100.87', dstIp: '203.0.113.2', proto: 'tcp', port: 443, mbps: mbps * 0.5, label: 'SYN flood', kind: 'dos' });
      h.e.log('fw-edge', '%FW-4-HALFOPEN_ENTRIES_EXCEEDED: Half-open sessions in zone OUTSIDE exceeded threshold (10000)');
      if (h.hasUpgrade('ddos')) {
        h.e.net.ispUpstreamFilter = true;
      }
      return { data: {}, affected: h.hasUpgrade('ddos') ? [] : employeeDevs(h, () => true) };
    },
    alert: (h) => ({
      title: h.hasUpgrade('ddos') ? 'DDoS attack mitigated upstream' : 'Edge firewall overloaded — inbound flood',
      symptom: h.hasUpgrade('ddos') ? 'The scrubbing service is filtering a SYN flood aimed at 203.0.113.2:443. Confirm the firewall is healthy and close the incident.' : 'FW-EDGE CPU is pegged near 100%. Internet access is sluggish for everyone and the customer portal (203.0.113.2:443) is timing out. Firewall logs show thousands of half-open TCP sessions.',
      area: 'Internet edge',
    }),
    tick(h, inc) {
      if (Math.floor(h.now) % 2 === 0) {
        for (const f of h.e.net.flows.filter((x) => x.kind === 'dos')) {
          if (f.blockedAt) h.e.log('fw-edge', `%SEC-6-IPACCESSLOGP: list OUTSIDE-IN denied tcp ${f.srcIp}(${40000 + (Math.floor(h.now) % 999)}) -> 203.0.113.2(443), ${8000 + (Math.floor(h.now) % 3000)} packets`);
          else h.e.log('fw-edge', `%FW-4-HALFOPEN_ENTRIES_EXCEEDED: Half-open sessions from ${f.srcIp} exceeded threshold`);
        }
      }
      void inc;
    },
    escalate(h, inc, level) {
      if (level !== 1) return null;
      for (const f of h.e.net.flows) if (f.kind === 'dos') f.mbps *= 1.3;
      return 'The flood intensified (attackers added bandwidth).';
    },
    resolved: (h) => h.e.fwOverload < 0.08 && h.e.net.flows.filter((f) => f.kind === 'dos').every((f) => f.blockedAt || h.e.net.ispUpstreamFilter),
    whyNot: (h) => `FW-EDGE is still overloaded (CPU ${h.e.fwCpu}%).`,
    hints: () => [
      "Look at the firewall: 'show processes cpu' and 'show logging' on FW-EDGE. Which sources and which destination?",
      "The flood comes from 198.51.100.0/24 to 203.0.113.2:443 and is permitted by OUTSIDE-IN entry 10. 'show access-lists OUTSIDE-IN' shows the hit counters.",
      "Insert a deny ABOVE the permit: 'ip access-list extended OUTSIDE-IN' → '5 deny ip 198.51.100.0 0.0.0.255 any'. (Or request upstream filtering from the ISP in the ISP-GW panel.)",
    ],
    manual: ['dos', 'acl'],
    rootCause: () => 'A SYN flood from 198.51.100.0/24 targeted the customer portal published on 203.0.113.2:443, exhausting the firewall\'s session table and CPU.',
    fix: () => "OUTSIDE-IN: '5 deny ip 198.51.100.0 0.0.0.255 any' (and/or upstream filtering).",
    solution: () => [{ cli: 'fw-edge', cmds: ['enable', 'conf t', 'ip access-list extended OUTSIDE-IN', '5 deny ip 198.51.100.0 0.0.0.255 any', 'end'] }, { wait: 2 }],
    cleanup(h) {
      h.removeFlows((f) => f.kind === 'dos');
      h.e.net.ispUpstreamFilter = false;
    },
  },
];

/** Generic incident for outages that no injected scenario explains (often caused by the player's own changes). */
export const COLLATERAL: ScenarioDef = {
  id: 'collateral',
  name: 'Users report an outage',
  category: 'Change',
  severity: 3,
  minDay: 0,
  weight: 0,
  detect: 'users',
  workHoursOnly: false,
  inject: () => null,
  alert(h, inc) {
    const d = data(inc);
    const ch = (d.changes as string[] | undefined) ?? [];
    return {
      title: ch.length ? 'Users lost connectivity right after a change' : 'Users report connectivity problems',
      symptom: `${names(h, inc.affectedDevs)} report they can't work${ch.length ? `. It started minutes after these changes: ${ch.slice(-3).join('; ')}` : ''}.`,
      area: [...new Set(inc.affectedDevs.map((x) => h.ownerOf(x)?.dept ?? h.dev(x)?.zone))].join(', '),
    };
  },
  resolved: (h, inc) => inc.affectedDevs.every((d) => !h.e.net.devices[d] || h.hostHealthy(d)),
  whyNot: (h, inc) => {
    const bad = inc.affectedDevs.filter((d) => h.e.net.devices[d] && !h.hostHealthy(d));
    return `${names(h, bad)} still can't use all of their services.`;
  },
  hints: () => [
    "If this started right after you changed something, undo or re-check that change first ('show running-config', compare with 'show startup-config').",
    'Work through the layers from one affected PC: link (ipconfig) → IP/gateway (ping gateway) → DNS (nslookup) → service (tnc host -Port n).',
    "Check the event feed for your recent changes: the device and command are listed there.",
  ],
  manual: ['troubleshooting-method', 'change-management'],
  rootCause: (inc) => ((data(inc).changes as string[] | undefined)?.length ? `A configuration change made during troubleshooting (${(data(inc).changes as string[]).slice(-2).join('; ')}) caused collateral damage.` : 'A secondary fault left these users without full connectivity.'),
  fix: () => 'Restored connectivity for the affected users.',
  solution: () => [],
};

function emptyHostLite() {
  return {
    dhcp: false,
    ip: null,
    mask: null,
    gateway: null,
    dns: [] as string[],
    staticIp: '',
    staticMask: '',
    staticGateway: '',
    staticDns: [] as string[],
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


export function scenarioById(id: string): ScenarioDef | undefined {
  if (id === 'collateral') return COLLATERAL;
  return SCENARIOS.find((s) => s.id === id);
}

