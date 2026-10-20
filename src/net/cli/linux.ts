/** Minimal Ubuntu-style shell for the servers. */
import { hash } from '../../core/rng';
import { dayIndex, fmtClock, pad2 } from '../../core/time';
import type { NetEngine } from '../engine';
import { internetHostByIp } from '../internet';
import { isValidIp, maskToPrefix } from '../ip';
import type { Device, ServiceState } from '../model';
import { type Shell, type SimApi, type TermLine, pad, pushLines, tokenize } from './shell';

const COMMANDS = ['ip', 'ping', 'traceroute', 'dig', 'nslookup', 'systemctl', 'journalctl', 'ss', 'df', 'du', 'top', 'uptime', 'free', 'hostname', 'cat', 'tail', 'reboot', 'clear', 'help', 'exit', 'sudo', 'apt'];

const UNIT_DESC: Record<string, string> = {
  named: 'BIND Domain Name Server',
  chronyd: 'chrony, an NTP client/server',
  smbd: 'Samba SMB Daemon',
  gitlab: 'GitLab (omnibus runsvdir)',
  nginx: 'A high performance web server and a reverse proxy server',
  'erp-api': 'Brightloop ERP API service',
  'restic-backup': 'Offsite backup agent (restic)',
  sshd: 'OpenBSD Secure Shell server',
};

function sysDate(t: number): string {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dd = dayIndex(t);
  return `${days[dd % 7]} 2026-10-${pad2(12 + dd)} ${fmtClock(t, true)} UTC`;
}

export class LinuxShell implements Shell {
  kind = 'linux' as const;
  lines: TermLine[] = [];
  history: string[] = [];
  private root = false;

  constructor(
    public devId: string,
    private api: SimApi,
  ) {
    const d = this.d;
    pushLines(this, [`Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 5.15.0-119-generic x86_64)`, '', ` * ${d.server?.os ?? ''}`, ` * Type "help" for the commands available in this simulation.`, ''], 'dim');
  }

  get e(): NetEngine {
    return this.api.engine;
  }
  get d(): Device {
    return this.api.engine.dev(this.devId);
  }

  prompt(): string {
    const h = this.d.name.toLowerCase();
    return this.root ? `root@${h}:~# ` : `netadmin@${h}:~$ `;
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
    if (!this.e.isUp(this.devId)) {
      this.err('ssh: connect to host port 22: Connection timed out (server is down or rebooting)');
      return;
    }
    let { tokens } = tokenize(raw);
    let sudo = this.root;
    if (tokens[0] === 'sudo') {
      if (tokens[1] === '-i' || tokens[1] === 'su') {
        this.root = true;
        return;
      }
      sudo = true;
      tokens = tokens.slice(1);
    }
    if (!tokens.length) return;
    const cmd = tokens[0];
    const args = tokens.slice(1);
    this.api.onCommand(this.devId, tokens.join(' '), raw);
    switch (cmd) {
      case 'ip':
        return this.ip(args);
      case 'ifconfig':
        return this.err('Command \'ifconfig\' not found, but can be installed with: apt install net-tools\n(Hint: use "ip a")');
      case 'ping':
        return this.ping(args);
      case 'traceroute':
      case 'tracepath':
        return this.traceroute(args);
      case 'dig':
      case 'nslookup':
      case 'host':
        return this.dig(cmd, args);
      case 'systemctl':
        return this.systemctl(args, sudo);
      case 'service':
        return this.systemctl([args[1] ?? 'status', args[0] ?? ''], sudo);
      case 'journalctl':
        return this.journalctl(args, sudo);
      case 'ss':
      case 'netstat':
        return this.ss();
      case 'df':
        return this.df();
      case 'du':
        return this.du();
      case 'top':
      case 'htop':
        return this.top();
      case 'uptime':
        return this.out(` ${fmtClock(this.e.now, true)} up 23 days,  4:12,  1 user,  load average: ${(this.d.server!.cpuPct / 25).toFixed(2)}, ${(this.d.server!.cpuPct / 28).toFixed(2)}, ${(this.d.server!.cpuPct / 30).toFixed(2)}`);
      case 'free':
        return this.out(['               total        used        free      shared  buff/cache   available', 'Mem:            31Gi       9.8Gi        14Gi       210Mi       7.1Gi        20Gi', 'Swap:          4.0Gi          0B       4.0Gi']);
      case 'hostname':
        return this.out(this.d.name.toLowerCase());
      case 'date':
        return this.out(sysDate(this.e.now));
      case 'cat':
        return this.cat(args);
      case 'tail':
        return this.tail(args);
      case 'apt':
      case 'apt-get':
        if (args[0] === 'clean') {
          if (!sudo) return this.err('E: Could not open lock file /var/cache/apt/archives/lock - open (13: Permission denied)');
          const freed = this.api.freeDisk(this.devId) * 0.1;
          return this.out(freed > 0 ? `(apt cache cleared, ${freed.toFixed(1)}G freed)` : '');
        }
        return this.err('Package management is outside the scope of this simulation.');
      case 'reboot':
        if (!sudo) return this.err('Failed to set wall message, ignoring: Interactive authentication required.\nCall to Reboot failed: Interactive authentication required.');
        this.out(['', `Broadcast message from root@${this.d.name.toLowerCase()} on pts/0:`, 'The system will reboot now!', '', 'Connection to host closed by remote host.']);
        this.api.reloadDevice(this.devId);
        return;
      case 'clear':
        this.lines.length = 0;
        return;
      case 'exit':
      case 'logout':
        if (this.root) {
          this.root = false;
          return this.out('logout');
        }
        return this.out('[Connection closed. Press Enter to reconnect.]');
      case 'help':
        return this.out([
          'Commands available in this simulation:',
          '  ip a | ip route                 ping [-c n] <host>',
          '  traceroute <host>               dig <name> | nslookup <name>',
          '  systemctl status|start|stop|restart <service>',
          '  systemctl --failed              journalctl -u <service> [-n N]',
          '  ss -tulpn                       df -h    du -sh /var/log/*',
          '  journalctl --vacuum-size=500M   apt clean',
          '  cat /etc/resolv.conf | /etc/hosts | /etc/bind/db.corp.local (DNS server)',
          '  tail /var/log/syslog            top   uptime   free -h',
          '  sudo <cmd> | sudo -i            reboot (sudo)',
        ]);
      default:
        return this.err(`${cmd}: command not found`);
    }
  }

