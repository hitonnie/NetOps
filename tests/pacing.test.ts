import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { updateMovement } from '../src/world/employees';

/** Run the real loop (minute ticks + movement) without the UI. */
function simulate(g: Game, minutes: number, onTick?: (g: Game) => void) {
  for (let k = 0; k < minutes; k++) {
    updateMovement(g, 1);
    g.s.t += 1;
    g.minuteTick();
    onTick?.(g);
  }
}

describe('incident pacing and long-run stability', () => {
  it('never floods the player and keeps the office running for two days', () => {
    const g = Game.create(4242, { tutorial: false, reproducible: true, hintMode: 'earned' });
    let maxActive = 0;
    let maxOpenAtOnce = 0;
    simulate(g, 2 * 1440, (gg) => {
      maxActive = Math.max(maxActive, gg.activeIncidents().filter((i) => i.scenario !== 'collateral').length);
      maxOpenAtOnce = Math.max(maxOpenAtOnce, gg.openIncidents().length);
    });
    const injected = g.s.incidents.filter((i) => i.scenario !== 'collateral');
    // a measured pace: a handful per day, never a flood
    expect(injected.length).toBeGreaterThanOrEqual(2);
    expect(injected.length).toBeLessThanOrEqual(12);
    expect(maxActive).toBeLessThanOrEqual(3);
    // people came and went
    expect(g.s.days.length).toBe(2);
    expect(g.s.employees.every((e) => !e.present || e.state !== 'walking' || e.path.length > 0)).toBe(true);
    // game survives a save/load round trip mid-campaign
    const g2 = new Game(JSON.parse(g.serialize()));
    simulate(g2, 60);
    expect(g2.s.t).toBeGreaterThan(g.s.t);
    void maxOpenAtOnce;
  }, 120000);

  it('is frame-rate independent (fixed sub-steps)', () => {
    const run = (fps: number) => {
      const g = Game.create(99, { tutorial: false, reproducible: true, hintMode: 'earned' });
      g.setSpeed(5);
      const target = 11 * 60;
      while (g.s.t < target) g.frame(1 / fps);
      return {
        t: g.s.t,
        incidents: g.s.incidents.map((i) => `${i.scenario}@${Math.round(i.createdAt)}`),
        people: g.s.employees.map((e) => `${e.id}:${Math.round(e.pos.x)},${Math.round(e.pos.y)}:${e.state}`),
      };
    };
    expect(run(60)).toEqual(run(23));
  }, 120000);

  it('is reproducible: same seed and same (no) actions give the same incidents', () => {
    const run = () => {
      const g = Game.create(777, { tutorial: false, reproducible: true, hintMode: 'earned' });
      simulate(g, 1440);
      return g.s.incidents.map((i) => `${i.scenario}@${Math.round(i.createdAt)}`);
    };
    expect(run()).toEqual(run());
  }, 120000);
});
