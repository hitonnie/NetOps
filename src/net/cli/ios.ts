/**
 * Cisco IOS-style command line for switches, the core switch and the firewall.
 * Supports abbreviations, '?', Tab completion, "no" forms, "do", pipes and
 * realistic error messages. Commands outside the simulation's scope say so.
 */
import { PORT_NAMES, isUnsaved, snapshotConfig } from '../config';
import type { NetEngine } from '../engine';
import { cmpIp, inNetwork, isValidIp, isValidMask, maskToPrefix, networkOf, prefixToMask, sameSubnet } from '../ip';
import {
  type AclEntry,
  type AddrSpec,
  type Device,
  type Iface,
  type PortMatch,
  emptyCounters,
  formatVlanList,
  makeIface,
  normalizeIfName,
  parseVlanList,
  shortIf,
} from '../model';
import * as S from './iosShow';
import {
  type CmdNode,
  type RunCtx,
  type Shell,
  type SimApi,
  type TermLine,
  applyPipe,
  caretLine,
  pushLines,
  tokenize,
  treeComplete,
  treeHelp,
  walk,
} from './shell';

type Mode = 'user' | 'priv' | 'config' | 'if' | 'vlan' | 'dhcp' | 'acl' | 'line';

const OOS = (what: string) => `% ${what} is outside the scope of this simulation.`;

export class IosShell implements Shell {
  kind = 'ios' as const;
  lines: TermLine[] = [];
  history: string[] = [];
  mode: Mode = 'user';
  ifCtx: string[] = [];
  vlanCtx: number[] = [];
  poolCtx = '';
  aclCtx = '';
  confirm: { prompt: string; onAnswer: (a: string) => void } | null = null;
  private arpWarm = new Set<string>();
  private configChanged = false;

  constructor(
    public devId: string,
    private api: SimApi,
  ) {
    const d = this.d;
    pushLines(this, ['', d.ios?.bannerMotd ?? '', '', 'User Access Verification', '', `[Connected to ${d.name} — type "?" for help, "enable" to start]`, ''], 'dim');
  }

  get e(): NetEngine {
    return this.api.engine;
  }
  get d(): Device {
    return this.api.engine.dev(this.devId);
  }
  get busy(): boolean {
    return !!this.confirm;
  }

  prompt(): string {
    if (this.confirm) return this.confirm.prompt;
    const h = this.d.name;
    switch (this.mode) {
      case 'user':
        return `${h}>`;
      case 'priv':
        return `${h}#`;
      case 'config':
        return `${h}(config)#`;
      case 'if':
        return this.ifCtx.length > 1 ? `${h}(config-if-range)#` : `${h}(config-if)#`;
      case 'vlan':
        return `${h}(config-vlan)#`;
      case 'dhcp':
        return `${h}(dhcp-config)#`;
      case 'acl':
        return this.acl()?.type === 'standard' ? `${h}(config-std-nacl)#` : `${h}(config-ext-nacl)#`;
      case 'line':
        return `${h}(config-line)#`;
    }
  }

  private out = (s: string | string[]) => pushLines(this, s);
  private err = (s: string) => pushLines(this, s, 'err');

  // -------------------------------------------------------------------------

  run(input: string): void {
    const p = this.prompt();
    pushLines(this, `${p}${input}`, 'in');
    if (this.confirm) {
      const c = this.confirm;
      this.confirm = null;
      c.onAnswer(input.trim());
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) return;
    this.history.push(trimmed);
    if (this.history.length > 100) this.history.shift();
    if (!this.e.isUp(this.devId)) {
      this.err(this.e.c.devPowered.get(this.devId) ? '%% Device is booting — console not ready yet. Try again in a moment.' : '%% No response on the console — the device is powered off.');
      return;
    }
    // pipe
    let cmd = trimmed;
    let pipe: string | null = null;
    const pi = trimmed.indexOf('|');
    if (pi >= 0) {
      cmd = trimmed.slice(0, pi).trim();
      pipe = trimmed.slice(pi + 1).trim();
    }
    const before = this.lines.length;
    this.dispatch(cmd, p.length + (input.length - input.trimStart().length));
    if (pipe !== null) {
      const produced = this.lines.splice(before).map((l) => l.t);
      const res = applyPipe(produced, pipe);
      if (typeof res === 'string') this.err(res);
      else this.out(res);
    }
  }

  private dispatch(cmd: string, promptLen: number): void {
    if (cmd.toLowerCase() === 'ctrl-z' || cmd === '\x1a') {
      this.end();
      return;
    }
    const { tokens, offsets } = tokenize(cmd);
    let neg = false;
    let start = 0;
    let tree: Record<string, CmdNode>;
    if (this.mode === 'user' || this.mode === 'priv') tree = this.execTree(this.mode === 'priv');
    else {
      if (tokens[0]?.toLowerCase() === 'do') {
        const rest = cmd.slice(offsets[1] ?? cmd.length);
        if (!rest.trim()) {
          this.err('% Incomplete command.');
          return;
        }
        this.runIn(this.execTree(true), rest, promptLen + (offsets[1] ?? 0), false, 'do');
        return;
      }
      if (tokens[0]?.toLowerCase() === 'no') {
        neg = true;
        start = 1;
      }
      tree = this.modeTree();
    }
    const sub = start ? cmd.slice(offsets[start] ?? cmd.length) : cmd;
    if (this.mode === 'acl' && /^\d+$/.test(tokens[start] ?? '')) {
      this.aclSeq(Number(tokens[start]), tokens.slice(start + 1), neg);
      return;
    }
    if (neg && !sub.trim()) {
      this.err('% Incomplete command.');
      return;
    }
    this.runIn(tree, sub, promptLen + (start ? offsets[start] : 0), neg, neg ? 'no' : '');
  }

  private runIn(tree: Record<string, CmdNode>, cmd: string, promptLen: number, neg: boolean, prefix: string): void {
    const { tokens, offsets } = tokenize(cmd);
    const w = walk(tree, tokens);
    if (!w.ok) {
      if (w.kind === 'incomplete') this.err('% Incomplete command.');
      else if (w.kind === 'ambiguous') this.err(`% Ambiguous command:  "${cmd}"`);
      else {
        this.err(caretLine(promptLen, offsets[w.at] ?? cmd.length));
        this.err("% Invalid input detected at '^' marker.");
      }
      this.out('');
      return;
    }
    const args = tokens.slice(w.argStart);
    const rest = w.argStart < tokens.length ? cmd.slice(offsets[w.argStart]) : '';
    const canon = [prefix, ...w.path, ...args].filter(Boolean).join(' ');
    const ctx: RunCtx = { args, neg, out: this.out, err: this.err, raw: cmd, rest };
    try {
      w.node.run!(ctx);
    } catch (ex) {
      this.err(`% Internal error: ${(ex as Error).message}`);
    }
    this.api.onCommand(this.devId, canon, cmd);
  }

  help(input: string): string {
    pushLines(this, `${this.prompt()}${input}?`, 'in');
    let tree: Record<string, CmdNode>;
    let text = input;
    if (this.mode === 'user' || this.mode === 'priv') tree = this.execTree(this.mode === 'priv');
    else {
      const t = tokenize(input);
      if (t.tokens[0]?.toLowerCase() === 'do' && t.tokens.length > 0 && (t.tokens.length > 1 || /\s$/.test(input))) {
        tree = this.execTree(true);
        text = input.slice(t.offsets[1] ?? input.length);
      } else if (t.tokens[0]?.toLowerCase() === 'no' && (t.tokens.length > 1 || /\s$/.test(input))) {
        tree = this.modeTree();
        text = input.slice(t.offsets[1] ?? input.length);
      } else tree = this.modeTree();
    }
    this.out(treeHelp(tree, text));
    this.out('');
    return input;
  }

  complete(input: string): string {
    let tree: Record<string, CmdNode>;
    if (this.mode === 'user' || this.mode === 'priv') tree = this.execTree(this.mode === 'priv');
    else {
      const t = tokenize(input);
      const first = t.tokens[0]?.toLowerCase();
      if ((first === 'do' || first === 'no') && t.tokens.length > 1) {
        const off = t.offsets[1];
        tree = first === 'do' ? this.execTree(true) : this.modeTree();
        return input.slice(0, off) + treeComplete(tree, input.slice(off));
      }
      tree = this.modeTree();
    }
    return treeComplete(tree, input);
  }

  // -------------------------------------------------------------------------
  // helpers

  private changed(what: string): void {
    this.e.invalidate();
    this.configChanged = true;
    this.api.recordChange(this.devId, what);
  }

  private end(): void {
    if (this.mode !== 'user' && this.mode !== 'priv') {
      this.mode = 'priv';
      this.ifCtx = [];
      if (this.configChanged) {
        this.configChanged = false;
        this.e.log(this.devId, `%SYS-5-CONFIG_I: Configured from console by netadmin on vty0 (10.10.99.50)`);
      }
    }
  }

  private exitMode(): void {
    if (this.mode === 'config') this.end();
    else if (this.mode === 'priv' || this.mode === 'user') {
      this.out(['', `[Connection to ${this.d.name} closed]`, '', 'Press Enter to reconnect.']);
      this.mode = 'user';
    } else {
      this.mode = 'config';
      this.ifCtx = [];
    }
  }

  private isSwitch(): boolean {
    return this.d.kind === 'switch' || this.d.kind === 'l3switch';
  }

  private acl() {
    return this.d.ios!.acls.find((a) => a.name === this.aclCtx);
  }

  private findIf(args: string[]): Iface | null | 'bad' {
    if (!args.length) return null;
    const name = normalizeIfName(args.join(''));
    if (!name) return 'bad';
    return this.d.ifaces.find((i) => i.name.toLowerCase() === name.toLowerCase()) ?? 'bad';
  }

  private ifaces(): Iface[] {
    return this.ifCtx.map((n) => this.d.ifaces.find((i) => i.name === n)!).filter(Boolean);
  }

  private parseIp(s: string | undefined, c: RunCtx, what = 'address'): string | null {
    if (!s) {
      c.err('% Incomplete command.');
      return null;
    }
    if (!isValidIp(s)) {
      c.err(`% Invalid ${what} "${s}"`);
      return null;
    }
    return s;
  }

  // -------------------------------------------------------------------------
  // EXEC