  // -------------------------------------------------------------------------

  private ip(args: string[]): void {
    const sub = (args[0] ?? '').toLowerCase();
    const i = this.d.ifaces[0];
    const up = this.e.oper(i).up;
    if (sub.startsWith('a')) {
      return this.out([
        '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
        '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
        '    inet 127.0.0.1/8 scope host lo',
        `2: eth0: <BROADCAST,MULTICAST${up ? ',UP,LOWER_UP' : ',UP'}> mtu 1500 qdisc mq state ${up ? 'UP' : 'DOWN'} group default qlen 1000`,
        `    link/ether ${i.mac} brd ff:ff:ff:ff:ff:ff`,
        ...(i.ip && i.mask ? [`    inet ${i.ip}/${maskToPrefix(i.mask)} brd ${i.ip.split('.').slice(0, 3).join('.')}.255 scope global eth0`, '       valid_lft forever preferred_lft forever'] : []),
      ]);
    }
    if (sub.startsWith('r')) {
      const h = this.d.host!;
      const out: string[] = [];
      if (h.gateway) out.push(`default via ${h.gateway} dev eth0 proto static`);
      if (i.ip && i.mask) out.push(`${i.ip.split('.').slice(0, 3).join('.')}.0/${maskToPrefix(i.mask)} dev eth0 proto kernel scope link src ${i.ip}`);
      return this.out(out);
    }
    if (sub.startsWith('l')) return this.out(['1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536', `2: eth0: <BROADCAST,MULTICAST,UP${up ? ',LOWER_UP' : ''}> mtu 1500 state ${up ? 'UP' : 'DOWN'}`, `    link/ether ${i.mac}`]);
    this.err('Usage: ip a | ip route | ip link\n(Changing server addressing is outside the scope of this simulation; servers use static netplan configs.)');
  }

  private resolve(target: string): string | null {
    if (isValidIp(target)) return target;
    const r = this.e.resolve(this.devId, target);
    return r.ok ? r.ip : null;
  }

