import type { ZoneId } from '../net/model';

export type Dept = 'Engineering' | 'Design' | 'QA' | 'Finance' | 'Office' | 'Management';

export interface RosterEntry {
  id: string;
  name: string;
  role: string;
  dept: Dept;
  zone: ZoneId;
  desk: string;
  device: 'pc' | 'laptop';
  /** pronoun used in generated text */
  pronoun: 'they' | 'she' | 'he';
}

export const ROSTER: RosterEntry[] = [
  { id: 'e-akim', name: 'Alex Kim', role: 'Backend Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-01', device: 'pc', pronoun: 'they' },
  { id: 'e-praman', name: 'Priya Raman', role: 'Senior Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-02', device: 'pc', pronoun: 'she' },
  { id: 'e-mjohnson', name: 'Marcus Johnson', role: 'Engineering Lead', dept: 'Engineering', zone: 'eng', desk: 'ENG-03', device: 'laptop', pronoun: 'he' },
  { id: 'e-srossi', name: 'Sofia Rossi', role: 'Frontend Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-04', device: 'pc', pronoun: 'she' },
  { id: 'e-tgarcia', name: 'Tomás García', role: 'DevOps Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-05', device: 'pc', pronoun: 'he' },
  { id: 'e-abello', name: 'Aisha Bello', role: 'Mobile Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-06', device: 'pc', pronoun: 'she' },
  { id: 'e-loconnor', name: "Liam O'Connor", role: 'Staff Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-07', device: 'laptop', pronoun: 'he' },
  { id: 'e-mchen', name: 'Mei Chen', role: 'Data Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-08', device: 'pc', pronoun: 'she' },
  { id: 'e-jweber', name: 'Jonas Weber', role: 'Backend Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-09', device: 'pc', pronoun: 'he' },
  { id: 'e-fhaddad', name: 'Fatima Haddad', role: 'Security Engineer', dept: 'Engineering', zone: 'eng', desk: 'ENG-10', device: 'pc', pronoun: 'she' },
  { id: 'd-obrown', name: 'Olivia Brown', role: 'Product Designer', dept: 'Design', zone: 'design', desk: 'DSN-01', device: 'pc', pronoun: 'she' },
  { id: 'd-ksato', name: 'Kenji Sato', role: 'Design Lead', dept: 'Design', zone: 'design', desk: 'DSN-02', device: 'laptop', pronoun: 'he' },
  { id: 'd-aokafor', name: 'Amara Okafor', role: 'UX Researcher', dept: 'Design', zone: 'design', desk: 'DSN-03', device: 'pc', pronoun: 'she' },
  { id: 'd-lsilva', name: 'Lucas Silva', role: 'Visual Designer', dept: 'Design', zone: 'design', desk: 'DSN-04', device: 'pc', pronoun: 'he' },
  { id: 'd-hmuller', name: 'Hannah Müller', role: 'Product Designer', dept: 'Design', zone: 'design', desk: 'DSN-05', device: 'laptop', pronoun: 'she' },
  { id: 'd-dmorales', name: 'Diego Morales', role: 'Motion Designer', dept: 'Design', zone: 'design', desk: 'DSN-06', device: 'pc', pronoun: 'he' },
  { id: 'q-nwilliams', name: 'Noah Williams', role: 'QA Lead', dept: 'QA', zone: 'qa', desk: 'QA-01', device: 'pc', pronoun: 'he' },
  { id: 'q-zahmed', name: 'Zara Ahmed', role: 'QA Engineer', dept: 'QA', zone: 'qa', desk: 'QA-02', device: 'laptop', pronoun: 'she' },
  { id: 'q-epark', name: 'Ethan Park', role: 'Test Automation Engineer', dept: 'QA', zone: 'qa', desk: 'QA-03', device: 'pc', pronoun: 'he' },
  { id: 'q-gnwosu', name: 'Grace Nwosu', role: 'QA Engineer', dept: 'QA', zone: 'qa', desk: 'QA-04', device: 'pc', pronoun: 'she' },
  { id: 'f-rhughes', name: 'Robert Hughes', role: 'Finance Director', dept: 'Finance', zone: 'finance', desk: 'FIN-01', device: 'pc', pronoun: 'he' },
  { id: 'f-epetrova', name: 'Elena Petrova', role: 'Accountant', dept: 'Finance', zone: 'finance', desk: 'FIN-02', device: 'pc', pronoun: 'she' },
  { id: 'f-sadeyemi', name: 'Samuel Adeyemi', role: 'Payroll Specialist', dept: 'Finance', zone: 'finance', desk: 'FIN-03', device: 'pc', pronoun: 'he' },
  { id: 'f-cmartin', name: 'Chloe Martin', role: 'Financial Analyst', dept: 'Finance', zone: 'finance', desk: 'FIN-04', device: 'pc', pronoun: 'she' },
  { id: 'o-mthompson', name: 'Maya Thompson', role: 'Office Coordinator', dept: 'Office', zone: 'reception', desk: 'RCP-01', device: 'pc', pronoun: 'she' },
  { id: 'm-dwhitfield', name: 'Dana Whitfield', role: 'COO (your manager)', dept: 'Management', zone: 'mgr', desk: 'MGR-01', device: 'laptop', pronoun: 'they' },
];