  private execTree(priv: boolean): Record<string, CmdNode> {
    const t: Record<string, CmdNode> = {
      enable: {
        help: 'Turn on privileged commands',
        run: () => {
          if (this.mode === 'user') this.mode = 'priv';
        },
      },
      disable: { help: 'Turn off privileged commands', run: () => (this.mode = 'user') },
      exit: { help: 'Exit from the EXEC', run: () => this.exitMode() },
      logout: { help: 'Exit from the EXEC', run: () => this.exitMode() },
      show: { help: 'Show running system information', children: this.showTree(priv) },
      ping: { help: 'Send echo messages', args: [['WORD', 'Ping destination address or hostname']], run: (c) => this.ping(c) },
      traceroute: { help: 'Trace route to destination', args: [['WORD', 'Trace route to destination address or hostname']], run: (c) => this.traceroute(c) },
      terminal: {
        help: 'Set terminal line parameters',
        children: {
          length: { help: 'Set number of lines on a screen', args: [['<0-512>', 'Number of lines on screen (0 for no pausing)']], run: () => {} },
          monitor: { help: 'Copy debug output to the current terminal line', run: () => this.out('% Console already displays log messages.') },
        },
      },
      ssh: { help: 'Open a secure shell client connection', run: (c) => c.err(OOS('Chaining SSH sessions') + ' Click another device to open its console.') },
      telnet: { help: 'Open a telnet connection', run: (c) => c.err(OOS('Telnet') + ' Click another device to open its console.') },
    };
    if (!priv) return t;
    const privCmds: Record<string, CmdNode> = {
      configure: {
        help: 'Enter configuration mode',
        children: {
          terminal: {
            help: 'Configure from the terminal',
            run: () => {
              this.mode = 'config';
              this.out('Enter configuration commands, one per line.  End with CNTL/Z.');
            },
          },
        },
      },
      copy: {
        help: 'Copy from one file to another',
        children: {
          'running-config': {
            help: 'Copy from current system configuration',
            children: { 'startup-config': { help: 'Copy to startup configuration', run: () => this.confirmSave(true) } },
          },
          'startup-config': {
            help: 'Copy from startup configuration',
            children: { 'running-config': { help: 'Merge into running configuration', run: (c) => c.err(OOS('Merging startup-config into running-config')) } },
          },
        },
      },
      write: {
        help: 'Write running configuration to memory, network, or terminal',
        run: () => this.save(),
        children: {
          memory: { help: 'Write to NV memory', run: () => this.save() },
          terminal: { help: 'Write to terminal', run: (c) => c.out(S.showRun(this.d)) },
          erase: { help: 'Erase NV memory', run: (c) => c.err(OOS('Erasing startup-config')) },
        },
      },
      reload: { help: 'Halt and perform a cold restart', run: () => this.reload() },
      clear: { help: 'Reset functions', children: this.clearTree() },
      debug: { help: 'Debugging functions', run: (c) => c.err(OOS('Debug output') + ' Use "show logging" instead.') },
      undebug: { help: 'Disable debugging functions', run: () => this.out('All possible debugging has been turned off') },
    };
    Object.assign(t, privCmds);
    return t;
  }

  private showTree(priv: boolean): Record<string, CmdNode> {
    const d = () => this.d;
    const e = () => this.e;
    const iosOnlySwitch = (fn: (c: RunCtx) => void) => (c: RunCtx) => (this.isSwitch() ? fn(c) : this.invalidHere(c));
    const tree: Record<string, CmdNode> = {
      version: { help: 'System hardware and software status', run: (c) => c.out(S.showVersion(e(), d())) },
      clock: { help: 'Display the system clock', run: (c) => c.out(S.showClock(e())) },
      history: { help: 'Display the session command history', run: (c) => c.out(this.history.slice(-20).map((h) => `  ${h}`)) },
      interfaces: {
        help: 'Interface status and configuration',
        args: [['<interface>', 'e.g. gi1/0/1, vlan10']],
        run: (c) => this.showInterfaces(c),
        children: {
          status: { help: 'Show interface line status', run: iosOnlySwitch((c) => c.out(S.showIntStatus(e(), d()))) },
          trunk: { help: 'Show interface trunk information', run: iosOnlySwitch((c) => c.out(S.showIntTrunk(e(), d()))) },
          description: { help: 'Show interface description', run: (c) => c.out(S.showIntDescription(e(), d())) },
        },
      },
      ip: {
        help: 'IP information',
        children: {
          interface: {
            help: 'IP interface status and configuration',
            args: [['<interface>', 'Interface name']],
            run: (c) => this.showIpInterface(c),
            children: { brief: { help: 'Brief summary of IP status and configuration', run: (c) => c.out(S.showIpIntBrief(e(), d())) } },
          },
          route: {
            help: 'IP routing table',
            run: (c) => c.out(S.showIpRoute(e(), d())),
            children: { static: { help: 'Static routes', run: (c) => c.out(S.showIpRoute(e(), d(), true)) } },
          },
          arp: { help: 'IP ARP table', args: [['A.B.C.D', 'IP address']], run: (c) => c.out(S.showArp(e(), d(), c.args[0])) },
          dhcp: {
            help: 'Show items in the DHCP database',
            children: {
              binding: { help: 'DHCP address bindings', run: (c) => this.needPools(c, () => c.out(S.showDhcpBinding(e(), d()))) },
              pool: { help: 'DHCP pools information', run: (c) => this.needPools(c, () => c.out(S.showDhcpPool(e(), d()))) },
              conflict: { help: 'DHCP address conflicts', run: (c) => c.out(S.showDhcpConflict(e(), d())) },
              snooping: { help: 'DHCP snooping', run: iosOnlySwitch((c) => c.out(S.showSnooping(e(), d()))) },
            },
          },
          'access-lists': { help: 'List IP access lists', args: [['WORD', 'Access list name']], run: (c) => c.out(S.showAcls(e(), d(), c.args[0])) },
          nat: {
            help: 'IP NAT information',
            children: {
              translations: { help: 'Translation entries', run: (c) => (d().ios!.natRules.length ? c.out(S.showNat(e(), d())) : c.out('')) },
              statistics: { help: 'Translation statistics', run: (c) => this.natStats(c) },
            },
          },
          protocols: { help: 'IP routing protocol process parameters', run: (c) => c.out(['*** IP Routing is NSF aware ***', 'No dynamic routing protocols are configured (static routing only in this network).']) },
          ospf: { help: 'OSPF information', run: (c) => c.err(OOS('OSPF') + ' This network uses static routing.') },
          eigrp: { help: 'IP-EIGRP show commands', run: (c) => c.err(OOS('EIGRP') + ' This network uses static routing.') },
          bgp: { help: 'BGP information', run: (c) => c.err(OOS('BGP')) },
        },
      },
      arp: { help: 'ARP table', run: (c) => c.out(S.showArp(e(), d())) },
      'access-lists': { help: 'List access lists', args: [['WORD', 'Access list name']], run: (c) => c.out(S.showAcls(e(), d(), c.args[0])) },
      vlan: {
        help: 'VTP VLAN status',
        run: iosOnlySwitch((c) => c.out(S.showVlanBrief(e(), d(), true))),
        children: {
          brief: { help: 'VTP all VLAN status in brief', run: iosOnlySwitch((c) => c.out(S.showVlanBrief(e(), d()))) },
          id: {
            help: 'VTP VLAN status by VLAN id',
            args: [['<1-4094>', 'VLAN id']],
            run: iosOnlySwitch((c) => {
              const v = Number(c.args[0]);
              const all = S.showVlanBrief(e(), d());
              c.out([...all.slice(0, 2), ...all.filter((l) => l.startsWith(`${v} `))]);
            }),
          },
        },
      },
      mac: {
        help: 'MAC configuration',
        children: {
          'address-table': {
            help: 'MAC forwarding table',
            args: [
              ['dynamic', 'dynamic entry type'],
              ['interface', 'interface keyword'],
              ['vlan', 'VLAN keyword'],
              ['address', 'address keyword'],
            ],
            run: iosOnlySwitch((c) => this.showMac(c)),
          },
        },
      },
      cdp: {
        help: 'CDP information',
        children: {
          neighbors: { help: 'CDP neighbor entries', args: [['detail', 'Show detailed information']], run: (c) => c.out(S.showCdp(e(), d(), c.args[0]?.toLowerCase().startsWith('det') ?? false)) },
        },
      },
      'spanning-tree': {
        help: 'Spanning tree topology',
        args: [['vlan', 'VLAN Switch Spanning Trees']],
        run: iosOnlySwitch((c) => {
          const v = c.args[0]?.toLowerCase().startsWith('v') ? Number(c.args[1]) : undefined;
          c.out(S.showSpanningTree(e(), d(), v));
        }),
      },
      power: {
        help: 'Switch power',
        children: {
          inline: {
            help: 'Inline power status',
            args: [['<interface>', 'Interface']],
            run: (c) => {
              const i = this.findIf(c.args);
              if (i === 'bad') return this.invalidHere(c);
              c.out(S.showPowerInline(e(), d(), i ?? undefined));
            },
          },
        },
      },
      'port-security': {
        help: 'Show secure port information',
        args: [
          ['interface', 'Show secure interface'],
          ['address', 'Show secure address'],
        ],
        run: iosOnlySwitch((c) => {
          if (c.args[0]?.toLowerCase().startsWith('i')) {
            const i = this.findIf(c.args.slice(1));
            if (!i || i === 'bad') return this.invalidHere(c);
            c.out(S.showPortSecurity(e(), d(), i));
          } else if (c.args[0]?.toLowerCase().startsWith('a')) {
            const out = ['               Secure Mac Address Table', '-----------------------------------------------------------------------------', 'Vlan    Mac Address       Type                          Ports   Remaining Age'];
            for (const i of d().ifaces) for (const m of i.portSecurity?.secureMacs ?? []) out.push(`${String(i.accessVlan).padStart(4)}    ${m.replace(/:/g, '').replace(/(.{4})(?!$)/g, '$1.')}    ${i.portSecurity!.sticky ? 'SecureSticky' : 'SecureConfigured'}                  ${shortIf(i.name)}        -`);
            c.out(out);
          } else c.out(S.showPortSecurity(e(), d()));
        }),
      },
      logging: { help: 'Show the contents of logging buffers', run: (c) => c.out(S.showLogging(e(), d())) },
      processes: {
        help: 'Active process statistics',
        children: { cpu: { help: 'Show CPU use per process', args: [['sorted', 'Sort output']], run: (c) => c.out(S.showCpu(e(), d())) } },
      },
      etherchannel: { help: 'EtherChannel information', run: (c) => c.err(OOS('EtherChannel configuration') + ' Redundant uplinks are purchased as an upgrade in the Shop.') },
      lldp: { help: 'LLDP information', run: (c) => c.err('% LLDP is not enabled. Use "show cdp neighbors".') },
      inventory: {
        help: 'Show the physical inventory',
        run: (c) => c.out([`NAME: "${d().name}", DESCR: "${d().model}"`, `PID: ${d().model.split(' ')[0]}  , VID: V02  , SN: ${d().serial}`]),
      },
      environment: { help: 'Environmental monitor statistics', run: (c) => c.out(['Fan: OK', 'Temperature: 38 C (OK)', 'Power supply: OK']) },
    };
    if (priv) {
      tree['running-config'] = {
        help: 'Current operating configuration',
        run: (c) => {
          if (c.args[0]?.toLowerCase().startsWith('int')) {
            const i = this.findIf(c.args.slice(1));
            if (!i || i === 'bad') return this.invalidHere(c);
            c.out(S.showRunIface(this.d, i));
          } else c.out(S.showRun(this.d));
        },
        args: [['interface', 'Show interface configuration']],
      };
      tree['startup-config'] = { help: 'Contents of startup configuration', run: (c) => c.out(S.showStartup(this.d)) };
    }
    return tree;
  }

  private invalidHere(c: RunCtx): void {
    c.err("% Invalid input detected at '^' marker.");
  }

  private needPools(c: RunCtx, fn: () => void): void {
    if (!this.d.ios!.dhcpPools.length) {
      c.out('% This device is not a DHCP server (no pools configured).');
      return;
    }
    fn();
  }