  private ping(args: string[]): void {
    let count = 4;
    let target: string | undefined;
    for (let k = 0; k < args.length; k++) {
      if (args[k] === '-c') count = Math.max(1, Math.min(20, Number(args[++k]) || 4));
      else if (!args[k].startsWith('-')) target = args[k];
    }
    if (!target) return this.err('ping: usage error: Destination address required');
    const ip = this.resolve(target);
    if (!ip) return this.err(`ping: ${target}: Temporary failure in name resolution`);
    const out = [`PING ${target} (${ip}) 56(84) bytes of data.`];
    const r = this.e.roundTrip(this.devId, ip, 'icmp', 0);
    const times: number[] = [];
    if (!r.ok && (r.fwd.code === 'no-gateway' || r.fwd.code === 'link-down' || r.fwd.code === 'no-link')) {
      out.push('ping: connect: Network is unreachable');
      return this.out(out);
    }
    for (let k = 1; k <= count; k++) {
      const respond = r.ok && (!r.fwd.external || r.fwd.external.icmp) && Math.random() < r.quality + 0.03;
      if (respond) {
        const t = Math.max(0.2, r.latencyMs + (Math.random() - 0.3) * 0.5);
        times.push(t);
        out.push(`64 bytes from ${ip}: icmp_seq=${k} ttl=${r.fwd.external ? 54 : 64 - Math.max(0, r.fwd.hops.length - 1)} time=${t.toFixed(t < 10 ? 3 : 1)} ms`);
      } else if (!r.ok && r.fwd.code === 'arp' && r.fwd.failDev === this.devId) out.push(`From ${this.d.ifaces[0].ip} icmp_seq=${k} Destination Host Unreachable`);
    }
    out.push('', `--- ${target} ping statistics ---`, `${count} packets transmitted, ${times.length} received, ${Math.round(((count - times.length) / count) * 100)}% packet loss, time ${count * 1000 + 3}ms`);
    if (times.length) {
      const mn = Math.min(...times);
      const mx = Math.max(...times);
      const av = times.reduce((a, b) => a + b, 0) / times.length;
      out.push(`rtt min/avg/max/mdev = ${mn.toFixed(3)}/${av.toFixed(3)}/${mx.toFixed(3)}/${((mx - mn) / 3).toFixed(3)} ms`);
    }
    this.out(out);
  }

  private traceroute(args: string[]): void {
    const target = args.find((a) => !a.startsWith('-'));
    if (!target) return this.err('Usage: traceroute <host>');
    const ip = this.resolve(target);
    if (!ip) return this.err(`${target}: Temporary failure in name resolution\nCannot handle "host" cmdline arg \`${target}' on position 1 (argc 1)`);
    const out = [`traceroute to ${target} (${ip}), 30 hops max, 60 byte packets`];
    const r = this.e.roundTrip(this.devId, ip, 'icmp', 0);
    let n = 0;
    for (const [k, h] of r.fwd.hops.entries()) {
      if (!r.ok && !this.e.hopReplies(r.fwd, k)) {
        out.push(` ${++n}  * * *`);
        continue;
      }
      out.push(` ${++n}  ${h.ip} (${h.ip})  ${(0.3 * n).toFixed(3)} ms  ${(0.35 * n).toFixed(3)} ms  ${(0.32 * n).toFixed(3)} ms`);
      if (h.dev === 'isp-gw' && r.fwd.external) for (const x of ['100.64.18.1', '62.115.40.97']) out.push(` ${++n}  ${x} (${x})  ${6 + n}.112 ms  ${6 + n}.240 ms  ${6 + n}.198 ms`);
    }
    if (r.ok && r.fwd.external) out.push(` ${++n}  ${ip} (${ip})  ${r.latencyMs.toFixed(3)} ms  ${r.latencyMs.toFixed(3)} ms  ${r.latencyMs.toFixed(3)} ms`);
    if (!r.ok) for (let k = 0; k < 4; k++) out.push(` ${++n}  * * *`);
    this.out(out);
  }

