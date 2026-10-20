/** Shared terminal/shell types and the IOS-style command tree matcher. */
import type { NetEngine } from '../engine';

export interface TermLine {
  t: string;
  k?: 'in' | 'err' | 'ok' | 'dim' | 'warn' | 'sys';
}

/** Services the simulation provides to shells (implemented by the Game). */
export interface SimApi {
  engine: NetEngine;
  readonly now: number;
  /** a player-made configuration/state change (feeds change-tracking & incidents) */
  recordChange(devId: string, what: string): void;
  /** a command was executed (tutorial/learning hooks); `canon` is the expanded command */
  onCommand(devId: string, canon: string, raw: string): void;
  reloadDevice(devId: string): void;
  dhcpRenew(devId: string): { ok: boolean; reason: string };
  dhcpRelease(devId: string): void;
  applyStatic(devId: string, cfg: { ip: string; mask: string; gateway: string; dns: string[] }): void;
  enableDhcp(devId: string): void;
  restartService(devId: string, svc: string, action: 'start' | 'stop' | 'restart'): { ok: boolean; msg: string };
  freeDisk(devId: string): number;
}

export interface Shell {
  devId: string;
  kind: 'ios' | 'windows' | 'linux';
  lines: TermLine[];
  history: string[];
  prompt(): string;
  run(input: string): void;
  /** IOS: '?' pressed — prints context help, returns the input to keep */
  help(input: string): string;
  complete(input: string): string;
  /** true while the shell waits for a confirmation answer */
  busy?: boolean;
}

export const MAX_LINES = 1500;

export function pushLines(sh: { lines: TermLine[] }, text: string | string[], k?: TermLine['k']): void {
  const arr = Array.isArray(text) ? text : text.split('\n');
  for (const t of arr) sh.lines.push({ t, k });
  if (sh.lines.length > MAX_LINES) sh.lines.splice(0, sh.lines.length - MAX_LINES);
}

export function tokenize(input: string): { tokens: string[]; offsets: number[] } {
  const tokens: string[] = [];
  const offsets: number[] = [];
  const re = /"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    tokens.push(m[0].startsWith('"') ? m[0].slice(1, -1) : m[0]);
    offsets.push(m.index);
  }
  return { tokens, offsets };
}

export function pad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

export function padL(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}