  private natStats(c: RunCtx): void {
    const n = S.showNat(this.e, this.d).length - 1;
    c.out([`Total active translations: ${Math.max(0, n)} (0 static, ${Math.max(0, n)} dynamic; ${Math.max(0, n)} extended)`, 'Outside interfaces:', ...this.d.ifaces.filter((i) => i.nat === 'outside').map((i) => `  ${i.name}`), 'Inside interfaces: ', ...this.d.ifaces.filter((i) => i.nat === 'inside').map((i) => `  ${i.name}`)]);
  }

  private showInterfaces(c: RunCtx): void {
    if (!c.args.length) {
      for (const i of this.d.ifaces) c.out(S.showInterface(this.e, this.d, i));
      return;
    }
    let args = [...c.args];
    let sub: string | null = null;
    const last = args[args.length - 1].toLowerCase();
    if (args.length > 1 && ['switchport', 'status', 'trunk', 'counters'].some((k) => k.startsWith(last) && last.length >= 2)) {
      sub = last;
      args = args.slice(0, -1);
    }
    const i = this.findIf(args);
    if (!i || i === 'bad') return this.invalidHere(c);
    if (sub && 'switchport'.startsWith(sub)) c.out(S.showIntSwitchport(this.e, this.d, i));
    else if (sub && 'status'.startsWith(sub)) c.out(S.showIntStatus(this.e, this.d).filter((l, k) => k === 0 || l.startsWith(shortIf(i.name) + ' ')));
    else c.out(S.showInterface(this.e, this.d, i));
  }

  private showIpInterface(c: RunCtx): void {
    const list = c.args.length ? [this.findIf(c.args)] : this.d.ifaces;
    for (const i of list) {
      if (!i || i === 'bad') return this.invalidHere(c);
      const o = this.e.oper(i);
      const st = o.ipStatus === 'administratively down' ? 'administratively down' : o.ipStatus;
      c.out(`${i.name} is ${st}, line protocol is ${o.proto}`);
      if (!i.ip) {
        c.out('  Internet protocol processing disabled');
        continue;
      }
      c.out([
        `  Internet address is ${i.ip}/${maskToPrefix(i.mask!)}`,
        `  Broadcast address is 255.255.255.255`,
        '  MTU is 1500 bytes',
        `  Helper address is ${i.helper.length ? i.helper.join(', ') : 'not set'}`,
        '  Directed broadcast forwarding is disabled',
        `  Outgoing Common access list is not set `,
        `  Outgoing access list is ${i.aclOut ?? 'not set'}`,
        `  Inbound Common access list is not set `,
        `  Inbound  access list is ${i.aclIn ?? 'not set'}`,
        '  Proxy ARP is enabled',
        '  ICMP unreachables are always sent',
        `  IP fast switching is enabled`,
        `  IP Flow switching is disabled`,
        i.nat ? `  Network address translation is enabled, interface in domain ${i.nat}` : '  Network address translation is disabled',
      ]);
    }
  }

  private showMac(c: RunCtx): void {
    const f: { iface?: string; vlan?: number; mac?: string; dynamicOnly?: boolean } = {};
    const a = c.args.map((x) => x.toLowerCase());
    for (let k = 0; k < a.length; k++) {
      const t = a[k];
      if ('dynamic'.startsWith(t) && t.length >= 2) f.dynamicOnly = true;
      else if ('interface'.startsWith(t) && t.length >= 2) {
        // interface may be given as "gi1/0/1" or "gi 1/0/1"
        let consumed = 1;
        let i = this.findIf([c.args[k + 1] ?? '']);
        if ((i === 'bad' || !i) && c.args[k + 2]) {
          i = this.findIf([c.args[k + 1], c.args[k + 2]]);
          consumed = 2;
        }
        if (!i || i === 'bad') return this.invalidHere(c);
        f.iface = i.name;
        k += consumed;
      } else if ('vlan'.startsWith(t) && t.length >= 1) {
        const v = Number(a[k + 1]);
        if (!Number.isInteger(v)) return this.invalidHere(c);
        f.vlan = v;
        k++;
      } else if ('address'.startsWith(t) && t.length >= 2) {
        const m = c.args[k + 1];
        if (!m || !/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$|^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(m)) {
          c.err('% Invalid MAC address. Use the format H.H.H (e.g. f8bc.1200.1a2b)');
          return;
        }
        f.mac = m;
        k++;
      } else if (t === 'count') {
        const n = this.e.c.macTables.get(this.devId)?.length ?? 0;
        c.out([`Mac Entries for all vlans :`, `Dynamic Address Count  : ${n}`, `Static  Address Count  : 0`, `Total Mac Addresses    : ${n}`]);
        return;
      } else return this.invalidHere(c);
    }
    c.out(S.showMacTable(this.e, this.d, f));
  }

  private clearTree(): Record<string, CmdNode> {
    return {
      'mac': {
        help: 'MAC forwarding table',
        children: {
          'address-table': {
            help: 'MAC forwarding table',
            args: [['dynamic', 'dynamic entry type']],
            run: () => this.out(''),
          },
        },
      },
      counters: {
        help: 'Clear counters on one or all interfaces',
        args: [['<interface>', 'Interface']],
        run: (c) => {
          const i = c.args.length ? this.findIf(c.args) : null;
          if (i === 'bad') return this.invalidHere(c);
          this.confirm = {
            prompt: `Clear "show interface" counters on ${i ? 'this interface' : 'all interfaces'} [confirm]`,
            onAnswer: (ans) => {
              if (ans && !/^y/i.test(ans)) return;
              for (const x of i ? [i] : this.d.ifaces) x.counters = emptyCounters();
              this.e.log(this.devId, `%CLEAR-5-COUNTERS: Clear counter on ${i ? `interface ${i.name}` : 'all interfaces'} by netadmin on vty0`);
            },
          };
        },
      },
      'arp-cache': { help: 'Clear the entire ARP cache', run: () => this.arpWarm.clear() },
      ip: {
        help: 'IP',
        children: {
          dhcp: {
            help: 'Delete items from the DHCP database',
            children: {
              binding: {
                help: 'DHCP address bindings',
                args: [
                  ['*', 'Clear all automatic bindings'],
                  ['A.B.C.D', 'Clear a specific binding'],
                ],
                run: (c) => {
                  const a = c.args[0];
                  if (!a) return c.err('% Incomplete command.');
                  const ios = this.d.ios!;
                  if (a === '*') ios.dhcpBindings = [];
                  else if (isValidIp(a)) {
                    const before = ios.dhcpBindings.length;
                    ios.dhcpBindings = ios.dhcpBindings.filter((b) => b.ip !== a);
                    if (before === ios.dhcpBindings.length) return c.err(`% Address ${a} not in bindings table`);
                  } else return this.invalidHere(c);
                  this.changed('clear ip dhcp binding');
                },
              },
              conflict: {
                help: 'DHCP address conflicts',
                args: [
                  ['*', 'Clear all conflicts'],
                  ['A.B.C.D', 'Clear a specific conflict'],
                ],
                run: (c) => {
                  const a = c.args[0];
                  if (!a) return c.err('% Incomplete command.');
                  const ios = this.d.ios!;
                  ios.dhcpConflicts = a === '*' ? [] : ios.dhcpConflicts.filter((x) => x.ip !== a);
                  this.changed('clear ip dhcp conflict');
                },
              },
            },
          },
          nat: {
            help: 'Clear NAT',
            children: { translation: { help: 'Clear dynamic translation', args: [['*', 'Delete all dynamic translations']], run: () => {} } },
          },
        },
      },
      errdisable: {
        help: 'Clear error disable',
        children: {
          interface: {
            help: 'Clear error disable on an interface',
            args: [['<interface>', 'Interface']],
            run: (c) => {
              const i = this.findIf(c.args);
              if (!i || i === 'bad') return this.invalidHere(c);
              if (!i.errDisabled) return c.out(`% ${shortIf(i.name)} is not err-disabled`);
              i.errDisabled = null;
              this.changed(`clear errdisable ${i.name}`);
            },
          },
        },
      },
      'port-security': {
        help: 'Clear secure MAC addresses',
        children: {
          sticky: {
            help: 'Clear sticky secure MAC addresses',
            args: [['interface', 'Interface']],
            run: (c) => {
              const i = c.args[0]?.toLowerCase().startsWith('i') ? this.findIf(c.args.slice(1)) : null;
              if (i === 'bad') return this.invalidHere(c);
              for (const x of i ? [i] : this.d.ifaces) if (x.portSecurity) x.portSecurity.secureMacs = [];
              this.changed('clear port-security sticky');
            },
          },
          all: {
            help: 'Clear all secure MAC addresses',
            run: () => {
              for (const x of this.d.ifaces) if (x.portSecurity) x.portSecurity.secureMacs = [];
              this.changed('clear port-security all');
            },
          },
        },
      },
    };
  }

  private save(): void {
    this.out('Building configuration...');
    this.d.ios!.startup = snapshotConfig(this.d);
    this.out('[OK]');
    this.api.recordChange(this.devId, 'write memory');
  }

  private confirmSave(ask: boolean): void {
    if (!ask) return this.save();
    this.confirm = {
      prompt: 'Destination filename [startup-config]? ',
      onAnswer: (a) => {
        if (a && a !== 'startup-config') return this.err('% Only startup-config is supported as a destination here.');
        this.save();
      },
    };
  }

  private reload(): void {
    const proceed = () => {
      this.confirm = {
        prompt: 'Proceed with reload? [confirm]',
        onAnswer: (a) => {
          if (a && !/^y/i.test(a)) {
            this.out('Reload cancelled.');
            return;
          }
          this.out(['', `%SYS-5-RELOAD: Reload requested by netadmin on console. Reload Reason: Reload Command.`, '', '[Connection lost — device is reloading. Unsaved changes are discarded.]']);
          this.mode = 'user';
          this.api.reloadDevice(this.devId);
        },
      };
    };
    if (isUnsaved(this.d)) {
      this.confirm = {
        prompt: 'System configuration has been modified. Save? [yes/no]: ',
        onAnswer: (a) => {
          if (/^y/i.test(a)) this.save();
          else if (!/^n/i.test(a)) {
            this.err('% Please answer "yes" or "no".');
            return;
          }
          proceed();
        },
      };
    } else proceed();
  }

  // -------------------------------------------------------------------------
  // ping / traceroute

  private resolveTarget(c: RunCtx, target: string): string | null {
    if (isValidIp(target)) return target;
    if (/^\d+(\.\d+)*$/.test(target)) {
      c.err('% Unrecognized host or address, or protocol not running.');
      return null;
    }
    const r = this.e.resolve(this.devId, target);
    if (!r.ok || !r.ip) {
      c.out(`Translating "${target}"...domain server (${this.d.ios?.nameServers[0] ?? 'none'})`);
      c.err('% Unrecognized host or address, or protocol not running.');
      return null;
    }
    c.out(`Translating "${target}"...domain server (${r.server}) [OK]`);
    return r.ip;
  }