  private dig(cmd: string, args: string[]): void {
    const name = args.find((a) => !a.startsWith('@') && !a.startsWith('+') && !a.startsWith('-'));
    const at = args.find((a) => a.startsWith('@'))?.slice(1);
    if (!name) return this.err(`Usage: ${cmd} <name> [@server]`);
    const r = at && isValidIp(at) ? this.e.resolveWith(this.devId, name, [at]) : this.e.resolve(this.devId, name);
    const srv = r.server ?? this.d.host?.dns[0] ?? '127.0.0.53';
    if (cmd === 'dig') {
      const status = r.ok ? 'NOERROR' : r.code === 'nxdomain' ? 'NXDOMAIN' : r.code === 'servfail' ? 'SERVFAIL' : 'TIMEOUT';
      if (status === 'TIMEOUT') return this.err([`;; communications error to ${srv}#53: timed out`, `;; no servers could be reached`]);
      const out = [`; <<>> DiG 9.18.28-0ubuntu0.22.04.1-Ubuntu <<>> ${name}`, ';; global options: +cmd', ';; Got answer:', `;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: ${hash(name) % 65535}`, '', ';; QUESTION SECTION:', `;${r.fqdn}.\t\tIN\tA`, ''];
      if (r.ok) out.push(';; ANSWER SECTION:', `${r.fqdn}.\t300\tIN\tA\t${r.ip}`, '');
      out.push(`;; Query time: ${1 + (hash(name) % 30)} msec`, `;; SERVER: ${srv}#53(${srv}) (UDP)`, `;; WHEN: ${sysDate(this.e.now)}`);
      return this.out(out);
    }
    if (!r.ok) return this.out([`Server:\t\t${srv}`, `Address:\t${srv}#53`, '', r.code === 'nxdomain' ? `** server can't find ${name}: NXDOMAIN` : `;; connection timed out; no servers could be reached`]);
    this.out([`Server:\t\t${srv}`, `Address:\t${srv}#53`, '', r.fqdn.endsWith('.corp.local') ? '' : 'Non-authoritative answer:', `Name:\t${r.fqdn}`, `Address: ${r.ip}`]);
  }

  private svc(name: string): ServiceState | undefined {
    const n = name.replace(/\.service$/, '');
    return this.d.server?.services.find((s) => s.name === n || s.id === n || (n === 'bind9' && s.name === 'named') || (n === 'ssh' && s.name === 'sshd'));
  }

  private status(s: ServiceState): string[] {
    const since = sysDate(Math.max(0, this.e.now - 140));
    const pid = 700 + (hash(s.name) % 900);
    const head = `${s.running ? '●' : '×'} ${s.name}.service - ${UNIT_DESC[s.name] ?? s.label}`;
    const loaded = `     Loaded: loaded (/lib/systemd/system/${s.name}.service; ${s.enabled ? 'enabled' : 'disabled'}; vendor preset: enabled)`;
    if (s.running)
      return [head, loaded, `     Active: active (running) since ${since}; 2h 20min ago`, `   Main PID: ${pid} (${s.name})`, `      Tasks: ${4 + (hash(s.name) % 20)} (limit: 38281)`, `     Memory: ${(20 + (hash(s.name) % 400)).toFixed(1)}M`, `     CGroup: /system.slice/${s.name}.service`, `             └─${pid} /usr/sbin/${s.name}`];
    const logs = this.d.logs.filter((l) => l.msg.includes(s.name)).slice(-4).map((l) => `${sysDate(l.t).slice(4, 19)} ${this.d.name.toLowerCase()} ${l.msg}`);
    return [head, loaded, s.failed ? `     Active: failed (Result: exit-code) since ${sysDate(this.e.now - 15)}` : `     Active: inactive (dead)`, s.failed ? `    Process: ${pid} ExecStart=/usr/sbin/${s.name} (code=exited, status=1/FAILURE)` : '', '', ...logs];
  }

  private systemctl(args: string[], sudo: boolean): void {
    const action = (args[0] ?? '').toLowerCase();
    const services = this.d.server?.services ?? [];
    if (action === '--failed' || (action === 'list-units' && args.includes('--failed'))) {
      const failed = services.filter((s) => !s.running);
      return this.out(['  UNIT                 LOAD   ACTIVE SUB    DESCRIPTION', ...failed.map((s) => `● ${pad(s.name + '.service', 20)} loaded ${s.failed ? 'failed' : 'inactive'} ${s.failed ? 'failed' : 'dead  '} ${UNIT_DESC[s.name] ?? s.label}`), '', `${failed.length} loaded units listed.`]);
    }
    if (action === 'list-units' || action === '' || action === 'list-unit-files') {
      return this.out(['  UNIT                       LOAD   ACTIVE   SUB     DESCRIPTION', ...services.map((s) => `  ${pad(s.name + '.service', 26)} loaded ${pad(s.running ? 'active' : s.failed ? 'failed' : 'inactive', 8)} ${pad(s.running ? 'running' : s.failed ? 'failed' : 'dead', 7)} ${UNIT_DESC[s.name] ?? s.label}`)]);
    }
    const name = args[1];
    if (!name) return this.err(`Too few arguments.`);
    const s = this.svc(name);
    if (!s) return this.err(`Unit ${name.replace(/\.service$/, '')}.service could not be found.`);
    if (action === 'status') return this.out(this.status(s));
    if (['start', 'stop', 'restart', 'reload'].includes(action)) {
      if (!sudo) return this.err(`Failed to ${action} ${s.name}.service: Interactive authentication required.\nSee system logs and 'systemctl status ${s.name}.service' for details.\n(Hint: prefix the command with sudo)`);
      const r = this.api.restartService(this.devId, s.name, action === 'stop' ? 'stop' : action === 'start' ? 'start' : 'restart');
      if (!r.ok) return this.err(`Job for ${s.name}.service failed because the control process exited with error code.\nSee "systemctl status ${s.name}.service" and "journalctl -xeu ${s.name}.service" for details.`);
      if (r.msg) this.out(r.msg);
      return;
    }
    if (action === 'enable' || action === 'disable') {
      if (!sudo) return this.err('Failed: Interactive authentication required.');
      s.enabled = action === 'enable';
      return this.out(`${action === 'enable' ? 'Created symlink' : 'Removed'} /etc/systemd/system/multi-user.target.wants/${s.name}.service.`);
    }
    this.err(`Unknown command verb ${action}.`);
  }

