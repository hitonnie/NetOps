import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/incidents/scenarios';
import { Game } from '../src/sim/game';
import { deskOf } from '../src/world/employees';

function prepare(day: number, seed = 12345): Game {
  const g = Game.create(seed, { tutorial: false, reproducible: true, hintMode: 'earned' });
  g.s.director.nextAt = 1e9;
  g.s.t = day * 1440 + 9 * 60 + 30;
  g.engine.now = g.s.t;
  g.s.meetings = [];
  for (const e of g.s.employees) {
    e.present = true;
    e.state = 'working';
    e.pos = { ...deskOf(e.id).seat };
    e.path = [];
    e.plan = null;
    e.nextDecision = 1e9;
    e.lunchedDay = day;
    e.leave = 2000;
  }
  for (let k = 0; k < 4; k++) {
    g.s.t += 1;
    g.minuteTick();
  }
  g.s.inventory = { cable: 5, fiber: 5, psu: 5 };
  return g;
}

function tick(g: Game, n: number) {
  for (let k = 0; k < n; k++) {
    g.s.t += 1;
    g.minuteTick();
  }
}

describe('baseline simulation', () => {
  it('runs a quiet morning without unexplained outages', () => {
    const g = prepare(1);
    tick(g, 90);
    const unhealthy = g.s.employees.filter((e) => e.present && e.state === 'working' && e.health < 0.75).map((e) => `${e.id}: ${e.healthDetail}`);
    expect(unhealthy).toEqual([]);
    expect(g.s.incidents.filter((i) => i.scenario === 'collateral')).toEqual([]);
    expect(g.s.productivity).toBeGreaterThan(85);
  });
});

describe('every scenario is diagnosable and solvable', () => {
  for (const def of SCENARIOS) {
    it(`${def.id}: inject → symptom → fix → verified`, () => {
      const g = prepare(Math.max(def.minDay, 3));
      const inc = g.spawnScenario(def);
      expect(inc, 'scenario could be injected').toBeTruthy();
      tick(g, 10);
      expect(inc!.status, 'incident opened').toBe('open');
      expect(def.resolved(g, inc!), 'symptom present before the fix').toBe(false);
      g.runSolution(def.solution(inc!, g));
      tick(g, 6);
      const ok = def.resolved(g, inc!);
      expect(ok, `resolved after fix: ${def.whyNot?.(g, inc!) ?? ''}`).toBe(true);
      const r = g.verifyIncident(inc!.id);
      if (inc!.status === 'open') expect(r.ok, r.msg).toBe(true);
      expect(inc!.status).toBe('resolved');
      // the fix should not leave other users broken
      tick(g, 8);
      const collateral = g.s.incidents.filter((i) => i.scenario === 'collateral' && i.status !== 'resolved');
      expect(collateral.map((c) => c.affectedDevs), 'no collateral outage after the canonical fix').toEqual([]);
    });
  }
});

describe('CLI behaviour', () => {
  it('validates IOS input and supports abbreviations', () => {
    const g = prepare(0);
    const sh = g.getShell('sw-eng')!;
    sh.run('sh ip int br');
    expect(sh.lines.some((l) => l.t.startsWith('GigabitEthernet1/0/1 '))).toBe(true);
    sh.run('conf t');
    expect(sh.lines.some((l) => l.t.includes('Invalid input'))).toBe(true);
    sh.run('enable');
    sh.run('conf t');
    expect(sh.prompt()).toBe('SW-ENG(config)#');
    sh.run('int gi1/0/99');
    expect(sh.lines[sh.lines.length - 1].t).toContain('Invalid input');
    sh.run('int gi1/0/11');
    expect(sh.prompt()).toBe('SW-ENG(config-if)#');
    sh.run('switchport access vlan 10');
    sh.run('description New hire');
    sh.run('no shut');
    sh.run('end');
    expect(sh.prompt()).toBe('SW-ENG#');
    const p = g.dev('sw-eng').ifaces.find((i) => i.name === 'GigabitEthernet1/0/11')!;
    expect(p.shutdown).toBe(false);
    expect(p.accessVlan).toBe(10);
    sh.run('show run | include description New');
    expect(sh.lines[sh.lines.length - 1].t).toContain('description New hire');
  });

  it('pings and traces through the network', () => {
    const g = prepare(0);
    const pc = g.getShell('pc-eng-01')!;
    pc.run('ping 10.10.100.30');
    expect(pc.lines.some((l) => l.t.startsWith('Reply from 10.10.100.30'))).toBe(true);
    pc.run('nslookup github.com');
    expect(pc.lines.some((l) => l.t.includes('140.82.112.3'))).toBe(true);
    pc.run('tracert 8.8.8.8');
    expect(pc.lines.some((l) => l.t.includes('Trace complete'))).toBe(true);
    const fin = g.getShell('pc-fin-01')!;
    fin.run('ping 10.10.100.30');
    expect(fin.lines.some((l) => l.t.startsWith('Reply from 10.10.100.30'))).toBe(true); // FIN-IN permits ICMP
    fin.run('tnc git.corp.local -Port 443');
    expect(fin.lines.some((l) => l.t.includes('TcpTestSucceeded : False'))).toBe(true);
    fin.run('tnc erp.corp.local -Port 443');
    expect(fin.lines.some((l) => l.t.includes('TcpTestSucceeded : True'))).toBe(true);
  });

  it('save/load round-trips the game', () => {
    const g = prepare(0);
    const json = g.serialize();
    const g2 = new Game(JSON.parse(json));
    expect(g2.s.t).toBe(g.s.t);
    expect(g2.hostHealthy('pc-eng-01')).toBe(true);
  });
});