  private ping(c: RunCtx): void {
    if (!c.args.length) return c.err('% Extended ping is not supported here. Use: ping <address> [repeat <n>] [source <interface>]');
    const target = c.args[0];
    let repeat = 5;
    let srcIp: string | undefined;
    for (let k = 1; k < c.args.length; k++) {
      const t = c.args[k].toLowerCase();
      if ('repeat'.startsWith(t)) {
        repeat = Math.max(1, Math.min(50, Number(c.args[++k]) || 5));
      } else if ('source'.startsWith(t)) {
        let i = this.findIf([c.args[k + 1] ?? '']);
        let used = 1;
        if ((!i || i === 'bad') && c.args[k + 2]) {
          i = this.findIf([c.args[k + 1], c.args[k + 2]]);
          used = 2;
        }
        if (!i || i === 'bad' || !i.ip) return c.err('% Invalid source interface - Interface has no IP address');
        srcIp = i.ip;
        k += used;
      } else if ('size'.startsWith(t) || 'timeout'.startsWith(t)) k++;
      else return this.invalidHere(c);
    }
    const ip = this.resolveTarget(c, target);
    if (!ip) return;
    c.out(['Type escape sequence to abort.', `Sending ${repeat}, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`]);
    if (srcIp) c.out(`Packet sent with a source address of ${srcIp} `);
    const r = this.e.roundTrip(this.devId, ip, 'icmp', 0, true, srcIp);
    let res = '';
    let okN = 0;
    if (r.ok && (r.fwd.external ? r.fwd.external.icmp : true)) {
      const cold = !this.arpWarm.has(ip) && r.fwd.hops.length <= 1 && !r.fwd.external;
      this.arpWarm.add(ip);
      for (let k = 0; k < repeat; k++) {
        const success = !(k === 0 && cold) && Math.random() < Math.max(0.02, r.quality + 0.04);
        res += success ? '!' : '.';
        if (success) okN++;
      }
    } else {
      const unreachable = !!r.fwd.unreachableFrom && r.fwd.unreachableFrom !== this.devId;
      for (let k = 0; k < repeat; k++) res += unreachable && k % 2 === 0 ? 'U' : '.';
    }
    c.out(res);
    const pct = Math.round((okN / repeat) * 100);
    if (okN) {
      const base = Math.max(1, Math.round(r.latencyMs));
      c.out(`Success rate is ${pct} percent (${okN}/${repeat}), round-trip min/avg/max = ${Math.max(1, base - 1)}/${base}/${base + 2 + Math.round((1 - r.quality) * 40)} ms`);
    } else c.out(`Success rate is 0 percent (0/${repeat})`);
  }

  private traceroute(c: RunCtx): void {
    if (!c.args.length) return c.err('% Incomplete command.');
    const ip = this.resolveTarget(c, c.args[0]);
    if (!ip) return;
    c.out(['Type escape sequence to abort.', `Tracing the route to ${ip}`, 'VRF info: (vrf in name/id, vrf out name/id)']);
    const r = this.e.roundTrip(this.devId, ip, 'icmp', 0, true);
    const hops = r.fwd.hops;
    let n = 0;
    const ms = () => `${1 + Math.floor(Math.random() * 3)} msec`;
    for (const [k, h] of hops.entries()) {
      n++;
      if (!this.e.hopReplies(r.fwd, k)) {
        c.out(`  ${n}  *  *  * `);
        continue;
      }
      if (h.dev === 'isp-gw' && r.fwd.external) {
        c.out(`  ${n} ${h.ip} ${ms()} ${ms()} ${ms()}`);
        if (this.e.net.ispOutage && !this.e.net.lteBackup) break;
        for (const x of ['100.64.18.1', '62.115.40.97']) c.out(`  ${++n} ${x} ${8 + n} msec ${9 + n} msec ${8 + n} msec`);
        continue;
      }
      if (!r.ok && h === hops[hops.length - 1] && r.fwd.code === 'acl') {
        c.out(`  ${n} ${h.ip} !A  !A  !A `);
        return;
      }
      c.out(`  ${n} ${h.ip} ${ms()} ${ms()} ${ms()}`);
    }
    if (r.ok && r.fwd.external) {
      c.out(`  ${++n} ${ip} ${16 + n} msec ${17 + n} msec ${16 + n} msec`);
      return;
    }
    if (r.ok) return;
    for (let k = 0; k < 4; k++) c.out(`  ${++n}  *  *  * `);
    c.out('(no further replies — trace stopped)');
  }

  // -------------------------------------------------------------------------
  // CONFIG modes

  private modeTree(): Record<string, CmdNode> {
    const common: Record<string, CmdNode> = {
      exit: { help: 'Exit from current mode', run: () => this.exitMode() },
      end: { help: 'Exit to privileged EXEC mode', run: () => this.end() },
      do: { help: 'To run exec commands in config mode', args: [['LINE', 'Exec command']], run: () => {} },
    };
    switch (this.mode) {
      case 'config':
        return { ...this.globalTree(), ...common };
      case 'if':
        return { ...this.ifTree(), ...common };
      case 'vlan':
        return {
          name: {
            help: 'Ascii name of the VLAN',
            args: [['WORD', 'The ascii name for the VLAN']],
            run: (c) => {
              for (const v of this.vlanCtx) this.d.ios!.vlans[String(v)] = c.neg ? `VLAN${String(v).padStart(4, '0')}` : c.args[0] ?? '';
              if (!c.neg && !c.args[0]) return c.err('% Incomplete command.');
              this.changed('vlan name');
            },
          },
          ...common,
        };
      case 'dhcp':
        return { ...this.dhcpTree(), ...common };
      case 'acl':
        return { ...this.aclTree(), ...common };
      case 'line':
        return {
          'logging': { help: 'Modify message logging facilities', args: [['synchronous', 'Synchronized message output']], run: () => {} },
          'transport': { help: 'Define transport protocols for line', args: [['input', 'Define which protocols to use when connecting to the terminal server']], run: () => {} },
          password: { help: 'Set a password', run: (c) => c.out(OOS('Line password management') + ' (accepted, no effect)') },
          login: { help: 'Enable password checking', run: () => {} },
          'exec-timeout': { help: 'Set the EXEC timeout', run: () => {} },
          ...common,
        };
      default:
        return common;
    }
  }

  private globalTree(): Record<string, CmdNode> {
    const ios = () => this.d.ios!;
    const sw = this.isSwitch();
    const t: Record<string, CmdNode> = {
      hostname: {
        help: "Set system's network name",
        args: [['WORD', "This system's network name"]],
        run: (c) => {
          if (c.neg) return c.err('% Hostname cannot be removed in this simulation.');
          const h = c.args[0];
          if (!h) return c.err('% Incomplete command.');
          if (!/^[A-Za-z][\w-]{0,62}$/.test(h)) return c.err('% Hostname contains one or more illegal characters.');
          this.d.name = h;
          this.changed(`hostname ${h}`);
        },
      },
      interface: {
        help: 'Select an interface to configure',
        args: [['<interface>', 'e.g. GigabitEthernet1/0/1, Vlan10']],
        run: (c) => this.cmdInterface(c),
        children: { range: { help: 'interface range command', args: [['<range>', 'e.g. gi1/0/1 - 4']], run: (c) => this.cmdIfRange(c) } },
      },
      ip: { help: 'Global IP configuration subcommands', children: this.globalIpTree() },
      'access-list': { help: 'Add an access list entry', args: [['<1-199>', 'IP access list number']], run: (c) => this.cmdNumberedAcl(c) },
      banner: {
        help: 'Define a login banner',
        children: {
          motd: {
            help: 'Set Message of the Day banner',
            args: [['LINE', 'c banner-text c, where c is a delimiting character']],
            run: (c) => {
              ios().bannerMotd = c.neg ? '' : c.rest.replace(/^(\S)(.*)\1$/, '$2').trim();
              this.changed('banner motd');
            },
          },
        },
      },
      enable: {
        help: 'Modify enable password parameters',
        children: {
          secret: {
            help: 'Assign the privileged level secret',
            args: [['LINE', 'The secret']],
            run: (c) => {
              ios().enableSecret = c.neg ? null : 'set';
              this.changed('enable secret');
              if (!c.neg) c.out('% Secret stored. (Password prompts are not simulated.)');
            },
          },
          password: { help: 'Assign the privileged level password', run: (c) => c.err('% Use "enable secret" — plain enable passwords are deprecated.') },
        },
      },
      line: {
        help: 'Configure a terminal line',
        args: [
          ['console', 'Primary terminal line'],
          ['vty', 'Virtual terminal'],
        ],
        run: () => (this.mode = 'line'),
      },
      'spanning-tree': { help: 'Spanning Tree Subsystem', args: [['mode', 'Spanning tree operating mode']], run: (c) => c.err(OOS('Changing global spanning-tree settings') + ' (rapid-pvst is fixed)') },
      cdp: { help: 'Global CDP configuration subcommands', children: { run: { help: 'Enable CDP', run: (c) => c.neg && c.err('% Disabling CDP is not modelled (CDP stays enabled).') } } },
      errdisable: { help: 'Error disable', run: (c) => c.err(OOS('Automatic err-disable recovery') + ' Recover ports with "shutdown" then "no shutdown".') },
      username: { help: 'Establish User Name Authentication', run: (c) => c.err(OOS('Local user management')) },
      service: { help: 'Modify use of network based services', run: () => {} },
      'router': { help: 'Enable a routing process', run: (c) => c.err(OOS('Dynamic routing protocols') + ' This network uses static routes ("ip route").') },
      'vtp': { help: 'Configure global VTP state', run: (c) => c.err(OOS('VTP') + ' VLANs are configured locally on each switch (transparent mode).') },
      'ntp': { help: 'Configure NTP', run: (c) => c.err(OOS('NTP configuration')) },
      'snmp-server': { help: 'Modify SNMP engine parameters', run: (c) => c.err(OOS('SNMP configuration')) },
    };
    if (sw) {
      t.vlan = { help: 'VLAN commands', args: [['<1-4094>', 'ISL VLAN IDs 1-1005; 802.1Q VLAN IDs 1-4094']], run: (c) => this.cmdVlan(c) };
    }
    return t;
  }