  private journalctl(args: string[], sudo: boolean): void {
    const vac = args.find((a) => a.startsWith('--vacuum'));
    if (vac) {
      if (!sudo) return this.err('Failed to vacuum: Permission denied (use sudo)');
      const freed = this.api.freeDisk(this.devId);
      return this.out(freed > 0 ? [`Deleted archived journal /var/log/journal/9f3a…/system@0005f2a1-…journal~ (${(freed * 0.6).toFixed(1)}G).`, `Deleted archived journal /var/log/journal/9f3a…/user-1000@…journal~ (${(freed * 0.4).toFixed(1)}G).`, `Vacuuming done, freed ${freed.toFixed(1)}G of archived journals from /var/log/journal/9f3a….`] : 'Vacuuming done, freed 0B of archived journals.');
    }
    const uIdx = args.findIndex((a) => a === '-u' || a === '--unit');
    const unit = uIdx >= 0 ? args[uIdx + 1]?.replace(/\.service$/, '') : null;
    const nIdx = args.findIndex((a) => a === '-n');
    const n = nIdx >= 0 ? Number(args[nIdx + 1]) || 20 : 20;
    let logs = this.d.logs;
    if (unit) logs = logs.filter((l) => l.msg.includes(unit));
    this.out(logs.length ? logs.slice(-n).map((l) => `${sysDate(l.t).slice(4, 19)} ${this.d.name.toLowerCase()} ${l.msg}`) : ['-- No entries --']);
  }

  private ss(): void {
    const d = this.d;
    const ip = d.ifaces[0].ip ?? '0.0.0.0';
    const out = ['Netid State  Recv-Q Send-Q Local Address:Port    Peer Address:Port Process'];
    for (const s of d.server?.services ?? []) {
      if (!s.running) continue;
      for (const p of s.ports) out.push(`${pad(s.proto, 6)}${pad(s.proto === 'udp' ? 'UNCONN' : 'LISTEN', 7)}0      ${pad(s.proto === 'udp' ? 0 : 4096, 7)}${pad(`${s.name === 'sshd' ? '0.0.0.0' : ip}:${p}`, 21)}${pad('0.0.0.0:*', 18)}users:(("${s.name}",pid=${700 + (hash(s.name) % 900)},fd=${3 + (p % 10)}))`);
    }
    this.out(out);
  }

  private df(): void {
    const used = this.d.server!.diskUsedPct;
    const size = 98;
    const u = (size * used) / 100;
    this.out(['Filesystem                         Size  Used Avail Use% Mounted on', 'tmpfs                              3.2G  1.4M  3.2G   1% /run', `/dev/mapper/ubuntu--vg-ubuntu--lv   ${size}G   ${u.toFixed(0)}G  ${Math.max(0, size - u).toFixed(1)}G  ${Math.round(used)}% /`, 'tmpfs                               16G     0   16G   0% /dev/shm', '/dev/sda2                          2.0G  253M  1.6G  14% /boot']);
  }

  private du(): void {
    const used = this.d.server!.diskUsedPct;
    const journal = Math.max(0.4, ((used - 40) / 100) * 98);
    this.out([`${journal.toFixed(1)}G\t/var/log/journal`, '312M\t/var/log/syslog.1', '48M\t/var/log/syslog', '12M\t/var/log/auth.log', '2.1M\t/var/log/apt']);
  }