export const MANAGER_ID = 'm-dwhitfield';

export interface ServiceReq {
  id: string;
  label: string;
  host: string; // DNS name or IP
  proto: 'tcp' | 'udp';
  port: number;
  weight: number;
}

const SVC = {
  git: { id: 'git', label: 'Git & CI (git.corp.local)', host: 'git.corp.local', proto: 'tcp', port: 443, weight: 0.35 },
  github: { id: 'github', label: 'GitHub (github.com)', host: 'github.com', proto: 'tcp', port: 443, weight: 0.2 },
  staging: { id: 'staging', label: 'Staging env (staging.corp.local)', host: 'staging.corp.local', proto: 'tcp', port: 443, weight: 0.3 },
  files: { id: 'files', label: 'File share (files.corp.local)', host: 'files.corp.local', proto: 'tcp', port: 445, weight: 0.35 },
  figma: { id: 'figma', label: 'Figma (figma.com)', host: 'figma.com', proto: 'tcp', port: 443, weight: 0.3 },
  erp: { id: 'erp', label: 'ERP (erp.corp.local)', host: 'erp.corp.local', proto: 'tcp', port: 443, weight: 0.45 },
  bank: { id: 'bank', label: 'Bank portal (portal.bankline.com)', host: 'portal.bankline.com', proto: 'tcp', port: 443, weight: 0.2 },
  mail: { id: 'mail', label: 'Email & chat (outlook.office.com)', host: 'outlook.office.com', proto: 'tcp', port: 443, weight: 0.25 },
  wiki: { id: 'wiki', label: 'Wiki (wiki.corp.local)', host: 'wiki.corp.local', proto: 'tcp', port: 443, weight: 0.1 },
  jira: { id: 'jira', label: 'Issue tracker (tracker.atlassian.net)', host: 'tracker.atlassian.net', proto: 'tcp', port: 443, weight: 0.15 },
} satisfies Record<string, ServiceReq>;

export const SERVICES_BY_DEPT: Record<Dept, ServiceReq[]> = {
  Engineering: [SVC.git, SVC.github, SVC.mail, SVC.wiki],
  Design: [SVC.files, SVC.figma, SVC.mail],
  QA: [SVC.staging, SVC.jira, SVC.git, SVC.mail],
  Finance: [SVC.erp, SVC.bank, SVC.mail],
  Office: [SVC.mail, SVC.erp],
  Management: [SVC.mail, SVC.erp, SVC.wiki],
};

export const ALL_SERVICES = SVC;

export const PRINTER_FOR_ZONE: Partial<Record<ZoneId, string>> = {
  eng: 'prn-eng',
  qa: 'prn-eng',
  design: 'prn-dsgn',
  finance: 'prn-fin',
  reception: 'prn-fin',
  mgr: 'prn-fin',
};

export function firstName(full: string): string {
  return full.split(' ')[0];
}