  private globalIpTree(): Record<string, CmdNode> {
    const ios = () => this.d.ios!;
    const d = this.d;
    const t: Record<string, CmdNode> = {
      route: {
        help: 'Establish static routes',
        args: [['A.B.C.D', 'Destination prefix']],
        run: (c) => this.cmdIpRoute(c),
      },
      'default-gateway': {
        help: 'Specify default gateway (if not routing IP)',
        args: [['A.B.C.D', 'IP address of default gateway']],
        run: (c) => {
          if (c.neg) ios().defaultGateway = null;
          else {
            const ip = this.parseIp(c.args[0], c);
            if (!ip) return;
            ios().defaultGateway = ip;
          }
          this.changed('ip default-gateway');
        },
      },
      dhcp: {
        help: 'Configure DHCP server and relay parameters',
        children: {
          pool: {
            help: 'Configure DHCP address pools',
            args: [['WORD', 'Pool name']],
            run: (c) => {
              const name = c.args[0];
              if (!name) return c.err('% Incomplete command.');
              const pools = ios().dhcpPools;
              if (c.neg) {
                const i = pools.findIndex((p) => p.name === name);
                if (i < 0) return c.err(`% Pool ${name} does not exist.`);
                pools.splice(i, 1);
                this.changed(`no ip dhcp pool ${name}`);
                return;
              }
              if (!pools.find((p) => p.name === name)) {
                pools.push({ name, network: null, mask: null, defaultRouter: [], dns: [], domain: '', leaseDays: 1, leaseHours: 0 });
                this.changed(`ip dhcp pool ${name}`);
              }
              this.poolCtx = name;
              this.mode = 'dhcp';
            },
          },
          'excluded-address': {
            help: 'Prevent DHCP from assigning certain addresses',
            args: [
              ['A.B.C.D', 'Low IP address'],
              ['A.B.C.D', 'High IP address'],
            ],
            run: (c) => {
              const a = this.parseIp(c.args[0], c);
              if (!a) return;
              const b = c.args[1] ? this.parseIp(c.args[1], c) : a;
              if (!b) return;
              if (cmpIp(a, b) > 0) return c.err('% Invalid address range: low address is higher than high address');
              const ex = ios().dhcpExcluded;
              if (c.neg) {
                const i = ex.findIndex((x) => x.start === a && x.end === b);
                if (i < 0) return c.err(`% Range [${a}, ${b}] is not in the excluded list`);
                ex.splice(i, 1);
              } else if (!ex.some((x) => x.start === a && x.end === b)) ex.push({ start: a, end: b });
              this.changed('ip dhcp excluded-address');
            },
          },
          snooping: {
            help: 'DHCP Snooping',
            run: (c) => {
              if (!this.isSwitch()) return this.invalidHere(c);
              ios().dhcpSnooping.enabled = !c.neg;
              this.changed('ip dhcp snooping');
            },
            children: {
              vlan: {
                help: 'DHCP Snooping vlan',
                args: [['WORD', 'DHCP Snooping vlan first number or vlan range, example: 1,3-5,7,9-11']],
                run: (c) => {
                  if (!this.isSwitch()) return this.invalidHere(c);
                  const l = parseVlanList(c.args.join(''));
                  if (!l || l === 'all') return c.err('% Invalid VLAN list');
                  const sn = ios().dhcpSnooping;
                  sn.vlans = c.neg ? sn.vlans.filter((v) => !l.includes(v)) : [...new Set([...sn.vlans, ...l])].sort((x, y) => x - y);
                  this.changed('ip dhcp snooping vlan');
                },
              },
            },
          },
        },
      },
      'access-list': {
        help: 'Named access list',
        children: {
          extended: { help: 'Extended Access List', args: [['WORD', 'Access-list name']], run: (c) => this.cmdNamedAcl(c, 'extended') },
          standard: { help: 'Standard Access List', args: [['WORD', 'Access-list name']], run: (c) => this.cmdNamedAcl(c, 'standard') },
        },
      },
      nat: {
        help: 'NAT configuration commands',
        children: {
          inside: {
            help: 'Inside address translation',
            children: {
              source: {
                help: 'Source address translation',
                children: {
                  list: { help: 'Specify access list describing local addresses', args: [['WORD', 'Access list name']], run: (c) => this.cmdNat(c) },
                  static: { help: 'Specify static local->global mapping', run: (c) => c.err(OOS('Changing static NAT') + ' (the customer-portal static PAT is pre-provisioned)') },
                },
              },
            },
          },
        },
      },
      'name-server': {
        help: 'Specify address of name server to use',
        args: [['A.B.C.D', 'Domain server IP address']],
        run: (c) => {
          if (c.neg) ios().nameServers = c.args.length ? ios().nameServers.filter((s) => !c.args.includes(s)) : [];
          else {
            for (const a of c.args) if (!this.parseIp(a, c)) return;
            ios().nameServers = [...new Set([...ios().nameServers, ...c.args])].slice(0, 6);
          }
          this.changed('ip name-server');
        },
      },
      'domain-name': { help: 'Define the default domain name', args: [['WORD', 'Default domain name']], run: (c) => this.setDomain(c) },
      domain: {
        help: 'IP DNS Resolver',
        children: {
          name: { help: 'Define the default domain name', args: [['WORD', 'Default domain name']], run: (c) => this.setDomain(c) },
          lookup: { help: 'Enable IP Domain Name System hostname translation', run: () => {} },
        },
      },
      'ssh': { help: 'Configure ssh options', run: () => {} },
    };
    if (d.kind === 'l3switch') {
      t.routing = {
        help: 'Enable IP routing',
        run: (c) => {
          ios().ipRouting = !c.neg;
          this.changed(c.neg ? 'no ip routing' : 'ip routing');
          if (c.neg) c.out('% Warning: inter-VLAN routing is now disabled on this switch.');
        },
      };
    }
    return t;
  }

  private setDomain(c: RunCtx): void {
    this.d.ios!.domainName = c.neg ? '' : (c.args[0] ?? '');
    this.changed('ip domain name');
  }

  private cmdVlan(c: RunCtx): void {
    const l = parseVlanList(c.args.join(''));
    if (!l || l === 'all' || !l.length) return c.err('% Invalid VLAN list. Use a number 1-4094 or a range like 10,20-22');
    const vl = this.d.ios!.vlans;
    if (c.neg) {
      for (const v of l) {
        if (v === 1 || (v >= 1002 && v <= 1005)) {
          c.err(`%Default VLAN ${v} may not be deleted.`);
          continue;
        }
        if (!vl[String(v)]) continue;
        delete vl[String(v)];
      }
      this.changed(`no vlan ${formatVlanList(l)}`);
      return;
    }
    for (const v of l) {
      if (v >= 1002 && v <= 1005) {
        c.err(`%Default VLAN ${v} may not be modified.`);
        return;
      }
      if (!vl[String(v)]) vl[String(v)] = `VLAN${String(v).padStart(4, '0')}`;
    }
    this.vlanCtx = l;
    this.mode = 'vlan';
    this.changed(`vlan ${formatVlanList(l)}`);
  }

  private cmdInterface(c: RunCtx): void {
    if (c.neg) {
      const i = this.findIf(c.args);
      if (i && i !== 'bad' && i.type === 'svi') {
        this.d.ifaces = this.d.ifaces.filter((x) => x !== i);
        this.changed(`no interface ${i.name}`);
        return;
      }
      return c.err('% Physical interfaces cannot be removed.');
    }
    if (!c.args.length) return c.err('% Incomplete command.');
    let i = this.findIf(c.args);
    if (i === 'bad') {
      const name = normalizeIfName(c.args.join(''));
      if (name && /^Vlan\d+$/.test(name) && this.isSwitch()) {
        const v = Number(name.slice(4));
        if (v < 1 || v > 4094) return c.err('% Invalid VLAN number');
        const nm = makeIface(this.devId, name, this.d.ifaces[0].mac.slice(0, 15) + (v % 256).toString(16).padStart(2, '0'), { type: 'svi' });
        this.d.ifaces.push(nm);
        i = nm;
        this.changed(`interface ${name}`);
      } else return this.invalidHere(c);
    }
    this.ifCtx = [i!.name];
    this.mode = 'if';
  }

  private cmdIfRange(c: RunCtx): void {
    const text = c.args.join(' ').replace(/\s*-\s*/g, '-');
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
    const names: string[] = [];
    for (const p of parts) {
      const m = /^([a-zA-Z]+)\s*(\d+\/\d+\/)(\d+)(?:-(\d+))?$/.exec(p.replace(/\s+/g, ''));
      if (!m) return c.err('% Invalid interface range. Example: interface range gi1/0/1 - 4');
      const a = Number(m[3]);
      const b = m[4] ? Number(m[4]) : a;
      if (b < a) return c.err('% Invalid range');
      for (let k = a; k <= b; k++) {
        const n = normalizeIfName(`${m[1]}${m[2]}${k}`);
        const i = n && this.d.ifaces.find((x) => x.name === n);
        if (!i) return c.err(`% Interface ${m[1]}${m[2]}${k} does not exist`);
        names.push(i.name);
      }
    }
    if (!names.length) return c.err('% Incomplete command.');
    this.ifCtx = names;
    this.mode = 'if';
  }

  private cmdIpRoute(c: RunCtx): void {
    const [net, mask, ...rest] = c.args;
    const ios = this.d.ios!;
    if (this.d.kind === 'switch') return c.err('% IP routing is not enabled on this layer-2 switch. Use "ip default-gateway".');
    if (!net || !mask) return c.err('% Incomplete command.');
    if (!isValidIp(net)) return this.invalidHere(c);
    if (!isValidMask(mask)) return c.err(`% Invalid mask ${mask}`);
    if (networkOf(net, mask) !== net) return c.err('%Inconsistent address and mask');
    let nh: string | null = null;
    let iface: string | null = null;
    let ad = 1;
    for (const a of rest) {
      if (isValidIp(a) && !nh) nh = a;
      else if (/^\d+$/.test(a)) ad = Math.max(1, Math.min(255, Number(a)));
      else {
        const n = normalizeIfName(a);
        const i = n && this.d.ifaces.find((x) => x.name === n);
        if (!i) return this.invalidHere(c);
        iface = i.name;
      }
    }
    if (c.neg) {
      const before = ios.routes.length;
      ios.routes = ios.routes.filter((r) => !(r.net === net && r.mask === mask && (!nh || r.nextHop === nh) && (!iface || r.iface === iface)));
      if (before === ios.routes.length) return c.err('%No matching route to delete');
      this.changed(`no ip route ${net} ${mask}`);
      return;
    }
    if (!nh && !iface) return c.err('% Incomplete command.');
    if (nh && this.d.ifaces.some((i) => i.ip === nh)) return c.err('%Invalid next hop address (it\'s this router)');
    if (ios.routes.some((r) => r.net === net && r.mask === mask && r.nextHop === nh && r.iface === iface)) return;
    ios.routes.push({ net, mask, nextHop: nh, iface, ad });
    this.changed(`ip route ${net} ${mask} ${nh ?? iface}`);
  }

  private cmdNat(c: RunCtx): void {
    const [acl, kw, ...ifParts] = c.args;
    const ios = this.d.ios!;
    if (this.d.kind !== 'firewall') return c.err('% NAT is configured on the edge firewall (FW-EDGE) in this network.');
    if (c.neg) {
      ios.natRules = ios.natRules.filter((n) => n.acl !== acl);
      this.changed('no ip nat inside source');
      return;
    }
    if (!acl || !kw || !'interface'.startsWith(kw.toLowerCase())) return c.err('% Incomplete command. Usage: ip nat inside source list <acl> interface <iface> overload');
    const overload = ifParts[ifParts.length - 1]?.toLowerCase() === 'overload';
    const i = this.findIf(overload ? ifParts.slice(0, -1) : ifParts);
    if (!i || i === 'bad') return this.invalidHere(c);
    ios.natRules = ios.natRules.filter((n) => n.acl !== acl);
    ios.natRules.push({ acl, outsideIface: i.name, overload });
    if (!overload) c.out('% Note: without "overload" only one inside host can be translated at a time (PAT disabled).');
    this.changed('ip nat inside source list');
  }

  // --- ACLs -----------------------------------------------------------------