  private top(): void {
    const d = this.d;
    const cpu = d.server!.cpuPct;
    const out = [`top - ${fmtClock(this.e.now, true)} up 23 days,  4:12,  1 user,  load average: ${(cpu / 25).toFixed(2)}, ${(cpu / 28).toFixed(2)}, ${(cpu / 30).toFixed(2)}`, `%Cpu(s): ${cpu.toFixed(1)} us,  1.2 sy,  0.0 ni, ${(98 - cpu).toFixed(1)} id,  0.1 wa`, 'MiB Mem :  32041.2 total,  14612.4 free,  10052.1 used,   7376.7 buff/cache', '', '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND'];
    for (const s of d.server!.services.filter((x) => x.running)) {
      const share = s.name === 'restic-backup' && cpu > 30 ? cpu * 0.8 : cpu / d.server!.services.length;
      out.push(`${String(700 + (hash(s.name) % 900)).padStart(7)} ${pad(s.name === 'named' ? 'bind' : 'root', 9)} 20   0  ${String(800000 + (hash(s.name) % 900000)).padStart(6)} ${String(20000 + (hash(s.name) % 90000)).padStart(6)}  12400 S  ${share.toFixed(1).padStart(4)}   ${(1 + (hash(s.name) % 5)).toFixed(1)}  12:${pad2(hash(s.name) % 60)}.11 ${s.name}`);
    }
    this.out(out);
  }

  private cat(args: string[]): void {
    const f = args[0];
    const h = this.d.host!;
    if (f === '/etc/resolv.conf') return this.out(['# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).', ...h.dns.map((s) => `nameserver ${s}`), 'search corp.local']);
    if (f === '/etc/hosts') return this.out(['127.0.0.1 localhost', `${h.ip} ${this.d.name.toLowerCase()}.corp.local ${this.d.name.toLowerCase()}`]);
    if (f === '/etc/netplan/50-cloud-init.yaml' || f === '/etc/netplan/01-netcfg.yaml') return this.out(['network:', '  version: 2', '  ethernets:', '    eth0:', `      addresses: [${h.ip}/${maskToPrefix(h.mask ?? '255.255.255.0')}]`, `      routes:`, `        - to: default`, `          via: ${h.gateway}`, `      nameservers:`, `        addresses: [${h.dns.join(', ')}]`]);
    if (f === '/etc/bind/db.corp.local' || f === '/etc/bind/zones/db.corp.local') {
      const z = this.d.server?.dnsZone;
      if (!z) return this.err(`cat: ${f}: No such file or directory`);
      return this.out(['$TTL    300', '@       IN      SOA     ns1.corp.local. hostmaster.corp.local. (', '                     2026101201 ; Serial', '                     3600 ; Refresh', '                     600  ; Retry', '                     86400 ; Expire', '                     300 ) ; Negative Cache TTL', '@       IN      NS      ns1.corp.local.', ...z.map((r) => `${pad(r.name.replace(/\.corp\.local$/, ''), 16)}IN      ${pad(r.type, 8)}${r.type === 'CNAME' ? r.value + '.' : r.value}`), '', '; (Edit records in the "DNS" tab of this server\'s panel)']);
    }
    if (f === '/etc/bind/named.conf.options') {
      const fw = this.d.server?.dnsForwarders;
      if (!fw) return this.err(`cat: ${f}: No such file or directory`);
      return this.out(['options {', '    directory "/var/cache/bind";', '    forwarders {', ...fw.map((x) => `        ${x};  // ${internetHostByIp(x)?.name ?? ''}`), '    };', '    allow-query { 10.10.0.0/16; };', '    dnssec-validation auto;', '};']);
    }
    if (f === '/var/log/syslog') return this.tail(['/var/log/syslog']);
    this.err(`cat: ${f ?? ''}: No such file or directory`);
  }

  private tail(args: string[]): void {
    const f = args.find((a) => a.startsWith('/'));
    if (f !== '/var/log/syslog' && f !== '/var/log/messages') return this.err(`tail: cannot open '${f ?? ''}' for reading: No such file or directory`);
    const nIdx = args.indexOf('-n');
    const n = nIdx >= 0 ? Number(args[nIdx + 1]) || 10 : 10;
    const logs = this.d.logs.slice(-n);
    this.out(logs.length ? logs.map((l) => `${sysDate(l.t).slice(4, 19)} ${this.d.name.toLowerCase()} ${l.msg}`) : [`${sysDate(this.e.now).slice(4, 19)} ${this.d.name.toLowerCase()} systemd[1]: Started Daily apt download activities.`]);
  }
}
