import type { RngState } from '../core/rng';
import type { NetEngine } from '../net/engine';
import type { Device, Flow, Iface } from '../net/model';
import type { EmployeeState, GameState, Incident } from '../sim/types';
import type { RosterEntry } from '../world/roster';

/** What scenarios may use from the game. */
export interface ScenarioHost {
  s: GameState;
  e: NetEngine;
  rng: RngState;
  readonly now: number;
  dev(id: string): Device;
  deviceOf(empId: string): Device | null;
  ownerOf(devId: string): RosterEntry | null;
  employee(empId: string): EmployeeState | undefined;
  /** switch + port that a host's cable lands on */
  accessPort(devId: string): { sw: Device; port: Iface } | null;
  /** hosts (PCs, laptops, printers) currently attached in a VLAN */
  hostsInVlan(vlan: number): Device[];
  hasUpgrade(id: string): boolean;
  /** all of the owner's business services work (quality-aware) */
  hostHealthy(devId: string): boolean;
  /** a host has a usable IP config and can reach its gateway + DNS */
  hostOnline(devId: string): boolean;
  forceRenew(devIds: string[]): void;
  addRogue(spec: { id: string; name: string; model: string; vendor: 'tplink' | 'rpi' | 'netgear'; swId: string; port: string; ip: string | null; mask: string | null; gw?: string; dhcp?: { net: string; mask: string; gw: string; dns: string } | null; extraMacs?: number; sendsBpdu?: boolean; wallLabel?: string; pos: { x: number; y: number } }): Device;
  removeDevice(id: string): void;
  addFlow(f: Flow): void;
  removeFlows(pred: (f: Flow) => boolean): void;
  serverLog(devId: string, msg: string): void;
  feed(msg: string, kind?: 'info' | 'good' | 'bad' | 'security' | 'change'): void;
  managerMsg(subject: string, body: string, kind?: 'info' | 'warning' | 'escalation'): void;
  invalidate(): void;
}

export type Category = 'Physical' | 'Switching' | 'Addressing' | 'DHCP' | 'DNS' | 'Routing' | 'ACL/NAT' | 'Wireless' | 'Services' | 'Performance' | 'Security' | 'Change';

export interface Injected {
  data: Record<string, unknown>;
  affected: string[];
}

export type SolutionStep =
  | { cli: string; cmds: string[] }
  | { act: string; dev: string; args?: Record<string, unknown> }
  | { wait: number }
  | { renew: string[] };

export interface ScenarioDef {
  id: string;
  name: string;
  category: Category;
  severity: 1 | 2 | 3 | 4;
  security?: boolean;
  minDay: number;
  weight: number;
  /** who notices: users (after a delay), monitoring, or the IDS */
  detect: 'users' | 'monitoring' | 'ids';
  workHoursOnly: boolean;
  inject(h: ScenarioHost, opts?: { target?: string }): Injected | null;
  alert(h: ScenarioHost, inc: Incident): { title: string; symptom: string; area: string };
  checklist?(h: ScenarioHost, inc: Incident): { id: string; text: string }[];
  checkItem?(h: ScenarioHost, inc: Incident, id: string): boolean;
  resolved(h: ScenarioHost, inc: Incident): boolean;
  /** explanation shown when verification fails */
  whyNot?(h: ScenarioHost, inc: Incident): string;
  hints(inc: Incident, h: ScenarioHost): string[];
  manual: string[];
  rootCause(inc: Incident, h: ScenarioHost): string;
  fix(inc: Incident, h: ScenarioHost): string;
  tick?(h: ScenarioHost, inc: Incident): void;
  escalate?(h: ScenarioHost, inc: Incident, level: number): string | null;
  cleanup?(h: ScenarioHost, inc: Incident): void;
  /** canonical fix used by automated tests to prove the incident is solvable */
  solution(inc: Incident, h: ScenarioHost): SolutionStep[];
}