  private cmdNamedAcl(c: RunCtx, type: 'standard' | 'extended'): void {
    const name = c.args[0];
    if (!name) return c.err('% Incomplete command.');
    const ios = this.d.ios!;
    if (c.neg) {
      const before = ios.acls.length;
      ios.acls = ios.acls.filter((a) => a.name !== name);
      if (before !== ios.acls.length) this.changed(`no ip access-list ${name}`);
      return;
    }
    const ex = ios.acls.find((a) => a.name === name);
    if (ex && ex.type !== type) return c.err(`% A named ${ex.type} IP access list with this name already exists`);
    if (!ex) ios.acls.push({ name, type, entries: [] });
    this.aclCtx = name;
    this.mode = 'acl';
  }

  private cmdNumberedAcl(c: RunCtx): void {
    const num = Number(c.args[0]);
    if (!Number.isInteger(num) || num < 1 || num > 199) return c.err('% Invalid access list number (1-99 standard, 100-199 extended)');
    const ios = this.d.ios!;
    const name = String(num);
    if (c.neg && c.args.length === 1) {
      ios.acls = ios.acls.filter((a) => a.name !== name);
      this.changed(`no access-list ${name}`);
      return;
    }
    const type = num < 100 ? 'standard' : 'extended';
    let acl = ios.acls.find((a) => a.name === name);
    if (!acl) {
      acl = { name, type, entries: [] };
      ios.acls.push(acl);
    }
    if (c.args[1]?.toLowerCase() === 'remark') {
      return;
    }
    const parsed = parseAce(c.args.slice(1), type);
    if (typeof parsed === 'string') return c.err(parsed);
    if (c.neg) return c.err('% Use "no access-list <n>" to delete a numbered list, or edit it as a named list.');
    parsed.seq = (acl.entries.reduce((m, e) => Math.max(m, e.seq), 0) || 0) + 10;
    acl.entries.push(parsed);
    this.changed(`access-list ${name}`);
  }

  private aclSeq(seq: number, rest: string[], neg: boolean): void {
    const acl = this.acl();
    if (!acl) return this.err('% Access list no longer exists');
    if (seq < 1 || seq > 2147483647) return this.err('% Invalid sequence number');
    if (neg) {
      const i = acl.entries.findIndex((e) => e.seq === seq);
      if (i < 0) return this.err(`% Entry ${seq} does not exist`);
      acl.entries.splice(i, 1);
      this.changed(`ACL ${acl.name} entry ${seq} removed`);
      return;
    }
    if (!rest.length) return this.err('% Incomplete command.');
    if (rest[0].toLowerCase() === 'remark') return;
    const parsed = parseAce(rest, acl.type);
    if (typeof parsed === 'string') return this.err(parsed);
    if (acl.entries.some((e) => e.seq === seq)) return this.err('% Duplicate sequence number');
    if (acl.entries.some((e) => aceKey(e) === aceKey(parsed))) return this.err('% Duplicate entry — this rule already exists');
    parsed.seq = seq;
    acl.entries.push(parsed);
    acl.entries.sort((a, b) => a.seq - b.seq);
    this.changed(`ACL ${acl.name} entry ${seq} added`);
    this.api.onCommand(this.devId, `acl ${rest.join(' ')}`, rest.join(' '));
  }

  private aclTree(): Record<string, CmdNode> {
    const run = (c: RunCtx, action: 'permit' | 'deny', seq?: number) => {
      const acl = this.acl();
      if (!acl) return c.err('% Access list no longer exists');
      const parsed = parseAce([action, ...c.args], acl.type);
      if (typeof parsed === 'string') return c.err(parsed);
      if (c.neg) {
        const i = acl.entries.findIndex((e) => aceKey(e) === aceKey(parsed));
        if (i < 0) return c.err('% Matching entry not found');
        acl.entries.splice(i, 1);
        this.changed(`ACL ${acl.name} entry removed`);
        return;
      }
      if (seq !== undefined) {
        if (acl.entries.some((e) => e.seq === seq)) return c.err('% Duplicate sequence number');
        parsed.seq = seq;
      } else parsed.seq = acl.entries.reduce((m, e) => Math.max(m, e.seq), 0) + 10;
      if (acl.entries.some((e) => aceKey(e) === aceKey(parsed))) return c.err('% Duplicate entry — this rule already exists');
      acl.entries.push(parsed);
      acl.entries.sort((a, b) => a.seq - b.seq);
      this.changed(`ACL ${acl.name} entry ${parsed.seq} added`);
    };
    const t: Record<string, CmdNode> = {
      permit: { help: 'Specify packets to forward', args: [['<proto>', 'ip | tcp | udp | icmp']], run: (c) => run(c, 'permit') },
      deny: { help: 'Specify packets to reject', args: [['<proto>', 'ip | tcp | udp | icmp']], run: (c) => run(c, 'deny') },
      remark: {
        help: 'Access list entry comment',
        args: [['LINE', 'Comment up to 100 characters long']],
        run: (c) => {
          const acl = this.acl();
          if (!acl) return;
          const last = acl.entries[acl.entries.length - 1];
          if (last) last.remark = c.rest;
          this.changed('ACL remark');
        },
      },
    };
    return t;
  }

  private dhcpTree(): Record<string, CmdNode> {
    const pool = () => this.d.ios!.dhcpPools.find((p) => p.name === this.poolCtx);
    return {
      network: {
        help: 'Network number and mask',
        args: [
          ['A.B.C.D', 'Network number in dotted-decimal notation'],
          ['A.B.C.D or /nn', 'Network mask or prefix length'],
        ],
        run: (c) => {
          const p = pool();
          if (!p) return;
          if (c.neg) {
            p.network = null;
            p.mask = null;
            this.changed('dhcp network removed');
            return;
          }
          const n = this.parseIp(c.args[0], c, 'network');
          if (!n) return;
          let m = c.args[1];
          if (!m) return c.err('% Incomplete command.');
          if (/^\/\d+$/.test(m)) m = prefixToMask(Number(m.slice(1)));
          if (!isValidMask(m)) return c.err(`% Invalid mask ${m}`);
          if (networkOf(n, m) !== n) return c.err(`% ${n} is not a network address for mask ${m}`);
          const clash = this.d.ios!.dhcpPools.find((o) => o !== p && o.network && o.mask && sameSubnet(o.network, n, m!));
          if (clash) return c.err(`% ${n}/${maskToPrefix(m)} overlaps with pool ${clash.name}`);
          p.network = n;
          p.mask = m;
          this.changed(`dhcp pool ${p.name} network`);
        },
      },
      'default-router': {
        help: 'Default routers',
        args: [['A.B.C.D', 'Router\'s IP address']],
        run: (c) => {
          const p = pool();
          if (!p) return;
          if (c.neg) p.defaultRouter = [];
          else {
            if (!c.args.length) return c.err('% Incomplete command.');
            for (const a of c.args) if (!this.parseIp(a, c)) return;
            p.defaultRouter = c.args.slice(0, 8);
          }
          this.changed(`dhcp pool ${p.name} default-router`);
        },
      },
      'dns-server': {
        help: 'DNS servers',
        args: [['A.B.C.D', 'Server\'s IP address']],
        run: (c) => {
          const p = pool();
          if (!p) return;
          if (c.neg) p.dns = [];
          else {
            if (!c.args.length) return c.err('% Incomplete command.');
            for (const a of c.args) if (!this.parseIp(a, c)) return;
            p.dns = c.args.slice(0, 8);
          }
          this.changed(`dhcp pool ${p.name} dns-server`);
        },
      },
      'domain-name': {
        help: 'Domain name',
        args: [['WORD', 'Domain name']],
        run: (c) => {
          const p = pool();
          if (!p) return;
          p.domain = c.neg ? '' : (c.args[0] ?? '');
          this.changed(`dhcp pool ${p.name} domain-name`);
        },
      },
      lease: {
        help: 'Address lease time',
        args: [
          ['<0-365>', 'Days'],
          ['infinite', 'Infinite lease'],
        ],
        run: (c) => {
          const p = pool();
          if (!p) return;
          if (c.neg) {
            p.leaseDays = 1;
            p.leaseHours = 0;
          } else if (c.args[0]?.toLowerCase().startsWith('inf')) {
            p.leaseDays = 365000;
            p.leaseHours = 0;
          } else {
            const dd = Number(c.args[0]);
            const hh = Number(c.args[1] ?? 0);
            if (!Number.isInteger(dd) || dd < 0 || dd > 365 || !Number.isInteger(hh) || hh < 0 || hh > 23) return c.err('% Invalid lease. Usage: lease <days 0-365> [hours 0-23] | infinite');
            if (dd === 0 && hh === 0 && !(Number(c.args[2]) > 0)) return c.err('% Lease time must be greater than zero');
            p.leaseDays = dd;
            p.leaseHours = hh;
          }
          this.changed(`dhcp pool ${p.name} lease`);
        },
      },
      'option': { help: 'Raw DHCP options', run: (c) => c.err(OOS('Raw DHCP options')) },
      host: { help: 'Client IP address and mask', run: (c) => c.err(OOS('Manual DHCP bindings') + ' Use excluded-address and static IPs instead.') },
    };
  }

  // --- interface config -----------------------------------------------------

