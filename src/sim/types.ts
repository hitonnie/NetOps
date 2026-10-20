import type { RngState } from '../core/rng';
import type { NetState, Point } from '../net/model';

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: number; // 0 short, 1 long, 2 bun, 3 bald, 4 curly, 5 ponytail, 6 buzz, 7 hijab
  shirt: string;
  accent: string;
  accessory: number; // 0 none, 1 headphones, 2 cap, 3 beanie, 4 scarf
  build: number; // 0.9 .. 1.1
}

export type EmpState = 'offsite' | 'walking' | 'working' | 'meeting' | 'break' | 'visiting' | 'printing' | 'chatting' | 'restroom';

export interface EmployeeState {
  id: string;
  app: Appearance;
  arrive: number; // minute of day planned arrival (today)
  leave: number;
  lunchAt: number;
  lunchOut: boolean;
  lunchedDay: number;
  state: EmpState;
  /** what the person intends to do when the current walk ends */
  plan: { kind: EmpState | 'leave' | 'arrive'; until?: number; seat?: string } | null;
  activity: string;
  pos: Point;
  path: Point[];
  speed: number; // px per sim-minute
  facing: number;
  until: number;
  nextDecision: number;
  frustration: number;
  health: number;
  healthDetail: string;
  failing: string[]; // service ids currently failing
  blockedSince: number | null;
  lastEmailAt: number;
  emailedFor: string | null; // signature of the problem already reported
  lastNocVisit: number;
  lastReboot: number;
  present: boolean;
  bubble: { icon: string; until: number } | null;
  workRate: number;
  meetingId: string | null;
  seat: string | null;
  patience: number; // minutes before complaining
  chatty: number; // 0..1
}

export interface Meeting {
  id: string;
  room: 'atlas' | 'borealis' | 'mgr';
  title: string;
  start: number; // absolute sim minute
  end: number;
  attendees: string[];
}

export interface IncidentChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Incident {
  id: string;
  scenario: string;
  title: string;
  symptom: string;
  area: string;
  severity: 1 | 2 | 3 | 4;
  security: boolean;
  createdAt: number;
  reportedAt: number | null;
  /** minutes counted against the SLA (business hours only, except security) */
  slaElapsed: number;
  status: 'latent' | 'open' | 'resolved';
  resolvedAt: number | null;
  data: Record<string, unknown>;
  affectedDevs: string[];
  hintsUsed: number;
  verifyAttempts: number;
  escalations: number;
  breached: boolean;
  statusUpdates: number;
  checklist: IncidentChecklistItem[];
  fixedSince: number | null;
  score: number;
  rootCause: string;
  fixSummary: string;
  verified: boolean;
  timeline: { t: number; msg: string }[];
}

export interface Email {
  id: string;
  t: number;
  from: string; // employee id or 'system' / 'it-monitoring' etc
  fromName: string;
  subject: string;
  body: string;
  read: boolean;
  starred: boolean;
  archived: boolean;
  incidentId: string | null;
  kind: 'report' | 'request' | 'thanks' | 'noise' | 'system' | 'security';
}

export interface Task {
  id: string;
  t: number;
  title: string;
  detail: string;
  kind: 'incident' | 'request' | 'followup' | 'note';
  incidentId: string | null;
  done: boolean;
  doneAt: number | null;
  /** id of an automatic check (requests/follow-ups) */
  check: string | null;
  checkArgs: Record<string, unknown>;
  due: number | null;
  reward: number;
  requester: string | null;
  failed: boolean;
}

export interface ManagerMsg {
  id: string;
  t: number;
  subject: string;
  body: string;
  kind: 'info' | 'praise' | 'warning' | 'budget' | 'escalation' | 'review';
  read: boolean;
}

export interface DaySummary {
  day: number;
  avgProductivity: number;
  incidentsResolved: number;
  incidentsOpen: number;
  slaBreaches: number;
  allowance: number;
  score: number;
}

export interface FeedItem {
  t: number;
  msg: string;
  kind: 'info' | 'good' | 'bad' | 'security' | 'change';
}

export interface Settings {
  hintMode: 'earned' | 'free';
  autoSlow: boolean;
  tutorial: boolean;
  cables: 'auto' | 'all' | 'off';
  labels: boolean;
  reducedMotion: boolean;
}

export interface GameState {
  version: number;
  seed: number;
  reproducible: boolean;
  rng: { incidents: RngState; people: RngState; misc: RngState };
  t: number;
  speed: number;
  net: NetState;
  employees: EmployeeState[];
  meetings: Meeting[];
  incidents: Incident[];
  director: { nextAt: number; lastScenarios: string[]; nightSecurityDay: number; counter: number; collateralCooldown: number };
  inbox: Email[];
  tasks: Task[];
  budget: number;
  satisfaction: number;
  productivity: number;
  prodSamples: { day: number; sum: number; n: number };
  prodHistory: number[];
  inventory: Record<string, number>;
  purchases: string[];
  manager: ManagerMsg[];
  score: number;
  hintTokens: number;
  settings: Settings;
  tutorial: { step: number; active: boolean; done: boolean; flags: Record<string, boolean> };
  changes: { t: number; dev: string; what: string }[];
  feed: FeedItem[];
  gameOver: boolean;
  days: DaySummary[];
  seq: number;
  stats: { resolved: number; breaches: number; commands: number; hintsUsed: number; securityResolved: number };
  lastDailyReport: number;
  ispRestoreAt: number;
}