/** Apply an IOS output pipe: include|exclude|begin|section|count */
export function applyPipe(lines: string[], pipe: string | null): string[] | string {
  if (!pipe) return lines;
  const { tokens } = tokenize(pipe);
  if (!tokens.length) return '% Incomplete command.';
  const kw = tokens[0].toLowerCase();
  const pat = tokens.slice(1).join(' ');
  const kinds = ['include', 'exclude', 'begin', 'section', 'count'];
  const k = kinds.filter((x) => x.startsWith(kw));
  if (k.length !== 1) return "% Invalid input detected at '^' marker.";
  if (k[0] !== 'count' && !pat) return '% Incomplete command.';
  let re: RegExp;
  try {
    re = new RegExp(pat || '.', 'i');
  } catch {
    re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  switch (k[0]) {
    case 'include':
      return lines.filter((l) => re.test(l));
    case 'exclude':
      return lines.filter((l) => !re.test(l));
    case 'begin': {
      const i = lines.findIndex((l) => re.test(l));
      return i < 0 ? [] : lines.slice(i);
    }
    case 'section': {
      const out: string[] = [];
      let inSec = false;
      for (const l of lines) {
        if (!l.startsWith(' ')) inSec = re.test(l);
        if (inSec) out.push(l);
      }
      return out;
    }
    case 'count':
      return [`Number of lines which match regexp = ${lines.filter((l) => re.test(l)).length}`];
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Command tree

export interface RunCtx {
  args: string[];
  neg: boolean;
  out: (s: string | string[]) => void;
  err: (s: string) => void;
  raw: string;
  /** raw text of the arguments (case preserved) */
  rest: string;
}

export interface CmdNode {
  help: string;
  children?: Record<string, CmdNode>;
  run?: (c: RunCtx) => void;
  /** usage hints shown by '?' when the node accepts arguments */
  args?: [string, string][];
  /** command exists but only in privileged mode */
  priv?: boolean;
  /** supports the "no" form */
  noForm?: boolean;
}

export type WalkResult =
  | { ok: true; node: CmdNode; path: string[]; argStart: number }
  | { ok: false; kind: 'invalid' | 'ambiguous' | 'incomplete'; at: number; path: string[] };

export function walk(root: Record<string, CmdNode>, tokens: string[]): WalkResult {
  let children: Record<string, CmdNode> | undefined = root;
  let node: CmdNode | null = null;
  const path: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (children) {
      const keys: string[] = Object.keys(children);
      const exact: string | undefined = keys.find((k) => k === t);
      const matches: string[] = exact ? [exact] : keys.filter((k) => k.startsWith(t));
      if (matches.length === 1) {
        node = children[matches[0]];
        path.push(matches[0]);
        children = node.children;
        continue;
      }
      if (matches.length > 1 && !(node && node.run && node.args)) return { ok: false, kind: 'ambiguous', at: i, path };
    }
    if (node && node.run) return { ok: true, node, path, argStart: i };
    return { ok: false, kind: 'invalid', at: i, path };
  }
  if (!node) return { ok: false, kind: 'incomplete', at: tokens.length, path };
  if (!node.run) return { ok: false, kind: 'incomplete', at: tokens.length, path };
  return { ok: true, node, path, argStart: tokens.length };
}

/** Context help for '?'. */
export function treeHelp(root: Record<string, CmdNode>, input: string): string[] {
  const { tokens } = tokenize(input);
  const endsWithSpace = input.length === 0 || /\s$/.test(input);
  const done = endsWithSpace ? tokens : tokens.slice(0, -1);
  const partial = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '').toLowerCase();
  let children: Record<string, CmdNode> | undefined = root;
  let node: CmdNode | null = null;
  for (const t of done) {
    if (!children) break;
    const keys: string[] = Object.keys(children);
    const exact: string | undefined = keys.find((k) => k === t.toLowerCase());
    const matches: string[] = exact ? [exact] : keys.filter((k) => k.startsWith(t.toLowerCase()));
    if (matches.length !== 1) {
      if (node?.args) {
        children = undefined;
        break;
      }
      return ['% Unrecognized command'];
    }
    node = children[matches[0]];
    children = node.children;
  }
  if (!endsWithSpace) {
    const keys = Object.keys(children ?? {}).filter((k) => k.startsWith(partial));
    if (!keys.length) return node?.args ? node.args.map(([a, h]) => `  ${pad(a, 22)}${h}`) : ['% Unrecognized command'];
    return [keys.join('  ')];
  }
  const out: string[] = [];
  for (const [k, n] of Object.entries(children ?? {})) out.push(`  ${pad(k, 22)}${n.help}`);
  if (node?.args) for (const [a, h] of node.args) out.push(`  ${pad(a, 22)}${h}`);
  if (node?.run) out.push('  <cr>');
  return out.length ? out : ['  <cr>'];
}

export function treeComplete(root: Record<string, CmdNode>, input: string): string {
  const { tokens, offsets } = tokenize(input);
  if (!tokens.length || /\s$/.test(input)) return input;
  let children: Record<string, CmdNode> | undefined = root;
  for (let i = 0; i < tokens.length; i++) {
    if (!children) return input;
    const t = tokens[i].toLowerCase();
    const keys: string[] = Object.keys(children);
    const exact: string | undefined = keys.find((k) => k === t);
    const matches: string[] = exact ? [exact] : keys.filter((k) => k.startsWith(t));
    if (i === tokens.length - 1) {
      if (matches.length === 1) return input.slice(0, offsets[i]) + matches[0] + ' ';
      // complete to the common prefix
      if (matches.length > 1) {
        let p = matches[0];
        for (const m of matches) while (!m.startsWith(p)) p = p.slice(0, -1);
        if (p.length > t.length) return input.slice(0, offsets[i]) + p;
      }
      return input;
    }
    if (matches.length !== 1) return input;
    children = children[matches[0]].children;
  }
  return input;
}

export function caretLine(promptLen: number, offset: number): string {
  return ' '.repeat(promptLen + offset) + '^';
}