  private ifTree(): Record<string, CmdNode> {
    const each = (c: RunCtx, fn: (i: Iface) => string | void, what: string) => {
      for (const i of this.ifaces()) {
        const r = fn(i);
        if (typeof r === 'string') {
          c.err(r);
          return;
        }
      }
      this.changed(`${this.ifaces().map((i) => shortIf(i.name)).join(',')}: ${what}`);
    };
    const swOnly = (i: Iface): string | null => {
      if (!this.isSwitch() || i.type === 'svi') return "% Invalid input detected at '^' marker.";
      if (!i.switchport) return '% This is a routed port. Use "switchport" first to make it a layer-2 port.';
      return null;
    };
    const t: Record<string, CmdNode> = {
      description: {
        help: 'Interface specific description',
        args: [['LINE', 'Up to 240 characters describing this interface']],
        run: (c) => each(c, (i) => void (i.description = c.neg ? '' : c.rest.slice(0, 240)), 'description'),
      },
      shutdown: {
        help: 'Shutdown the selected interface',
        run: (c) =>
          each(
            c,
            (i) => {
              if (c.neg) i.shutdown = false;
              else {
                i.shutdown = true;
                i.errDisabled = null;
              }
            },
            c.neg ? 'no shutdown' : 'shutdown',
          ),
      },
      ip: {
        help: 'Interface Internet Protocol config commands',
        children: {
          address: {
            help: 'Set the IP address of an interface',
            args: [
              ['A.B.C.D', 'IP address'],
              ['A.B.C.D', 'IP subnet mask'],
            ],
            run: (c) => this.cmdIpAddress(c),
          },
          'helper-address': {
            help: 'Specify a destination address for UDP broadcasts',
            args: [['A.B.C.D', 'IP destination address']],
            run: (c) =>
              each(
                c,
                (i) => {
                  if (c.neg) i.helper = c.args[0] ? i.helper.filter((h) => h !== c.args[0]) : [];
                  else {
                    if (!c.args[0] || !isValidIp(c.args[0])) return '% Incomplete command.';
                    if (!i.helper.includes(c.args[0])) i.helper.push(c.args[0]);
                  }
                },
                'ip helper-address',
              ),
          },
          'access-group': {
            help: 'Specify access control for packets',
            args: [
              ['WORD', 'Access-list name'],
              ['in|out', 'direction'],
            ],
            run: (c) =>
              each(
                c,
                (i) => {
                  if (i.switchport && this.isSwitch() && i.type !== 'svi') return '% ACLs are applied to SVIs or routed ports in this network (port ACLs are not modelled).';
                  const dirTok = (c.args.length === 1 ? c.args[0] : c.args[1])?.toLowerCase();
                  const name = c.args.length === 1 ? null : c.args[0];
                  if (dirTok !== 'in' && dirTok !== 'out') return '% Incomplete command. Usage: ip access-group <name> in|out';
                  if (c.neg) {
                    if (dirTok === 'in') i.aclIn = null;
                    else i.aclOut = null;
                    return;
                  }
                  if (!name) return '% Incomplete command.';
                  if (dirTok === 'in') i.aclIn = name;
                  else i.aclOut = name;
                  if (!this.d.ios!.acls.some((a) => a.name === name)) this.out(`% Note: access list ${name} does not exist yet — an undefined ACL permits all traffic.`);
                },
                'ip access-group',
              ),
          },
          nat: {
            help: 'NAT interface commands',
            args: [
              ['inside', 'Inside interface for address translation'],
              ['outside', 'Outside interface for address translation'],
            ],
            run: (c) =>
              each(
                c,
                (i) => {
                  if (this.d.kind !== 'firewall') return '% NAT is configured on the edge firewall in this network.';
                  const a = c.args[0]?.toLowerCase();
                  if (c.neg) {
                    i.nat = null;
                    return;
                  }
                  if (a !== 'inside' && a !== 'outside') return '% Incomplete command.';
                  i.nat = a;
                },
                'ip nat',
              ),
          },
          dhcp: {
            help: 'Configure DHCP parameters for this interface',
            children: {
              snooping: {
                help: 'DHCP Snooping',
                children: {
                  trust: {
                    help: 'DHCP Snooping trust config',
                    run: (c) =>
                      each(
                        c,
                        (i) => {
                          const s = swOnly(i);
                          if (s) return s;
                          i.dhcpSnoopTrust = !c.neg;
                        },
                        'ip dhcp snooping trust',
                      ),
                  },
                },
              },
            },
          },
          ospf: { help: 'OSPF interface commands', run: (c) => c.err(OOS('OSPF')) },
        },
      },
      speed: {
        help: 'Configure speed operation.',
        args: [
          ['10', 'Force 10 Mbps operation'],
          ['100', 'Force 100 Mbps operation'],
          ['1000', 'Force 1000 Mbps operation'],
          ['auto', 'Enable AUTO speed configuration'],
        ],
        run: (c) =>
          each(
            c,
            (i) => {
              if (i.type === 'svi') return "% Invalid input detected at '^' marker.";
              const v = c.neg ? 'auto' : c.args[0]?.toLowerCase();
              if (!v || !['10', '100', '1000', 'auto'].includes(v)) return '% Incomplete command.';
              if (v !== 'auto' && Number(v) > i.maxMbps) return `% Speed ${v} is not supported on ${shortIf(i.name)}`;
              if (i.type === 'sfp' && v !== '1000' && v !== 'auto') return '% Fiber SFP ports only support 1000 Mbps';
              i.speed = v as Iface['speed'];
            },
            'speed',
          ),
      },
      duplex: {
        help: 'Configure duplex operation.',
        args: [
          ['auto', 'Enable AUTO duplex configuration'],
          ['full', 'Force full duplex operation'],
          ['half', 'Force half-duplex operation'],
        ],
        run: (c) =>
          each(
            c,
            (i) => {
              if (i.type === 'svi') return "% Invalid input detected at '^' marker.";
              const v = c.neg ? 'auto' : c.args[0]?.toLowerCase();
              if (!v || !['auto', 'full', 'half'].includes(v)) return '% Incomplete command.';
              if (v === 'half' && (i.speed === 'auto' || i.speed === '1000')) return '% Duplex cannot be set to half when speed autonegotiation subset contains 1Gbps';
              if (v !== 'auto' && i.type === 'sfp') return '% Duplex is fixed on fiber SFP ports';
              i.duplex = v as Iface['duplex'];
            },
            'duplex',
          ),
      },
      power: {
        help: 'Power configuration',
        children: {
          inline: {
            help: 'Inline power configuration',
            args: [
              ['auto', 'Automatically detect and power inline devices'],
              ['never', 'Never apply inline power'],
            ],
            run: (c) =>
              each(
                c,
                (i) => {
                  if (!i.poe) return '% This interface does not support Power over Ethernet';
                  const v = c.neg ? 'auto' : c.args[0]?.toLowerCase();
                  if (v !== 'auto' && v !== 'never') return '% Incomplete command.';
                  i.poe = v;
                },
                'power inline',
              ),
          },
        },
      },
      'spanning-tree': {
        help: 'Spanning Tree Subsystem',
        children: {
          portfast: {
            help: 'Portfast options for the interface',
            args: [['edge', 'Enable portfast edge on the interface']],
            run: (c) =>
              each(
                c,
                (i) => {
                  const s = swOnly(i);
                  if (s) return s;
                  i.portfast = !c.neg;
                },
                'spanning-tree portfast',
              ),
          },
          bpduguard: {
            help: "Don't accept BPDUs on this interface",
            args: [
              ['enable', 'Enable BPDU guard for this interface'],
              ['disable', 'Disable BPDU guard for this interface'],
            ],
            run: (c) =>
              each(
                c,
                (i) => {
                  const s = swOnly(i);
                  if (s) return s;
                  const a = c.args[0]?.toLowerCase();
                  if (!c.neg && a !== 'enable' && a !== 'disable') return '% Incomplete command.';
                  i.bpduguard = !c.neg && a === 'enable';
                },
                'spanning-tree bpduguard',
              ),
          },
        },
      },
      'channel-group': { help: 'Etherchannel/port bundling configuration', run: (c) => c.err(OOS('EtherChannel') + ' Buy the redundant-uplink upgrade in the Shop instead.') },
      cdp: { help: 'CDP interface subcommands', children: { enable: { help: 'Enable CDP on interface', run: () => {} } } },
    };
    if (this.isSwitch()) {
      t.switchport = {
        help: 'Set switching mode characteristics',
        run: (c) =>
          each(
            c,
            (i) => {
              if (i.type === 'svi') return "% Invalid input detected at '^' marker.";
              if (this.d.kind === 'switch' && c.neg) return '% Routed ports are not supported on this layer-2 switch model.';
              if (c.neg) {
                i.switchport = false;
              } else {
                i.switchport = true;
                i.ip = null;
                i.mask = null;
              }
            },
            c.neg ? 'no switchport' : 'switchport',
          ),
        children: this.switchportTree(each, swOnly),
      };
    }
    return t;
  }

