import { useState } from 'react';
import type { Device } from '../net/model';
import { SUBNETS } from '../net/topology';
import { useUi } from './ctx';
import { Icon } from './icons';

const GROUPS: { label: string; kinds: Device['kind'][] }[] = [
  { label: 'Edge & core', kinds: ['isp', 'firewall', 'l3switch'] },
  { label: 'Access switches', kinds: ['switch'] },
  { label: 'Servers', kinds: ['server'] },
  { label: 'Access points', kinds: ['ap'] },
  { label: 'Printers & IoT', kinds: ['printer', 'iot'] },
  { label: 'Computers', kinds: ['pc', 'laptop'] },
  { label: 'Unknown devices', kinds: ['rogue'] },
];

function statusOf(game: ReturnType<typeof useUi>['game'], d: Device): { cls: string; text: string } {
  const e = game.engine;
  if (!e.c.devPowered.get(d.id)) return { cls: 'bad', text: 'off' };
  if (!e.isUp(d.id)) return { cls: 'warn', text: 'booting' };
  return { cls: 'up', text: 'running' };
}

function Devices() {
  const { game, openDevice, select, flyTo } = useUi();
  const [q, setQ] = useState('');
  const devs = Object.values(game.s.net.devices);
  const ql = q.toLowerCase();
  const match = (d: Device) => !ql || d.name.toLowerCase().includes(ql) || (game.ownerOf(d.id)?.name.toLowerCase().includes(ql) ?? false) || (d.ifaces.some((i) => i.ip?.includes(ql)) ?? false) || d.model.toLowerCase().includes(ql);
  return (
    <div className="drawer-body">
      <input type="search" placeholder="Find by name, user, IP or model…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} aria-label="Find device" autoFocus />
      {GROUPS.map((g) => {
        const list = devs.filter((d) => g.kinds.includes(d.kind) && match(d));
        if (!list.length) return null;
        return (
          <section key={g.label}>
            <div className="section-title">{g.label}</div>
            <table className="grid">
              <tbody>
                {list.map((d) => {
                  const st = statusOf(game, d);
                  const ip = game.engine.primaryIf(d)?.ip;
                  return (
                    <tr key={d.id} className="clickable" tabIndex={0} onClick={() => {
                      select(d.id);
                      openDevice(d.id);
                      flyTo(d.pos.x, d.pos.y);
                    }} onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        select(d.id);
                        openDevice(d.id);
                        flyTo(d.pos.x, d.pos.y);
                      }
                    }}>
                      <td style={{ width: 16 }}>
                        <span className={`dot ${st.cls}`} title={st.text} />
                      </td>
                      <td>
                        <b>{d.kind === 'rogue' ? 'Unknown device' : d.name}</b>
                        <div className="dim" style={{ fontSize: 12.5 }}>
                          {d.model}
                        </div>
                      </td>
                      <td className="mono">{d.kind === 'rogue' ? '' : (ip ?? '')}</td>
                      <td className="dim">{game.ownerOf(d.id)?.name ?? ''}</td>
                      <td className="dim">{st.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

/** Logical topology diagram (tiered), link colour = state. */
function Topology() {
  const { game, openDevice } = useUi();
  const e = game.engine;
  const net = game.s.net;
  const W = 700;
  const tiers: string[][] = [['isp-gw'], ['fw-edge'], ['core-sw1'], ['srv-dc01', 'srv-file', 'srv-git', 'srv-app', 'srv-backup', 'noc-pc'], ['sw-eng', 'sw-dqa', 'sw-office']];
  const pos = new Map<string, { x: number; y: number }>();
  tiers.forEach((t, row) => t.forEach((id, k) => pos.set(id, { x: ((k + 0.5) / t.length) * W, y: 40 + row * 66 })));
  // endpoints under access switches, one column zone per switch
  const access = ['sw-eng', 'sw-dqa', 'sw-office'];
  const children = new Map<string, Device[]>();
  for (const d of Object.values(net.devices)) {
    if (['pc', 'printer', 'ap', 'iot', 'rogue'].includes(d.kind) && d.id !== 'noc-pc') {
      const ap = game.accessPort(d.id);
      if (ap && access.includes(ap.sw.id)) {
        if (!children.has(ap.sw.id)) children.set(ap.sw.id, []);
        children.get(ap.sw.id)!.push(d);
      }
    }
  }
  const COLS = 5;
  const top = 40 + 4 * 66 + 46;
  access.forEach((sw, si) => {
    const list = children.get(sw) ?? [];
    const zone = W / access.length;
    const x0 = si * zone + 8;
    list.forEach((d, k) => {
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      pos.set(d.id, { x: x0 + (col + 0.5) * ((zone - 16) / COLS), y: top + row * 36 });
    });
  });
  const height = top + Math.max(...access.map((s) => Math.ceil((children.get(s)?.length ?? 0) / COLS))) * 36 + 10;
  const linkColor = (lId: string) => {
    const l = net.links[lId];
    const ia = net.devices[l.a.dev]?.ifaces.find((i) => i.name === l.a.iface);
    if (l.status !== 'ok' && l.status !== 'degraded') return '#d64545';
    if (e.c.stpBlocked.has(`${l.a.dev}|${l.a.iface}`) || e.c.stpBlocked.has(`${l.b.dev}|${l.b.iface}`)) return '#6b6b75';
    if (!ia || !e.oper(ia).up) return '#d64545';
    if (l.status === 'degraded' || e.oper(ia).duplexMismatch) return '#f59e0b';
    const u = e.utilization(l.id);
    return u > 0.85 ? '#ea6a1f' : l.medium === 'fiber' ? '#e8961f' : '#3d8de4';
  };
  const devColor = (d: Device) => (!e.c.devPowered.get(d.id) ? '#d64545' : !e.isUp(d.id) ? '#d48a12' : d.kind === 'rogue' ? '#f5b70a' : '#3ecf6e');
  return (
    <div className="drawer-body">
      <div className="muted" style={{ fontSize: 14, marginBottom: 6 }}>
        Logical view. Blue = copper, amber = fiber, red = down, grey = blocked by spanning tree, orange = congested/errors. Click a node to inspect it.
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', background: '#0e0e12', margin: 4, boxShadow: '0 -3px 0 0 #33333c, 0 3px 0 0 #33333c, -3px 0 0 0 #33333c, 3px 0 0 0 #33333c' }} role="img" aria-label="Logical network topology">
        <text x={W / 2} y={14} fill="#a1a1aa" fontSize="11" fontWeight="800" textAnchor="middle">
          INTERNET
        </text>
        <line x1={W / 2} y1={18} x2={pos.get('isp-gw')!.x} y2={pos.get('isp-gw')!.y - 12} stroke={net.ispOutage ? '#d64545' : '#3d8de4'} strokeWidth={2} strokeDasharray={net.ispOutage ? '4 4' : undefined} />
        {Object.values(net.links).map((l) => {
          const a = pos.get(l.a.dev);
          const b = pos.get(l.b.dev);
          if (!a || !b) return null;
          return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={linkColor(l.id)} strokeWidth={l.medium === 'fiber' ? 2.5 : 1.2} strokeDasharray={l.status !== 'ok' ? '4 3' : undefined} opacity={0.85} />;
        })}
        {[...pos.entries()].map(([id, p]) => {
          const d = net.devices[id];
          if (!d) return null;
          const big = ['isp', 'firewall', 'l3switch', 'switch', 'server'].includes(d.kind) || id === 'noc-pc';
          return (
            <g key={id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} onClick={() => openDevice(id)} role="button" aria-label={`Open ${d.name}`} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && openDevice(id)}>
              {big ? <rect x={-34} y={-12} width={68} height={24} rx={0} fill="#1b1b21" stroke={devColor(d)} strokeWidth={2.2} /> : <circle r={9} fill="#1b1b21" stroke={devColor(d)} strokeWidth={2.2} />}
              <text y={big ? 4 : 22} fill="#f4f4f5" fontWeight="800" fontSize={big ? 10 : 8} textAnchor="middle">
                {d.kind === 'rogue' ? '???' : d.name.replace(/^(ENG|DSN|QA|FIN|RCP)-PC/, '$1')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function IpPlan() {
  const { game } = useUi();
  const core = game.dev('core-sw1');
  return (
    <div className="drawer-body">
      <table className="grid">
        <thead>
          <tr>
            <th>VLAN</th>
            <th>Name</th>
            <th>Subnet</th>
            <th>Gateway (SVI)</th>
            <th>DHCP pool</th>
          </tr>
        </thead>
        <tbody>
          {SUBNETS.map((s) => {
            const pool = core.ios?.dhcpPools.find((p) => p.network === s.net);
            const st = pool ? game.engine.poolStats(core, pool) : null;
            return (
              <tr key={s.vlan}>
                <td className="mono">{s.vlan}</td>
                <td>{s.name}</td>
                <td className="mono">{s.net}/24</td>
                <td className="mono">{s.gw}</td>
                <td>{pool ? `${pool.name} · ${st!.leased} leased, ${st!.free} free` : <span className="dim">static only</span>}</td>
              </tr>
            );
          })}
          <tr>
            <td className="mono">—</td>
            <td>Core↔FW</td>
            <td className="mono">10.0.0.0/30</td>
            <td className="mono">.1 FW / .2 core</td>
            <td className="dim">routed link</td>
          </tr>
          <tr>
            <td className="mono">—</td>
            <td>WAN</td>
            <td className="mono">203.0.113.0/30</td>
            <td className="mono">.1 ISP / .2 FW</td>
            <td className="dim">public, NAT</td>
          </tr>
        </tbody>
      </table>
      <div className="section-title">Key servers</div>
      <table className="grid">
        <tbody>
          {['srv-dc01', 'srv-file', 'srv-git', 'srv-app', 'srv-backup'].map((id) => {
            const d = game.dev(id);
            return (
              <tr key={id}>
                <td>
                  <b>{d.name}</b>
                </td>
                <td className="mono">{d.ifaces[0].ip}</td>
                <td className="dim">{d.server?.services.map((s) => s.name).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 14 }}>
        <Icon name="book" size={14} /> Full details: Manual → "The office network".
      </p>
    </div>
  );
}

export function NetworkPanel() {
  const [tab, setTab] = useState<'devices' | 'topology' | 'ip'>('devices');
  return (
    <>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'devices'} onClick={() => setTab('devices')}>
          Devices
        </button>
        <button className="tab" role="tab" aria-selected={tab === 'topology'} onClick={() => setTab('topology')}>
          Topology
        </button>
        <button className="tab" role="tab" aria-selected={tab === 'ip'} onClick={() => setTab('ip')}>
          IP plan
        </button>
      </div>
      {tab === 'devices' && <Devices />}
      {tab === 'topology' && <Topology />}
      {tab === 'ip' && <IpPlan />}
    </>
  );
}
