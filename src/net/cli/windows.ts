/** Windows command prompt for PCs and laptops. */
import { hash } from '../../core/rng';
import { dayIndex, pad2 } from '../../core/time';
import { ROSTER, SERVICES_BY_DEPT } from '../../world/roster';
import type { NetEngine, PathCheck } from '../engine';
import { internetHostByIp } from '../internet';
import { isApipa, isValidIp, isValidMask, sameSubnet } from '../ip';
import { type Device, windowsMac } from '../model';
import { type Shell, type SimApi, type TermLine, pad, padL, pushLines, tokenize } from './shell';

const COMMANDS = ['ipconfig', 'ping', 'tracert', 'nslookup', 'arp', 'route', 'netstat', 'tasklist', 'netsh', 'curl', 'tnc', 'test-netconnection', 'hostname', 'whoami', 'getmac', 'ver', 'systeminfo', 'shutdown', 'cls', 'help', 'exit'];

function fmtWinDate(t: number): string {
  const dd = dayIndex(t);
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const m = ((t % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${days[dd % 7]}, October ${12 + dd}, 2026 ${h12}:${pad2(m % 60)}:${pad2(Math.floor((t * 60) % 60))} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export class WindowsShell implements Shell {
  kind = 'windows' as const;
  lines: TermLine[] = [];
  history: string[] = [];
  private user: string;

  constructor(
    public devId: string,
    private api: SimApi,
  ) {
    const owner = ROSTER.find((r) => r.id === this.d.ownerId);
    this.user = owner ? (owner.name.split(' ')[0][0] + owner.name.split(' ').slice(-1)[0]).toLowerCase().replace(/[^a-z]/g, '') : 'netadmin';
    pushLines(this, ['Microsoft Windows [Version 10.0.22631.4317]', '(c) Microsoft Corporation. All rights reserved.', '', 'Tip: try "ipconfig /all", "ping <host>", "nslookup <name>" or "help".', ''], 'dim');
  }

  get e(): NetEngine {
    return this.api.engine;
  }
  get d(): Device {
    return this.api.engine.dev(this.devId);
  }

  prompt(): string {
    return `C:\\Users\\${this.user}>`;
  }

  private out = (s: string | string[]) => pushLines(this, s);
  private err = (s: string | string[]) => pushLines(this, s, 'err');

  help(input: string): string {
    return input + '?';
  }

  complete(input: string): string {
    const t = input.trimStart();
    if (t.includes(' ')) return input;
    const m = COMMANDS.filter((c) => c.startsWith(t.toLowerCase()));
    return m.length === 1 ? m[0] + ' ' : input;
  }

  run(input: string): void {
    pushLines(this, `${this.prompt()}${input}`, 'in');
    const raw = input.trim();
    if (!raw) return;
    this.history.push(raw);
    if (this.history.length > 100) this.history.shift();
    if (!this.e.isUp(this.devId)) {
      this.err('[The computer is not responding — it is powered off or restarting.]');
      return;
    }
    const { tokens } = tokenize(raw);
    const cmd = tokens[0].toLowerCase().replace(/\.exe$/, '');
    const args = tokens.slice(1);
    const la = args.map((a) => a.toLowerCase());
    this.api.onCommand(this.devId, [cmd, ...la].join(' '), raw);
    switch (cmd) {
      case 'ipconfig':
        return this.ipconfig(la);
      case 'ping':
        return this.ping(args);
      case 'tracert':
      case 'traceroute':
        return this.tracert(args);
      case 'nslookup':
        return this.nslookup(args);
      case 'arp':
        return this.arp(la);
      case 'route':
        return this.route(la);
      case 'netstat':
        return this.netstat(la);
      case 'tasklist':
        return this.tasklist();
      case 'netsh':
        return this.netsh(args);
      case 'curl':
      case 'iwr':
      case 'invoke-webrequest':
        return this.curl(args);
      case 'tnc':
      case 'test-netconnection':
        return this.tnc(args);
      case 'hostname':
        return this.out(this.d.name);
      case 'whoami':
        return this.out(`corp\\${this.user}`);
      case 'getmac':
        return this.out(['', 'Physical Address    Transport Name', '=================== ==========================================================', `${windowsMac(this.d.ifaces[0].mac)}   ${this.e.oper(this.d.ifaces[0]).up ? '\\Device\\Tcpip_{4D36E972-E325-11CE-BFC1-08002BE10318}' : 'Media disconnected'}`]);
      case 'ver':
        return this.out(['', 'Microsoft Windows [Version 10.0.22631.4317]']);
      case 'systeminfo':
        return this.out([
          '',
          `Host Name:                 ${this.d.name}`,
          'OS Name:                   Microsoft Windows 11 Enterprise',
          'OS Version:                10.0.22631 N/A Build 22631',
          `System Manufacturer:       ${this.d.kind === 'laptop' ? 'LENOVO' : 'Dell Inc.'}`,
          `System Model:              ${this.d.model}`,
          'Domain:                    corp.local',
          `Network Card(s):           1 NIC(s) Installed.`,
          `                           [01]: ${this.d.kind === 'laptop' ? 'Intel(R) Wi-Fi 6E AX211 160MHz' : 'Intel(R) Ethernet Connection I219-LM'}`,
        ]);
      case 'shutdown':
        if (la.includes('/r') || la.includes('-r')) {
          this.out('Restarting in a few seconds... (the session will reconnect after boot)');
          this.api.reloadDevice(this.devId);
          return;
        }
        return this.err('This simulation only supports "shutdown /r" (restart).');
      case 'cls':
      case 'clear':
        this.lines.length = 0;
        return;
      case 'help':
        return this.out([
          'Supported commands (simulated):',
          '  ipconfig [/all | /release | /renew | /flushdns | /displaydns]',
          '  ping [-n count] <host>          tracert [-d] <host>',
          '  nslookup <name> [server]        arp -a',
          '  route print                     netstat -an | -ano',
          '  tasklist                        getmac, hostname, whoami',
          '  curl <url>                      tnc <host> -Port <n>',
          '  netsh interface ip show config',
          '  netsh interface ip set address "Ethernet" dhcp | static <ip> <mask> <gw>',
          '  netsh interface ip set dns "Ethernet" dhcp | static <ip>',
          '  netsh wlan show interfaces | networks   (laptops)',
          '  shutdown /r                     cls',
        ]);
      case 'exit':
        return this.out('[Session closed. Press Enter to open a new prompt.]');
      case 'ifconfig':
      case 'ip':
        return this.err(`'${cmd}' is not recognized as an internal or external command,\noperable program or batch file.\n(Hint: this is a Windows PC — use "ipconfig".)`);
      default:
        return this.err(`'${tokens[0]}' is not recognized as an internal or external command,\noperable program or batch file.`);
    }
  }

  // -------------------------------------------------------------------------

  private adapterName(): string {
    return this.d.ifaces[0].type === 'wlan' ? 'Wi-Fi' : 'Ethernet';
  }

  private ipconfig(a: string[]): void {
    const d = this.d;
    const h = d.host!;
    const i = d.ifaces[0];
    const sub = a[0];
    if (sub === '/release') {
      if (!h.dhcp) return this.err(`An error occurred while releasing interface ${this.adapterName()} : DHCP is not enabled on this adapter.`);
      this.api.dhcpRelease(this.devId);
      this.api.recordChange(this.devId, 'ipconfig /release');
      return this.ipconfig([]);
    }
    if (sub === '/renew') {
      if (!h.dhcp) return this.err(`An error occurred while renewing interface ${this.adapterName()} : DHCP is not enabled on this adapter.`);
      if (!this.e.oper(i).up) return this.err(`An error occurred while renewing interface ${this.adapterName()} : The media is disconnected.`);
      const r = this.api.dhcpRenew(this.devId);
      if (!r.ok) this.err(`An error occurred while renewing interface ${this.adapterName()} : unable to contact your DHCP server. Request has timed out.`);
      this.api.recordChange(this.devId, 'ipconfig /renew');
      return this.ipconfig([]);
    }
    if (sub === '/flushdns') return this.out(['', 'Windows IP Configuration', '', 'Successfully flushed the DNS Resolver Cache.']);
    if (sub === '/displaydns') return this.out(['', 'Windows IP Configuration', '', '    (DNS cache entries are not tracked in this simulation — use nslookup)']);
    if (sub === '/registerdns') return this.out(['', 'Windows IP Configuration', '', 'Registration of the DNS resource records for all adapters of this computer has been initiated.']);
    if (sub && sub !== '/all') return this.err(`Error: unrecognized or incomplete command line.\n\nUSAGE:\n    ipconfig [/all | /release | /renew | /flushdns | /displaydns]`);
    const all = sub === '/all';
    const up = this.e.oper(i).up;
    const out = ['', 'Windows IP Configuration', ''];
    if (all) {
      out.push(
        `   Host Name . . . . . . . . . . . . : ${d.name}`,
        `   Primary Dns Suffix  . . . . . . . : corp.local`,
        `   Node Type . . . . . . . . . . . . : Hybrid`,
        `   IP Routing Enabled. . . . . . . . : No`,
        `   DNS Suffix Search List. . . . . . : corp.local`,
        '',
      );
    }
    out.push(`${i.type === 'wlan' ? 'Wireless LAN adapter Wi-Fi' : 'Ethernet adapter Ethernet'}:`, '');
    if (!up || i.shutdown) {
      out.push(`   Media State . . . . . . . . . . . : Media disconnected`, `   Connection-specific DNS Suffix  . : `);
      if (all) out.push(`   Description . . . . . . . . . . . : ${i.type === 'wlan' ? 'Intel(R) Wi-Fi 6E AX211 160MHz' : 'Intel(R) Ethernet Connection I219-LM'}`, `   Physical Address. . . . . . . . . : ${windowsMac(i.mac)}`, `   DHCP Enabled. . . . . . . . . . . : ${h.dhcp ? 'Yes' : 'No'}`, `   Autoconfiguration Enabled . . . . : Yes`);
      return this.out(out);
    }
    out.push(`   Connection-specific DNS Suffix  . : ${h.dhcp && h.domain ? h.domain : ''}`);
    if (all) {
      out.push(
        `   Description . . . . . . . . . . . : ${i.type === 'wlan' ? 'Intel(R) Wi-Fi 6E AX211 160MHz' : 'Intel(R) Ethernet Connection I219-LM'}`,
        `   Physical Address. . . . . . . . . : ${windowsMac(i.mac)}`,
        `   DHCP Enabled. . . . . . . . . . . : ${h.dhcp ? 'Yes' : 'No'}`,
        `   Autoconfiguration Enabled . . . . : Yes`,
      );
    }
    out.push(`   Link-local IPv6 Address . . . . . : fe80::${(hash(i.mac) & 0xffff).toString(16)}:${((hash(i.mac) >>> 16) & 0xffff).toString(16)}:${(hash(i.mac + 'x') & 0xffff).toString(16)}%${11 + (hash(i.mac) % 6)}${all ? '(Preferred) ' : ''}`);
    if (i.ip && isApipa(i.ip)) {
      out.push(`   Autoconfiguration IPv4 Address. . : ${i.ip}${all ? '(Preferred) ' : ''}`, `   Subnet Mask . . . . . . . . . . . : ${i.mask}`);
    } else if (i.ip) {
      const tag = h.ipConflict ? '(Duplicate)' : all ? '(Preferred) ' : '';
      out.push(`   IPv4 Address. . . . . . . . . . . : ${i.ip}${tag}`, `   Subnet Mask . . . . . . . . . . . : ${i.mask}`);
    }
    if (all && h.dhcp && h.leaseExpires > 0 && i.ip && !isApipa(i.ip)) {
      out.push(`   Lease Obtained. . . . . . . . . . : ${fmtWinDate(h.leaseObtained)}`, `   Lease Expires . . . . . . . . . . : ${fmtWinDate(h.leaseExpires)}`);
    }
    out.push(`   Default Gateway . . . . . . . . . : ${h.gateway ?? ''}`);
    if (all) {
      if (h.dhcp && h.dhcpServer) out.push(`   DHCP Server . . . . . . . . . . . : ${h.dhcpServer}`);
      out.push(`   DNS Servers . . . . . . . . . . . : ${h.dns[0] ?? ''}`);
      for (const s of h.dns.slice(1)) out.push(`                                       ${s}`);
      out.push(`   NetBIOS over Tcpip. . . . . . . . : Enabled`);
    }
    if (h.ipConflict) out.push('', '   [Windows has detected an IP address conflict. Another device on this network is using this computer\'s IP address.]');
    this.out(out);
  }

  private ttlFor(path: PathCheck): number {
    if (path.fwd.external) return 128 - 10 - (hash(path.fwd.external.ip) % 60);
    const d = this.e.dev(path.fwd.dstDev!);
    const hops = path.fwd.hops.length - 1;
    const base = d.kind === 'server' || d.kind === 'printer' || d.kind === 'ap' || d.kind === 'iot' ? 64 : d.kind === 'pc' || d.kind === 'laptop' ? 128 : 255;
    return base - Math.max(0, hops);
  }

  private resolveFor(target: string): { ip: string | null; failMsg?: string } {
    if (isValidIp(target)) return { ip: target };
    const r = this.e.resolve(this.devId, target);
    if (!r.ok) return { ip: null };
    return { ip: r.ip };
  }

  private noIpFailure(dstIp: string): string | null {
    const i = this.d.ifaces[0];
    const h = this.d.host!;
    if (!this.e.oper(i).up || !i.ip) return 'PING: transmit failed. General failure.';
    if (isApipa(i.ip) && !sameSubnet(dstIp, i.ip, i.mask ?? '255.255.0.0')) return 'PING: transmit failed. General failure.';
    if (!sameSubnet(dstIp, i.ip, i.mask!) && !h.gateway) return 'PING: transmit failed. General failure.';
    if (this.d.pc?.edrIsolated) return 'PING: transmit failed. General failure.';
    return null;
  }

  private ping(args: string[]): void {
    let count = 4;
    let target: string | null = null;
    for (let k = 0; k < args.length; k++) {
      const a = args[k].toLowerCase();
      if (a === '-n') count = Math.max(1, Math.min(20, Number(args[++k]) || 4));
      else if (a === '-t') {
        this.out('(Continuous ping is not supported here — using -n 10.)');
        count = 10;
      } else if (a === '-l' || a === '-w' || a === '-i') k++;
      else if (a === '-4' || a === '-a') continue;
      else if (a.startsWith('-')) return this.err(`Bad option ${args[k]}.`);
      else target = args[k];
    }
    if (!target) return this.out(['', 'Usage: ping [-n count] [-l size] target_name']);
    const { ip } = this.resolveFor(target);
    if (!ip) return this.out(`Ping request could not find host ${target}. Please check the name and try again.`);
    const out: string[] = ['', `Pinging ${isValidIp(target) ? ip : `${target} [${ip}]`} with 32 bytes of data:`];
    const pre = this.noIpFailure(ip);
    if (pre) {
      for (let k = 0; k < count; k++) out.push(pre);
      out.push('', `Ping statistics for ${ip}:`, `    Packets: Sent = ${count}, Received = 0, Lost = ${count} (100% loss),`);
      return this.out(out);
    }
    const r = this.e.roundTrip(this.devId, ip, 'icmp', 0);
    let rec = 0;
    const times: number[] = [];
    const myIp = this.d.ifaces[0].ip!;
    const respondsIcmp = !r.ok || !r.fwd.external || r.fwd.external.icmp;
    for (let k = 0; k < count; k++) {
      if (r.ok && respondsIcmp && Math.random() < Math.max(0.02, r.quality + 0.03)) {
        const t = Math.max(0, Math.round(r.latencyMs + (Math.random() - 0.3) * Math.max(1, r.latencyMs * 0.2)));
        times.push(t);
        rec++;
        out.push(`Reply from ${ip}: bytes=32 ${t < 1 ? 'time<1ms' : `time=${t}ms`} TTL=${this.ttlFor(r)}`);
      } else if (!r.ok && r.fwd.code === 'arp' && r.fwd.failDev === this.devId) {
        out.push(`Reply from ${myIp}: Destination host unreachable.`);
        rec++;
      } else if (!r.ok && r.fwd.unreachableFrom && r.fwd.unreachableFrom !== 'fw-edge') {
        const ud = this.e.dev(r.fwd.unreachableFrom);
        const hopIp = r.fwd.hops.find((h) => h.dev === ud.id)?.ip ?? this.e.primaryIf(ud)?.ip;
        out.push(`Reply from ${hopIp}: Destination ${r.fwd.code === 'arp' ? 'host' : 'net'} unreachable.`);
        rec++;
      } else out.push('Request timed out.');
    }
    const lost = count - rec;
    out.push('', `Ping statistics for ${ip}:`, `    Packets: Sent = ${count}, Received = ${rec}, Lost = ${lost} (${Math.round((lost / count) * 100)}% loss),`);
    if (times.length) {
      const mn = Math.min(...times);
      const mx = Math.max(...times);
      const av = Math.round(times.reduce((x, y) => x + y, 0) / times.length);
      out.push('Approximate round trip times in milli-seconds:', `    Minimum = ${mn}ms, Maximum = ${mx}ms, Average = ${av}ms`);
    }
    this.out(out);
  }

  private tracert(args: string[]): void {
    const target = args.filter((a) => !a.startsWith('-'))[0];
    if (!target) return this.out(['', 'Usage: tracert [-d] target_name']);
    const { ip } = this.resolveFor(target);
    if (!ip) return this.out(`Unable to resolve target system name ${target}.`);
    const out = ['', `Tracing route to ${isValidIp(target) ? ip : `${target} [${ip}]`}`, 'over a maximum of 30 hops:', ''];
    const pre = this.noIpFailure(ip);
    if (pre) {
      out.push('Unable to contact IP driver. General failure.');
      return this.out(out);
    }
    const r = this.e.roundTrip(this.devId, ip, 'icmp', 0);
    const ms = (base: number) => {
      const v = Math.round(base + Math.random() * 2);
      return v < 1 ? '  <1 ms' : padL(`${v} ms`, 7);
    };
    let n = 0;
    const line = (base: number, host: string) => `${padL(++n, 3)}  ${ms(base)}  ${ms(base)}  ${ms(base)}  ${host}`;
    if (!r.ok && r.fwd.code === 'arp' && r.fwd.failDev === this.devId) {
      out.push(`  1  ${this.d.ifaces[0].ip}  reports: Destination host unreachable.`, '', 'Trace complete.');
      return this.out(out);
    }
    for (const [k, h] of r.fwd.hops.entries()) {
      const isLast = h === r.fwd.hops[r.fwd.hops.length - 1];
      if (!r.ok && !this.e.hopReplies(r.fwd, k)) {
        out.push(`${padL(++n, 3)}     *        *        *     Request timed out.`);
        continue;
      }
      if (r.ok && isLast && !r.fwd.external && h.dev === r.fwd.dstDev) {
        out.push(line(r.latencyMs, isValidIp(target) ? h.ip : `${target} [${h.ip}]`));
        out.push('', 'Trace complete.');
        return this.out(out);
      }
      if (!r.ok && isLast && r.fwd.code === 'acl' && h.dev !== 'fw-edge') {
        out.push(`${padL(++n, 3)}  ${h.ip}  reports: Destination net unreachable.`, '', 'Trace complete.');
        return this.out(out);
      }
      out.push(line(0.4 * n, h.ip));
      if (h.dev === 'isp-gw' && r.fwd.external) {
        for (const x of ['100.64.18.1', '62.115.40.97']) out.push(line(6 + n * 2, x));
      }
    }
    if (r.ok && r.fwd.external) {
      out.push(line(r.latencyMs, isValidIp(target) ? ip : `${target} [${ip}]`), '', 'Trace complete.');
      return this.out(out);
    }
    if (r.ok) {
      out.push(line(r.latencyMs, ip), '', 'Trace complete.');
      return this.out(out);
    }
    for (let k = 0; k < 4; k++) out.push(`${padL(++n, 3)}     *        *        *     Request timed out.`);
    out.push('(trace stopped after 4 consecutive timeouts)', '', 'Trace complete.');
    this.out(out);
  }

  private serverName(ip: string | null): string {
    if (!ip) return 'UnKnown';
    if (ip === '10.10.100.10') return 'dc01.corp.local';
    const ext = internetHostByIp(ip);
    if (ext) return ext.name;
    return 'UnKnown';
  }

  private nslookup(args: string[]): void {
    if (!args.length) return this.err(['Interactive nslookup is not supported in this simulation.', 'Usage: nslookup <name> [server]']);
    const name = args[0];
    const server = args[1];
    const h = this.d.host!;
    const srvIp = server && isValidIp(server) ? server : h.dns[0];
    const out: string[] = [];
    if (!srvIp) {
      out.push('*** Default servers are not available', 'Server:  UnKnown', 'Address:  127.0.0.1', '', `*** UnKnown can't find ${name}: No response from server`);
      return this.out(out);
    }
    // query the chosen server only (like nslookup does)
    const r = server ? this.e.resolveWith(this.devId, name, [srvIp]) : this.e.resolve(this.devId, name);
    if (r.code === 'timeout' && r.server === srvIp) {
      out.push('DNS request timed out.', '    timeout was 2 seconds.', 'Server:  UnKnown', `Address:  ${srvIp}`, '', `*** Request to UnKnown timed-out`);
      return this.err(out);
    }
    out.push(`Server:  ${this.serverName(srvIp)}`, `Address:  ${srvIp}`, '');
    if (!r.ok) {
      const why = r.code === 'nxdomain' ? 'Non-existent domain' : r.code === 'servfail' ? 'Server failed' : 'No response from server';
      out.push(`*** ${this.serverName(srvIp)} can't find ${name}: ${why}`);
      return this.out(out);
    }
    if (!r.fqdn.endsWith('.corp.local')) out.push('Non-authoritative answer:');
    out.push(`Name:    ${r.fqdn}`, `Address:  ${r.ip}`);
    this.out(out);
  }

  private arp(a: string[]): void {
    if (a[0] === '-d') return this.out('');
    if (a[0] !== '-a' && a[0] !== '-g') return this.out(['', 'Displays and modifies the IP-to-Physical address translation tables.', '', 'ARP -a [inet_addr]', 'ARP -d inet_addr']);
    const i = this.d.ifaces[0];
    if (!i.ip || !this.e.oper(i).up) return this.out('No ARP Entries Found.');
    const out = ['', `Interface: ${i.ip} --- 0x${(11 + (hash(i.mac) % 6)).toString(16)}`, '  Internet Address      Physical Address      Type'];
    const seg = this.e.segOfIface(i.id);
    const members = this.e.membersOf(seg).filter((m) => m.dev !== this.devId && sameSubnet(m.ip, i.ip!, i.mask!));
    const gw = this.d.host!.gateway;
    const interesting = members.filter((m) => m.ip === gw || this.e.dev(m.dev).kind === 'printer' || hash(m.mac + this.devId) % 4 === 0).slice(0, 8);
    for (const m of interesting) out.push(`  ${pad(m.ip, 22)}${pad(windowsMac(m.mac).toLowerCase(), 22)}dynamic   `);
    if (i.mask) {
      const bcast = i.ip.split('.').slice(0, 3).join('.') + '.255';
      out.push(`  ${pad(bcast, 22)}${pad('ff-ff-ff-ff-ff-ff', 22)}static    `);
    }
    out.push(`  ${pad('224.0.0.22', 22)}${pad('01-00-5e-00-00-16', 22)}static    `);
    this.out(out);
  }

  private route(a: string[]): void {
    if (a[0] !== 'print') return this.err('Only "route print" is supported in this simulation.');
    const i = this.d.ifaces[0];
    const h = this.d.host!;
    const out = ['===========================================================================', 'IPv4 Route Table', '===========================================================================', 'Active Routes:', 'Network Destination        Netmask          Gateway       Interface  Metric'];
    if (i.ip && i.mask) {
      if (h.gateway) out.push(`${padL('0.0.0.0', 18)}${padL('0.0.0.0', 17)}${padL(h.gateway, 17)}${padL(i.ip, 15)}${padL(25, 7)}`);
      out.push(`${padL(i.ip.split('.').slice(0, 3).join('.') + '.0', 18)}${padL(i.mask, 17)}${padL('On-link', 17)}${padL(i.ip, 15)}${padL(281, 7)}`);
      out.push(`${padL(i.ip, 18)}${padL('255.255.255.255', 17)}${padL('On-link', 17)}${padL(i.ip, 15)}${padL(281, 7)}`);
    }
    out.push(`${padL('127.0.0.0', 18)}${padL('255.0.0.0', 17)}${padL('On-link', 17)}${padL('127.0.0.1', 15)}${padL(331, 7)}`, '===========================================================================', 'Persistent Routes:', '  None');
    this.out(out);
  }

  private connections(): { proto: string; local: string; remote: string; state: string; pid: number }[] {
    const d = this.d;
    const ip = d.ifaces[0].ip;
    const rows: { proto: string; local: string; remote: string; state: string; pid: number }[] = [];
    rows.push({ proto: 'TCP', local: '0.0.0.0:135', remote: '0.0.0.0:0', state: 'LISTENING', pid: 1044 });
    rows.push({ proto: 'TCP', local: '0.0.0.0:445', remote: '0.0.0.0:0', state: 'LISTENING', pid: 4 });
    rows.push({ proto: 'TCP', local: '0.0.0.0:5040', remote: '0.0.0.0:0', state: 'LISTENING', pid: 7932 });
    if (!ip || isApipa(ip) || !this.e.oper(d.ifaces[0]).up) return rows;
    const owner = ROSTER.find((r) => r.id === d.ownerId);
    let port = 49700 + (hash(d.id) % 200);
    for (const s of owner ? SERVICES_BY_DEPT[owner.dept] : []) {
      const res = this.e.checkService(d.id, s.host, s.proto, s.port);
      if (!res.dstIp) continue;
      port += 3 + (hash(s.id) % 9);
      rows.push({ proto: 'TCP', local: `${ip}:${port}`, remote: `${res.dstIp}:${s.port}`, state: res.ok ? 'ESTABLISHED' : 'SYN_SENT', pid: 6000 + (hash(s.id) % 3000) });
    }
    const mw = d.pc?.malware;
    if (mw && d.pc?.compromised) {
      const flow = this.e.net.flows.find((f) => f.src === d.id && f.kind === 'c2');
      const blocked = !!flow?.blockedAt;
      rows.push({ proto: 'TCP', local: `${ip}:${51000 + (hash(mw.c2Ip) % 900)}`, remote: `${mw.c2Ip}:${mw.c2Port}`, state: blocked ? 'SYN_SENT' : 'ESTABLISHED', pid: 6644 });
      if (this.e.net.flows.some((f) => f.src === d.id && f.kind === 'scan')) {
        for (let k = 0; k < 4; k++) rows.push({ proto: 'TCP', local: `${ip}:${52000 + k}`, remote: `10.10.${[10, 20, 30, 40][k]}.${30 + k * 7}:445`, state: 'SYN_SENT', pid: 6644 });
      }
    }
    return rows;
  }

  private netstat(a: string[]): void {
    const withPid = a.some((x) => x.includes('o'));
    const out = ['', 'Active Connections', '', `  Proto  Local Address          Foreign Address        State${withPid ? '           PID' : ''}`];
    for (const r of this.connections()) out.push(`  ${pad(r.proto, 7)}${pad(r.local, 23)}${pad(r.remote, 23)}${withPid ? `${pad(r.state, 16)}${r.pid}` : r.state}`);
    this.out(out);
  }

  private tasklist(): void {
    const pc = this.d.pc;
    const out = ['', 'Image Name                     PID Session Name        Session#    Mem Usage', '========================= ======== ================ =========== ============'];
    const procs = [...(pc?.procs ?? [])];
    if (pc?.compromised && pc.malware) procs.splice(3, 0, { name: pc.malware.proc, pid: 6644, mem: 18 });
    for (const p of procs) out.push(`${pad(p.name, 26)}${padL(p.pid, 8)} ${pad(p.pid < 600 ? 'Services' : 'Console', 17)}${padL(p.pid < 600 ? 0 : 1, 11)}${padL(`${(p.mem * 1024).toLocaleString('en-US')} K`, 13)}`);
    this.out(out);
  }

  private netsh(args: string[]): void {
    const la = args.map((a) => a.toLowerCase());
    const d = this.d;
    const h = d.host!;
    const i = d.ifaces[0];
    if (la[0] === 'wlan') {
      if (i.type !== 'wlan') return this.err('There is no wireless interface on the system.');
      if (la[1] === 'show' && la[2]?.startsWith('interface')) {
        const w = this.e.c.wlan.get(d.id);
        const ap = w ? this.e.dev(w.ap) : null;
        return this.out([
          '',
          'There is 1 interface on the system:',
          '',
          '    Name                   : Wi-Fi',
          '    Description            : Intel(R) Wi-Fi 6E AX211 160MHz',
          `    Physical address       : ${i.mac}`,
          `    State                  : ${w ? 'connected' : 'disconnected'}`,
          ...(w && ap
            ? [
                `    SSID                   : ${ap.ap!.ssid}`,
                `    BSSID                  : ${ap.ifaces[0].mac}`,
                '    Network type           : Infrastructure',
                '    Radio type             : 802.11ax',
                '    Authentication         : WPA2-Enterprise',
                `    Channel                : ${ap.ap!.channel}`,
                `    Receive rate (Mbps)    : ${Math.round(600 * w.quality)}`,
                `    Transmit rate (Mbps)   : ${Math.round(520 * w.quality)}`,
                `    Signal                 : ${Math.round(Math.min(99, 25 + w.signal * 110))}%`,
                `    Profile                : ${d.pc?.wifiProfile ?? 'CorpNet'}`,
              ]
            : []),
        ]);
      }
      if (la[1] === 'show' && la[2]?.startsWith('network')) {
        const out = ['', 'Interface name : Wi-Fi', 'There are visible networks:', ''];
        let n = 0;
        for (const ap of Object.values(this.e.net.devices)) {
          if (ap.kind !== 'ap' || !this.e.isUp(ap.id) || !ap.ap!.radioOn) continue;
          const dist = Math.hypot(ap.pos.x - d.pos.x, ap.pos.y - d.pos.y);
          const sig = 1 - dist / (ap.ap!.rangePx * 1.3);
          if (sig <= 0) continue;
          out.push(`SSID ${++n} : ${ap.ap!.ssid}  (BSSID ${ap.ifaces[0].mac})`, `    Signal         : ${Math.round(Math.min(99, 20 + sig * 100))}%`, `    Channel        : ${ap.ap!.channel}`, '');
        }
        for (const f of this.e.net.wireless.foreign) out.push(`SSID ${++n} : ${f.ssid}`, `    Signal         : ${Math.round(40 + f.strength * 50)}%`, `    Channel        : ${f.channel}`, '');
        return this.out(out);
      }
      return this.err('Supported: netsh wlan show interfaces | netsh wlan show networks');
    }
    if (la[0] !== 'interface' && la[0] !== 'int') return this.err('Supported: netsh interface ip ... | netsh wlan show ...');
    if (la[1] !== 'ip' && la[1] !== 'ipv4') return this.err('Only "netsh interface ip" (IPv4) is supported.');
    if (la[2] === 'show') {
      return this.out([
        '',
        `Configuration for interface "${this.adapterName()}"`,
        `    DHCP enabled:                         ${h.dhcp ? 'Yes' : 'No'}`,
        `    IP Address:                           ${i.ip ?? ''}`,
        `    Subnet Prefix:                        ${i.mask ? `${i.ip?.split('.').slice(0, 3).join('.')}.0 (mask ${i.mask})` : ''}`,
        `    Default Gateway:                      ${h.gateway ?? ''}`,
        `    Gateway Metric:                       0`,
        `    InterfaceMetric:                      25`,
        `    ${h.dnsFromDhcp ? 'DNS servers configured through DHCP' : 'Statically Configured DNS Servers'}:  ${h.dns[0] ?? 'None'}`,
        ...h.dns.slice(1).map((s) => `                                          ${s}`),
      ]);
    }
    if (la[2] !== 'set') return this.err('Usage: netsh interface ip set address|dns ...');
    const what = la[3];
    // strip name="Ethernet" / "Ethernet" / name=Ethernet and source= keywords
    const rest = args.slice(4).filter((x) => !/^name=/i.test(x) && !/^(ethernet|wi-fi)$/i.test(x)).map((x) => x.replace(/^(source|addr|address|mask|gateway)=/i, ''));
    const lr = rest.map((x) => x.toLowerCase());
    if (what === 'address') {
      if (lr[0] === 'dhcp') {
        this.api.enableDhcp(this.devId);
        this.api.recordChange(this.devId, 'netsh set address dhcp');
        return this.out('Ok.');
      }
      if (lr[0] === 'static') {
        const [ip, mask, gw] = rest.slice(1);
        if (!isValidIp(ip) || !isValidMask(mask)) return this.err('The syntax supplied for this command is not valid. Check help for the correct syntax.');
        if (gw && !isValidIp(gw)) return this.err('The syntax supplied for this command is not valid. Check help for the correct syntax.');
        this.api.applyStatic(this.devId, { ip, mask, gateway: gw ?? '', dns: h.dnsFromDhcp ? [] : h.dns });
        this.api.recordChange(this.devId, `netsh set address static ${ip}`);
        return this.out(d.host!.ipConflict ? ['Ok.', '', 'Windows has detected an IP address conflict.'] : 'Ok.');
      }
      return this.err('Usage: netsh interface ip set address "Ethernet" dhcp | static <ip> <mask> [<gateway>]');
    }
    if (what === 'dns' || what === 'dnsservers') {
      if (lr[0] === 'dhcp') {
        h.dnsFromDhcp = true;
        if (h.dhcp) this.api.dhcpRenew(this.devId);
        else h.dns = [];
        this.e.invalidate();
        this.api.recordChange(this.devId, 'netsh set dns dhcp');
        return this.out('Ok.');
      }
      if (lr[0] === 'static' && isValidIp(rest[1])) {
        h.dnsFromDhcp = false;
        h.dns = [rest[1]];
        h.staticDns = [rest[1]];
        this.e.invalidate();
        this.api.recordChange(this.devId, `netsh set dns static ${rest[1]}`);
        return this.out('Ok.');
      }
      return this.err('Usage: netsh interface ip set dns "Ethernet" dhcp | static <ip>');
    }
    this.err('Usage: netsh interface ip set address|dns ...');
  }

  private webCheck(host: string, port: number): { ok: boolean; msg: string; ip: string | null; stage: string } {
    if (!isValidIp(host)) {
      const r = this.e.resolve(this.devId, host);
      if (!r.ok) return { ok: false, msg: `Could not resolve host: ${host}`, ip: null, stage: 'dns' };
    }
    const s = this.e.checkService(this.devId, host, 'tcp', port);
    if (s.ok) return { ok: true, msg: '', ip: s.dstIp, stage: 'ok' };
    if (s.stage === 'service') return { ok: false, msg: `Failed to connect to ${host} port ${port} after ${3 + (hash(host) % 9)} ms: Connection refused`, ip: s.dstIp, stage: 'service' };
    if (s.stage === 'dns') return { ok: false, msg: `Could not resolve host: ${host}`, ip: null, stage: 'dns' };
    return { ok: false, msg: `Failed to connect to ${host} port ${port} after 21045 ms: Timed out`, ip: s.dstIp, stage: s.stage };
  }

  private curl(args: string[]): void {
    const url = args.find((a) => !a.startsWith('-'));
    if (!url) return this.err('curl: try \'curl <url>\'');
    const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?/i.exec(url);
    if (!m) return this.err('curl: (3) URL using bad/illegal format or missing URL');
    const scheme = (m[1] ?? 'http').toLowerCase();
    const host = m[2];
    const port = Number(m[3] ?? (scheme === 'https' ? 443 : 80));
    const r = this.webCheck(host, port);
    if (!r.ok) return this.err(`curl: (${r.stage === 'dns' ? 6 : r.stage === 'service' ? 7 : 28}) ${r.msg}`);
    const s = this.e.checkService(this.devId, host, 'tcp', port);
    const slow = s.quality < 0.6;
    this.out([
      'HTTP/1.1 200 OK',
      'Content-Type: text/html; charset=utf-8',
      `X-Served-By: ${host}`,
      '',
      args.includes('-I') ? '' : `<!doctype html><html><head><title>${host}</title></head>...</html>`,
      slow ? `(transfer was very slow: ~${Math.round((1 - s.quality) * 100)}% packet loss, ${Math.round(s.latencyMs)} ms latency)` : `(completed in ${Math.max(1, Math.round(s.latencyMs * 3))} ms)`,
    ]);
  }

  private tnc(args: string[]): void {
    const host = args.find((a) => !a.startsWith('-') && !/^\d+$/.test(a));
    const pIdx = args.findIndex((a) => a.toLowerCase() === '-port');
    const port = pIdx >= 0 ? Number(args[pIdx + 1]) : 0;
    if (!host) return this.err('Test-NetConnection: missing -ComputerName');
    const i = this.d.ifaces[0];
    if (!port) {
      const { ip } = this.resolveFor(host);
      const r = ip ? this.e.roundTrip(this.devId, ip, 'icmp', 0) : null;
      return this.out(['', `ComputerName           : ${host}`, `RemoteAddress          : ${ip ?? ''}`, `InterfaceAlias         : ${this.adapterName()}`, `SourceAddress          : ${i.ip ?? ''}`, `PingSucceeded          : ${r?.ok ? 'True' : 'False'}`, `PingReplyDetails (RTT) : ${r?.ok ? Math.round(r.latencyMs) : 0} ms`]);
    }
    const r = this.webCheck(host, port);
    if (r.stage === 'dns') return this.err([`WARNING: Name resolution of ${host} failed`, '', `ComputerName   : ${host}`, 'RemoteAddress  :', 'TcpTestSucceeded : False']);
    this.out(['', `ComputerName     : ${host}`, `RemoteAddress    : ${r.ip ?? ''}`, `RemotePort       : ${port}`, `InterfaceAlias   : ${this.adapterName()}`, `SourceAddress    : ${i.ip ?? ''}`, `TcpTestSucceeded : ${r.ok ? 'True' : 'False'}`]);
    if (!r.ok) this.err(`WARNING: TCP connect to (${r.ip ?? host} : ${port}) failed`);
  }
}