  private switchportTree(each: (c: RunCtx, fn: (i: Iface) => string | void, what: string) => void, swOnly: (i: Iface) => string | null): Record<string, CmdNode> {
    const vl = () => this.d.ios!.vlans;
    return {
      mode: {
        help: 'Set trunking mode of the interface',
        args: [
          ['access', 'Set trunking mode to ACCESS unconditionally'],
          ['trunk', 'Set trunking mode to TRUNK unconditionally'],
          ['dynamic', 'Set trunking mode to dynamically negotiate access or trunk mode'],
        ],
        run: (c) =>
          each(
            c,
            (i) => {
              const s = swOnly(i);
              if (s) return s;
              const a = c.args[0]?.toLowerCase();
              if (c.neg) {
                i.mode = 'access';
                return;
              }
              if (!a) return '% Incomplete command.';
              if ('access'.startsWith(a)) i.mode = 'access';
              else if ('trunk'.startsWith(a)) {
                if (i.portSecurity?.enabled) return `Command rejected: ${i.name} has port security enabled. Disable it first.`;
                i.mode = 'trunk';
              } else if ('dynamic'.startsWith(a)) return '% DTP negotiation is not modelled. Use "switchport mode access" or "switchport mode trunk".';
              else return "% Invalid input detected at '^' marker.";
            },
            'switchport mode',
          ),
      },
      access: {
        help: 'Set access mode characteristics of the interface',
        children: {
          vlan: {
            help: 'Set VLAN when interface is in access mode',
            args: [['<1-4094>', 'VLAN ID of the VLAN when this port is in access mode']],
            run: (c) =>
              each(
                c,
                (i) => {
                  const s = swOnly(i);
                  if (s) return s;
                  if (c.neg) {
                    i.accessVlan = 1;
                    return;
                  }
                  const v = Number(c.args[0]);
                  if (!Number.isInteger(v) || v < 1 || v > 4094) return '% Invalid VLAN id (1-4094)';
                  if (!vl()[String(v)]) {
                    this.out(`% Access VLAN does not exist. Creating vlan ${v}`);
                    vl()[String(v)] = `VLAN${String(v).padStart(4, '0')}`;
                  }
                  i.accessVlan = v;
                },
                'switchport access vlan',
              ),
          },
        },
      },
      trunk: {
        help: 'Set trunking characteristics of the interface',
        children: {
          native: {
            help: 'Set trunking native characteristics when interface is in trunking mode',
            children: {
              vlan: {
                help: 'Set native VLAN when interface is in trunking mode',
                args: [['<1-4094>', 'VLAN ID of the native VLAN']],
                run: (c) =>
                  each(
                    c,
                    (i) => {
                      const s = swOnly(i);
                      if (s) return s;
                      if (c.neg) {
                        i.nativeVlan = 1;
                        return;
                      }
                      const v = Number(c.args[0]);
                      if (!Number.isInteger(v) || v < 1 || v > 4094) return '% Invalid VLAN id (1-4094)';
                      i.nativeVlan = v;
                    },
                    'switchport trunk native vlan',
                  ),
              },
            },
          },
          allowed: {
            help: 'Set allowed VLAN characteristics when interface is in trunking mode',
            children: {
              vlan: {
                help: 'Set allowed VLANs when interface is in trunking mode',
                args: [
                  ['WORD', 'VLAN IDs of the allowed VLANs'],
                  ['add', 'add VLANs to the current list'],
                  ['remove', 'remove VLANs from the current list'],
                  ['all', 'all VLANs'],
                  ['except', 'all VLANs except the following'],
                  ['none', 'no VLANs'],
                ],
                run: (c) =>
                  each(
                    c,
                    (i) => {
                      const s = swOnly(i);
                      if (s) return s;
                      if (c.neg) {
                        i.allowedVlans = 'all';
                        return;
                      }
                      const a0 = c.args[0]?.toLowerCase();
                      if (!a0) return '% Incomplete command.';
                      const cur = parseVlanList(i.allowedVlans);
                      const full = Array.from({ length: 4094 }, (_, k) => k + 1);
                      const curArr = cur === 'all' ? full : (cur ?? []);
                      let next: number[] | 'all';
                      if (a0 === 'all') next = 'all';
                      else if (a0 === 'none') next = [];
                      else if (['add', 'remove', 'except'].includes(a0)) {
                        const l = parseVlanList(c.args.slice(1).join(''));
                        if (!l || l === 'all') return '% Invalid VLAN list';
                        if (a0 === 'add') next = [...new Set([...curArr, ...l])];
                        else if (a0 === 'remove') next = curArr.filter((v) => !l.includes(v));
                        else next = full.filter((v) => !l.includes(v));
                        if (next.length === 4094) next = 'all';
                      } else {
                        const l = parseVlanList(c.args.join(''));
                        if (!l) return "% Invalid input detected at '^' marker.";
                        next = l;
                      }
                      i.allowedVlans = next === 'all' ? 'all' : formatVlanList(next.sort((x, y) => x - y));
                    },
                    'switchport trunk allowed vlan',
                  ),
              },
            },
          },
          encapsulation: {
            help: 'Set trunking encapsulation when interface is in trunking mode',
            args: [['dot1q', 'Interface uses only 802.1q trunking encapsulation when trunking']],
            run: (c) => {
              if (c.args[0]?.toLowerCase().startsWith('isl')) c.err('% ISL encapsulation is not supported on this platform');
            },
          },
        },
      },
      nonegotiate: { help: 'Device will not engage in negotiation protocol on this interface', run: () => {} },
      voice: { help: 'Voice appliance attributes', run: (c) => c.err(OOS('Voice VLANs') + ' (no IP phones in this office)') },
      'port-security': {
        help: 'Security related command',
        run: (c) =>
          each(
            c,
            (i) => {
              const s = swOnly(i);
              if (s) return s;
              if (c.neg) {
                if (i.portSecurity) i.portSecurity.enabled = false;
                i.errDisabled = i.errDisabled === 'psecure-violation' ? i.errDisabled : i.errDisabled;
                return;
              }
              if (i.mode !== 'access') return `Command rejected: ${i.name} is a trunk port.`;
              i.portSecurity = i.portSecurity ?? { enabled: true, maximum: 1, violation: 'shutdown', sticky: false, secureMacs: [], violations: 0 };
              i.portSecurity.enabled = true;
            },
            'switchport port-security',
          ),
        children: {
          maximum: {
            help: 'Max secure addresses',
            args: [['<1-4097>', 'Maximum addresses']],
            run: (c) =>
              each(
                c,
                (i) => {
                  const s = swOnly(i);
                  if (s) return s;
                  const n = c.neg ? 1 : Number(c.args[0]);
                  if (!Number.isInteger(n) || n < 1 || n > 4097) return '% Invalid maximum';
                  i.portSecurity = i.portSecurity ?? { enabled: false, maximum: 1, violation: 'shutdown', sticky: false, secureMacs: [], violations: 0 };
                  i.portSecurity.maximum = n;
                  if (i.portSecurity.secureMacs.length > n) i.portSecurity.secureMacs = i.portSecurity.secureMacs.slice(0, n);
                },
                'port-security maximum',
              ),
          },
          violation: {
            help: 'Security violation mode',
            args: [
              ['protect', 'Security violation protect mode'],
              ['restrict', 'Security violation restrict mode'],
              ['shutdown', 'Security violation shutdown mode'],
            ],
            run: (c) =>
              each(
                c,
                (i) => {
                  const s = swOnly(i);
                  if (s) return s;
                  const a = c.neg ? 'shutdown' : c.args[0]?.toLowerCase();
                  const m = ['protect', 'restrict', 'shutdown'].find((x) => a && x.startsWith(a));
                  if (!m) return '% Incomplete command.';
                  i.portSecurity = i.portSecurity ?? { enabled: false, maximum: 1, violation: 'shutdown', sticky: false, secureMacs: [], violations: 0 };
                  i.portSecurity.violation = m as 'shutdown';
                },
                'port-security violation',
              ),
          },
          'mac-address': {
            help: 'Secure mac address',
            args: [
              ['sticky', 'Configure dynamic secure addresses as sticky'],
              ['H.H.H', '48 bit mac address'],
            ],
            run: (c) =>
              each(
                c,
                (i) => {
                  const s = swOnly(i);
                  if (s) return s;
                  i.portSecurity = i.portSecurity ?? { enabled: false, maximum: 1, violation: 'shutdown', sticky: false, secureMacs: [], violations: 0 };
                  const ps = i.portSecurity;
                  const a = c.args[0]?.toLowerCase();
                  if (a === 'sticky' && c.args.length === 1) {
                    ps.sticky = !c.neg;
                    if (c.neg) ps.secureMacs = [];
                    return;
                  }
                  const macTok = a === 'sticky' ? c.args[1] : c.args[0];
                  if (!macTok || !/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(macTok)) return '% Invalid MAC address (use H.H.H)';
                  const h = macTok.replace(/\./g, '').toLowerCase();
                  const mac = h.match(/.{2}/g)!.join(':');
                  if (c.neg) ps.secureMacs = ps.secureMacs.filter((m) => m !== mac);
                  else if (!ps.secureMacs.includes(mac)) {
                    if (ps.secureMacs.length >= ps.maximum) return '% Total secure mac-addresses on interface has reached maximum limit.';
                    ps.secureMacs.push(mac);
                  }
                },
                'port-security mac-address',
              ),
          },
          aging: { help: 'Port-security aging commands', run: (c) => c.err(OOS('Port-security aging')) },
        },
      },
    };
  }

  private cmdIpAddress(c: RunCtx): void {
    const ifs = this.ifaces();
    if (ifs.length !== 1) return c.err('% IP addresses can only be set on a single interface.');
    const i = ifs[0];
    if (this.isSwitch() && i.switchport && i.type !== 'svi') return c.err('% IP addresses may not be configured on L2 links.');
    if (c.neg) {
      i.ip = null;
      i.mask = null;
      this.changed(`${shortIf(i.name)}: no ip address`);
      return;
    }
    const [ip, mask] = c.args;
    if (!ip || !mask) {
      if (ip?.toLowerCase() === 'dhcp') return c.err(OOS('DHCP client on network devices'));
      return c.err('% Incomplete command.');
    }
    if (!isValidIp(ip)) return this.invalidHere(c);
    if (!isValidMask(mask) || mask === '0.0.0.0') return c.err(`% Bad mask /${mask} for address ${ip}`);
    if (ip === networkOf(ip, mask) && maskToPrefix(mask) < 31) return c.err(`% Bad mask /${maskToPrefix(mask)} for address ${ip}`);
    for (const o of this.d.ifaces) {
      if (o === i || !o.ip || !o.mask) continue;
      if (inNetwork(ip, networkOf(o.ip, o.mask), o.mask) || inNetwork(o.ip, networkOf(ip, mask), mask)) return c.err(`% ${networkOf(ip, mask)} overlaps with ${o.name}`);
    }
    i.ip = ip;
    i.mask = mask;
    this.changed(`${shortIf(i.name)}: ip address ${ip} ${mask}`);
  }
}

// ---------------------------------------------------------------------------
// ACL entry parsing

function aceKey(e: AclEntry): string {
  return JSON.stringify([e.action, e.proto, e.src, e.srcPort, e.dst, e.dstPort]);
}

function parseAddr(t: string[], k: number): { spec: AddrSpec; next: number } | string {
  const a = t[k]?.toLowerCase();
  if (!a) return '% Incomplete command.';
  if (a === 'any') return { spec: { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' }, next: k + 1 };
  if (a === 'host') {
    if (!isValidIp(t[k + 1])) return '% Invalid host address';
    return { spec: { any: false, ip: t[k + 1], wildcard: '0.0.0.0' }, next: k + 2 };
  }
  if (!isValidIp(a)) return `% Invalid address "${t[k]}" (use any, host A.B.C.D, or A.B.C.D wildcard)`;
  const w = t[k + 1];
  if (!w || !isValidIp(w)) return { spec: { any: false, ip: a, wildcard: '0.0.0.0' }, next: k + 1 };
  if (w.startsWith('255.') && w !== '255.255.255.255' && isValidMask(w)) return `% "${w}" looks like a subnet mask. ACLs use wildcard masks (e.g. 0.0.0.255 for a /24).`;
  return { spec: { any: false, ip: a, wildcard: w }, next: k + 2 };
}

function parsePort(t: string[], k: number): { pm: PortMatch | null; next: number } | string {
  const op = t[k]?.toLowerCase();
  if (!op || !['eq', 'neq', 'gt', 'lt', 'range'].includes(op)) return { pm: null, next: k };
  const num = (s: string | undefined) => {
    if (!s) return NaN;
    if (/^\d+$/.test(s)) return Number(s);
    return PORT_NAMES[s.toLowerCase()] ?? NaN;
  };
  const p1 = num(t[k + 1]);
  if (!Number.isInteger(p1) || p1 < 0 || p1 > 65535) return `% Invalid port "${t[k + 1] ?? ''}"`;
  if (op === 'range') {
    const p2 = num(t[k + 2]);
    if (!Number.isInteger(p2) || p2 < p1) return '% Invalid port range';
    return { pm: { op: 'range', ports: [p1, p2] }, next: k + 3 };
  }
  return { pm: { op: op as PortMatch['op'], ports: [p1] }, next: k + 2 };
}

export function parseAce(tokens: string[], type: 'standard' | 'extended'): AclEntry | string {
  const t = [...tokens];
  const action = t[0]?.toLowerCase();
  if (action !== 'permit' && action !== 'deny') return "% Invalid input detected at '^' marker.";
  const entry: AclEntry = {
    seq: 0,
    action,
    proto: 'ip',
    src: { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' },
    srcPort: null,
    dst: { any: true, ip: '0.0.0.0', wildcard: '255.255.255.255' },
    dstPort: null,
    log: false,
    hits: 0,
  };
  if (type === 'standard') {
    const a = parseAddr(t, 1);
    if (typeof a === 'string') return a;
    entry.src = a.spec;
    if (t[a.next]?.toLowerCase() === 'log') entry.log = true;
    else if (t[a.next]) return "% Invalid input detected at '^' marker.";
    return entry;
  }
  const proto = t[1]?.toLowerCase();
  if (!proto) return '% Incomplete command.';
  if (!['ip', 'tcp', 'udp', 'icmp'].includes(proto)) {
    if (/^\d+$/.test(proto) || ['gre', 'esp', 'ahp', 'ospf', 'eigrp', 'pim', 'igmp'].includes(proto)) return `% Protocol "${proto}" is outside the scope of this simulation (use ip, tcp, udp or icmp).`;
    return "% Invalid input detected at '^' marker.";
  }
  entry.proto = proto as AclEntry['proto'];
  const s = parseAddr(t, 2);
  if (typeof s === 'string') return s;
  entry.src = s.spec;
  let k = s.next;
  if (proto === 'tcp' || proto === 'udp') {
    const sp = parsePort(t, k);
    if (typeof sp === 'string') return sp;
    entry.srcPort = sp.pm;
    k = sp.next;
  }
  const dd = parseAddr(t, k);
  if (typeof dd === 'string') return dd;
  entry.dst = dd.spec;
  k = dd.next;
  if (proto === 'tcp' || proto === 'udp') {
    const dp = parsePort(t, k);
    if (typeof dp === 'string') return dp;
    entry.dstPort = dp.pm;
    k = dp.next;
  }
  while (k < t.length) {
    const x = t[k].toLowerCase();
    if (x === 'log') entry.log = true;
    else if (proto === 'icmp' && ['echo', 'echo-reply', 'unreachable', 'time-exceeded'].includes(x)) {
      /* icmp type accepted (all ICMP is treated alike) */
    } else if (x === 'established') {
      /* stateful by design in this sim */
    } else return "% Invalid input detected at '^' marker.";
    k++;
  }
  return entry;
}
