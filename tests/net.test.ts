import { describe, expect, it } from 'vitest';
import { NetEngine } from '../src/net/engine';
import { dhcpRenew } from '../src/net/hosts';
import { buildNetwork } from '../src/net/topology';
import { ROSTER, SERVICES_BY_DEPT } from '../src/world/roster';
import { cidr, isValidMask, maskToPrefix, wildcardMatch } from '../src/net/ip';
import { normalizeIfName, parseVlanList, formatVlanList } from '../src/net/model';

export function bootNet() {
  const net = buildNetwork();
  const e = new NetEngine(net);
  e.now = 7 * 60;
  for (const d of Object.values(net.devices)) if (d.host?.dhcp && d.kind !== 'server') dhcpRenew(e, d.id);
  return e;
}

describe('ip helpers', () => {
  it('computes masks and wildcards', () => {
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(isValidMask('255.255.0.255')).toBe(false);
    expect(cidr('10.10.10.77', '255.255.255.0')).toBe('10.10.10.0/24');
    expect(wildcardMatch('10.10.40.9', '10.10.40.0', '0.0.0.255')).toBe(true);
    expect(wildcardMatch('10.10.41.9', '10.10.40.0', '0.0.0.255')).toBe(false);
  });
  it('normalises interface names and vlan lists', () => {
    expect(normalizeIfName('gi1/0/5')).toBe('GigabitEthernet1/0/5');
    expect(normalizeIfName('g1/1/1')).toBe('GigabitEthernet1/1/1');
    expect(normalizeIfName('vlan10')).toBe('Vlan10');
    expect(parseVlanList('10,20-22')).toEqual([10, 20, 21, 22]);
    expect(formatVlanList([10, 20, 21, 22, 70])).toBe('10,20-22,70');
  });
});

describe('baseline network', () => {
  it('gives every DHCP client a lease', () => {
    const e = bootNet();
    for (const d of Object.values(e.net.devices)) {
      if (!d.host?.dhcp || d.kind === 'server') continue;
      expect(d.ifaces[0].ip, `${d.name} ip`).toMatch(/^10\.10\./);
    }
  });

  it('lets every employee reach their services', () => {
    const e = bootNet();
    for (const r of ROSTER) {
      const dev = Object.values(e.net.devices).find((d) => d.ownerId === r.id)!;
      expect(dev, r.name).toBeTruthy();
      for (const s of SERVICES_BY_DEPT[r.dept]) {
        const res = e.checkService(dev.id, s.host, s.proto, s.port);
        expect(res.ok, `${r.name} → ${s.host}: ${res.stage} ${res.detail}`).toBe(true);
      }
    }
  });

  it('blocks finance from reaching engineering (ACL) but allows ERP', () => {
    const e = bootNet();
    const fin = 'pc-fin-01';
    expect(e.roundTrip(fin, '10.10.100.30', 'tcp', 443).ok).toBe(false);
    expect(e.roundTrip(fin, '10.10.100.40', 'tcp', 443).ok).toBe(true);
    expect(e.roundTrip(fin, '10.10.40.1', 'icmp', 0).ok).toBe(true);
  });

  it('builds MAC tables that trace a host to its access port', () => {
    const e = bootNet();
    const pc = e.net.devices['pc-eng-01'];
    const table = e.c.macTables.get('sw-eng')!;
    const entry = table.find((m) => m.mac === pc.ifaces[0].mac)!;
    expect(entry.port).toBe('GigabitEthernet1/0/1');
    expect(entry.vlan).toBe(10);
    const core = e.c.macTables.get('core-sw1')!;
    expect(core.find((m) => m.mac === pc.ifaces[0].mac)!.port).toBe('GigabitEthernet1/1/1');
  });

  it('associates laptops to access points', () => {
    const e = bootNet();
    for (const d of Object.values(e.net.devices)) {
      if (d.kind !== 'laptop') continue;
      expect(e.c.wlan.get(d.id), d.name).toBeTruthy();
    }
  });

  it('powers APs from PoE within budget', () => {
    const e = bootNet();
    const p = e.c.poe.get('sw-office')!;
    expect(p.used).toBeLessThanOrEqual(p.budget);
    expect(p.denied).toEqual([]);
    expect(e.isUp('ap-mtg')).toBe(true);
  });

  it('shutting an access port takes the PC offline', () => {
    const e = bootNet();
    e.net.devices['sw-eng'].ifaces.find((i) => i.name === 'GigabitEthernet1/0/1')!.shutdown = true;
    e.invalidate();
    const r = e.checkService('pc-eng-01', 'git.corp.local', 'tcp', 443);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('link');
  });
});
