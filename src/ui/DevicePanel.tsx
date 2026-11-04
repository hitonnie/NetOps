import { useEffect, useRef, useState } from 'react';
import { XpBar } from '@/components/ui/8bit-xp-bar';
import { money } from '../core/money';
import { fmtClock } from '../core/time';
import { isUnsaved, renderRunningConfig } from '../net/config';
import { maskToPrefix } from '../net/ip';
import { type Device, type Iface, isIos, shortIf, windowsMac, ciscoMac } from '../net/model';
import { vendorOf } from '../net/topology';
import { ROOMS } from '../world/layout';
import { type DevWindow, useGameTick, useUi } from './ctx';
import { ConfirmButton } from './ConfirmButton';
import { Icon } from './icons';
import { Terminal } from './Terminal';

const KIND_LABEL: Record<string, string> = {
  pc: 'Desktop PC',
  laptop: 'Laptop (Wi-Fi)',
  printer: 'Network printer',
  server: 'Server',
  switch: 'Access switch',
  l3switch: 'Layer-3 core switch',
  firewall: 'Edge router / firewall',
  ap: 'Wireless access point',
  isp: 'ISP handoff (managed)',
  iot: 'IoT / AV device',
  rogue: 'Unknown device',
};

const KIND_ICON: Record<string, string> = { pc: 'terminal', laptop: 'terminal', printer: 'list', server: 'server', switch: 'network', l3switch: 'network', firewall: 'shield', ap: 'wifi', isp: 'cable', iot: 'info', rogue: 'warning' };

export function tabsFor(d: Device): { id: string; label: string }[] {
  const t = [{ id: 'overview', label: 'Overview' }];
  if (isIos(d)) t.push({ id: 'ports', label: 'Ports' }, { id: 'cli', label: 'CLI' }, { id: 'config', label: 'Config' }, { id: 'logs', label: 'Logs' });
  if (d.kind === 'pc' || d.kind === 'laptop') t.push({ id: 'network', label: 'Network settings' }, { id: 'cli', label: 'Terminal' }, { id: 'security', label: 'Security' });
  if (d.kind === 'server') {
    t.push({ id: 'services', label: 'Services' }, { id: 'cli', label: 'Terminal' });
    if (d.server?.dnsZone) t.push({ id: 'dns', label: 'DNS' });
    t.push({ id: 'logs', label: 'Logs' });
  }
  if (d.kind === 'ap') t.push({ id: 'wireless', label: 'Wireless' });
  if (d.kind === 'printer') t.push({ id: 'printer', label: 'Printer' });
  if (d.kind === 'isp') t.push({ id: 'isp', label: 'ISP circuit' });
  return t;
}

function StatusChip({ d }: { d: Device }) {
  const { game } = useUi();
  const e = game.engine;
  const powered = e.c.devPowered.get(d.id);
  const up = e.isUp(d.id);
  const label = !powered ? (d.powerFault ? 'No power (PSU failed)' : d.poeW > 0 && d.powered ? 'No power (PoE)' : 'Powered off') : !up ? (d.pc?.reimageUntil ? 'Re-imaging…' : 'Booting…') : 'Running';
  const cls = !powered ? 'bad' : !up ? 'warn' : 'up';
  return (
    <span className="row" style={{ gap: 5, fontSize: 14 }}>
      <span className={`dot ${cls}`} aria-hidden /> {label}
    </span>
  );
}

function useAction() {
  const { game } = useUi();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (devId: string, a: string, args?: Record<string, unknown>) => {
    const r = game.performAction(devId, a, args);
    setMsg({ ok: r.ok, text: r.msg });
  };
  const view = msg && (
    <div className={`hint ${msg.ok ? 'ok' : 'bad'}`} role="status">
      {msg.text}
    </div>
  );
  return { act, view, setMsg };
}

function ifStatus(game: ReturnType<typeof useUi>['game'], i: Iface): { text: string; cls: string } {
  const o = game.engine.oper(i);
  if (o.status === 'err-disabled') return { text: 'err-disabled', cls: 'bad' };
  if (o.status === 'disabled') return { text: 'disabled (shutdown)', cls: 'down' };
  if (o.status === 'inactive') return { text: 'inactive (no VLAN)', cls: 'warn' };
  if (o.up) return { text: o.duplexMismatch ? 'connected · duplex mismatch' : 'connected', cls: o.duplexMismatch ? 'warn' : 'up' };
  return { text: o.reason || 'notconnect', cls: 'down' };
}

function Connections({ d }: { d: Device }) {
  const { game, openDevice } = useUi();
  const { act, view } = useAction();
  const e = game.engine;
  const rows = d.ifaces
    .map((i) => ({ i, p: e.peerOf(d.id, i.name) }))
    .filter((x) => x.p);
  if (d.ifaces[0]?.type === 'wlan') {
    const w = e.c.wlan.get(d.id);
    return (
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Wi-Fi
        </div>
        {w ? (
          <div>
            Associated to{' '}
            <button className="linkish" onClick={() => openDevice(w.ap)}>
              {game.dev(w.ap)?.name}
            </button>{' '}
            · channel {w.channel} · signal {Math.round(Math.min(99, 25 + w.signal * 110))}% · link quality {Math.round(w.quality * 100)}%
          </div>
        ) : (
          <div className="muted">Not connected — no access point in range (or the AP is down).</div>
        )}
      </div>
    );
  }
  if (!rows.length) return <div className="muted">No cables connected.</div>;
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>
        Cabling
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Local</th>
            <th>Connected to</th>
            <th>Cable</th>
            <th>Link</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ i, p }) => {
            const peer = game.dev(p!.dev);
            const raw = ifStatus(game, i);
            // endpoints only see their own link light, not why the far end is down
            const st = isIos(d) ? raw : { text: raw.cls === 'up' ? 'link up' : i.shutdown ? 'adapter disabled' : 'no link', cls: raw.cls };
            return (
              <tr key={i.id}>
                <td className="mono">{shortIf(i.name)}</td>
                <td>
                  <button className="linkish" onClick={() => openDevice(peer.id)}>
                    {peer.kind === 'rogue' ? 'Unknown device' : peer.name}
                  </button>{' '}
                  <span className="mono dim">{shortIf(p!.iface)}</span>
                  {i.wallPort || peer.ifaces.find((x) => x.name === p!.iface)?.wallPort ? <span className="dim"> · wall port {i.wallPort ?? peer.ifaces.find((x) => x.name === p!.iface)?.wallPort}</span> : null}
                </td>
                <td>
                  {p!.link.medium} · {p!.link.status === 'ok' ? <span className="tone-good">ok</span> : <span className="tone-crit">{p!.link.status}</span>}
                </td>
                <td>
                  <span className="row" style={{ gap: 4 }}>
                    <span className={`dot ${st.cls}`} />
                    {st.text}
                  </span>
                </td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small" onClick={() => act(d.id, 'reseat-cable', { iface: i.name })} title="Unplug and firmly re-insert the cable (free)">
                    Reseat
                  </button>
                  <button className="btn small" onClick={() => act(d.id, 'replace-cable', { iface: i.name })} title={`Replace the cable (uses a spare ${p!.link.medium === 'fiber' ? 'fiber patch/SFP' : 'patch cable'}; in stock: ${game.s.inventory[p!.link.medium === 'fiber' ? 'fiber' : 'cable'] ?? 0})`}>
                    Replace
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view}
    </div>
  );
}

function Overview({ d }: { d: Device }) {
  const { game, selectEmp, flyTo } = useUi();
  const { act, view } = useAction();
  const e = game.engine;
  const owner = game.ownerOf(d.id);
  const pi = e.primaryIf(d);
  const zone = ROOMS.find((r) => r.id === d.zone)?.name ?? d.zone;
  const vendor = d.ifaces[0] ? vendorOf(d.ifaces[0].mac) : '';
  return (
    <div className="stack">
      {d.kind === 'rogue' && (
        <div className="hint amber">
          <b>Not in the asset inventory.</b> {d.rogue?.description || 'Nobody knows who plugged this in.'} MAC vendor (OUI): <b>{vendor}</b>.
        </div>
      )}
      <dl className="kv">
        <dt>Type</dt>
        <dd>{KIND_LABEL[d.kind]}</dd>
        <dt>Model</dt>
        <dd>{d.model}</dd>
        {d.kind !== 'rogue' && (
          <>
            <dt>Serial</dt>
            <dd className="mono">{d.serial}</dd>
          </>
        )}
        <dt>Location</dt>
        <dd>
          {d.kind === 'rogue' ? 'Found plugged into a wall port' : zone}{' '}
          <button className="linkish" onClick={() => flyTo(d.pos.x, d.pos.y, 2)}>
            show on map
          </button>
        </dd>
        <dt>Status</dt>
        <dd>
          <StatusChip d={d} />
        </dd>
        {pi?.ip && (
          <>
            <dt>IP address</dt>
            <dd className="mono">
              {pi.ip}/{pi.mask ? maskToPrefix(pi.mask) : '?'} {d.host?.dhcp ? <span className="dim">(DHCP)</span> : d.host ? <span className="dim">(static)</span> : null}
            </dd>
          </>
        )}
        {d.ifaces[0] && (
          <>
            <dt>MAC</dt>
            <dd className="mono">
              {isIos(d) ? ciscoMac(d.ifaces[0].mac) : windowsMac(d.ifaces[0].mac)} <span className="dim">· {vendor}</span>
            </dd>
          </>
        )}
        {owner && (
          <>
            <dt>User</dt>
            <dd>
              <button className="linkish" onClick={() => selectEmp(owner.id)}>
                {owner.name}
              </button>{' '}
              <span className="dim">
                {owner.role}, desk {owner.desk}
              </span>
            </dd>
          </>
        )}
        {d.poeW > 0 && (
          <>
            <dt>Power</dt>
            <dd>
              PoE {d.poeW} W {d.ap?.injectorPowered ? '(via injector)' : '(from switch port)'}
            </dd>
          </>
        )}
        {isIos(d) && (
          <>
            <dt>Config</dt>
            <dd>{isUnsaved(d) ? <span className="tone-warn">Unsaved changes (running ≠ startup)</span> : <span className="tone-good">Saved</span>}</dd>
          </>
        )}
        {d.notes && (
          <>
            <dt>Notes</dt>
            <dd className="muted">{d.notes}</dd>
          </>
        )}
      </dl>
      <Connections d={d} />
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Physical actions
        </div>
        <div className="row wrap">
          {d.kind !== 'isp' && (
            <>
              <button className="btn small" onClick={() => act(d.id, 'power-toggle')}>
                <Icon name="power" size={16} /> {d.powered ? 'Power off' : 'Power on'}
              </button>
              <button className="btn small" onClick={() => act(d.id, 'power-cycle')} title={isIos(d) ? 'Reboot: the device is offline for several minutes and unsaved changes are lost.' : 'Restart the device'}>
                <Icon name="refresh" size={16} /> Power-cycle
              </button>
            </>
          )}
          {d.powerFault && (
            <button className="btn small" onClick={() => act(d.id, 'replace-psu')}>
              Replace PSU ({game.s.inventory.psu ?? 0} spare)
            </button>
          )}
          {(d.kind === 'rogue' || d.id === 'signage-lobby') && (
            <button className="btn small danger" onClick={() => act(d.id, 'remove-device')}>
              <Icon name="close" size={16} /> Remove device
            </button>
          )}
        </div>
        {view}
      </div>
    </div>
  );
}

function PortsTab({ d }: { d: Device }) {
  const { game, openDevice } = useUi();
  const { act, view } = useAction();
  const [sel, setSel] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const e = game.engine;
  const ports = d.ifaces;
  const selIf = ports.find((i) => i.name === sel);
  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 14 }}>
        Click a port for physical actions. Configure ports in the <b>CLI</b> tab (e.g. <span className="mono">interface {shortIf(ports[0].name)}</span>).
      </div>
      <div style={{ maxHeight: 330, overflow: 'auto' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Port</th>
              <th>Status</th>
              <th>VLAN</th>
              <th>Speed</th>
              <th>PoE</th>
              <th>Connected to</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((i) => {
              const o = e.oper(i);
              const st = ifStatus(game, i);
              const peer = o.peer && o.peer.iface !== 'radio' ? game.dev(o.peer.dev) : e.peerOf(d.id, i.name) ? game.dev(e.peerOf(d.id, i.name)!.dev) : null;
              const vlan = i.type === 'svi' ? 'SVI' : !i.switchport ? (i.ip ? `routed ${i.ip}` : 'routed') : i.mode === 'trunk' ? `trunk (n${i.nativeVlan})` : String(i.accessVlan);
              return (
                <tr key={i.id} className={`clickable ${sel === i.name ? 'sel' : ''}`} onClick={() => setSel(sel === i.name ? null : i.name)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && setSel(i.name)}>
                  <td className="mono">{shortIf(i.name)}</td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      <span className={`dot ${st.cls}`} />
                      {st.text}
                    </span>
                  </td>
                  <td className="mono">{vlan}</td>
                  <td className="mono">{o.up ? `${o.speedMbps >= 1000 ? '1G' : o.speedMbps + 'M'}/${o.duplex[0]}` : '—'}</td>
                  <td className="mono">{i.poe ? (o.poeStatus === 'on' ? `${o.poeW}W` : o.poeStatus === 'denied' ? 'denied' : i.poe === 'never' ? 'never' : '—') : ''}</td>
                  <td>{peer ? (peer.kind === 'rogue' ? <span className="tone-warn">Unknown device</span> : peer.name) : ''}</td>
                  <td className="dim">{i.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selIf && selIf.type !== 'svi' && (
        <div className="card">
          <div className="row">
            <b className="mono">{selIf.name}</b>
            <span className="grow" />
            {e.peerOf(d.id, selIf.name) && (
              <button className="btn small" onClick={() => openDevice(e.peerOf(d.id, selIf.name)!.dev)}>
                Open far end
              </button>
            )}
          </div>
          <div className="muted" style={{ fontSize: 14, margin: '4px 0 8px' }}>
            {e.oper(selIf).reason || 'Link is healthy.'} {selIf.hwFault !== 'none' && <b className="tone-crit">Hardware fault reported on this port.</b>} Counters: {selIf.counters.crc} CRC, {selIf.counters.lateCollisions} late collisions.
          </div>
          <div className="row wrap">
            <button className="btn small" onClick={() => act(d.id, 'reseat-cable', { iface: selIf.name })}>
              Reseat cable
            </button>
            <button className="btn small" onClick={() => act(d.id, 'replace-cable', { iface: selIf.name })}>
              Replace cable
            </button>
            {selIf.type === 'sfp' && (
              <button className="btn small" onClick={() => act(d.id, 'replace-optic', { iface: selIf.name })}>
                Replace optic/fiber ({game.s.inventory.fiber ?? 0} spare)
              </button>
            )}
            {e.peerOf(d.id, selIf.name) && (
              <span className="row" style={{ gap: 4 }}>
                <label className="sr-only" htmlFor={`mv-${selIf.id}`}>
                  Move cable to port
                </label>
                <select id={`mv-${selIf.id}`} value={moveTo} onChange={(ev) => setMoveTo(ev.target.value)}>
                  <option value="">Move cable to…</option>
                  {ports
                    .filter((p) => p.type === selIf.type && !e.peerOf(d.id, p.name))
                    .map((p) => (
                      <option key={p.id} value={p.name}>
                        {shortIf(p.name)}
                      </option>
                    ))}
                </select>
                <button className="btn small" disabled={!moveTo} onClick={() => act(d.id, 'move-cable', { from: selIf.name, to: moveTo })}>
                  Move
                </button>
              </span>
            )}
          </div>
          {view}
        </div>
      )}
    </div>
  );
}

function ConfigTab({ d }: { d: Device }) {
  const { act, view } = useAction();
  return (
    <div className="stack">
      <div className="row">
        {isUnsaved(d) ? <span className="tone-warn">⚠ Running-config has unsaved changes.</span> : <span className="tone-good">Running-config matches startup-config.</span>}
        <span className="grow" />
        <button className="btn small" onClick={() => act(d.id, 'save-config')} disabled={!isUnsaved(d)} title="Same as 'copy running-config startup-config' in the CLI">
          <Icon name="save" size={16} /> Save to startup
        </button>
      </div>
      {view}
      <pre className="pre" style={{ maxHeight: 420 }}>
        {renderRunningConfig(d).join('\n')}
      </pre>
    </div>
  );
}

function LogsTab({ d }: { d: Device }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLPreElement>(null);
  const logs = d.logs.filter((l) => !q || l.msg.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return (
    <div className="stack">
      <input type="search" placeholder="Filter logs (e.g. LINK, DHCP, error)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter logs" />
      <pre className="pre" ref={ref} style={{ maxHeight: 400, whiteSpace: 'pre-wrap' }}>
        {logs.length ? logs.map((l) => (isIos(d) ? l.msg : `${fmtClock(l.t, true)} ${l.msg}`)).join('\n') : 'No log messages.'}
      </pre>
    </div>
  );
}

function NetworkTab({ d }: { d: Device }) {
  const { game } = useUi();
  const { act, view } = useAction();
  const h = d.host!;
  const i = d.ifaces[0];
  const [mode, setMode] = useState<'dhcp' | 'static'>(h.dhcp ? 'dhcp' : 'static');
  const [ip, setIp] = useState(h.staticIp || i.ip || '');
  const [mask, setMask] = useState(h.staticMask || '255.255.255.0');
  const [gw, setGw] = useState(h.staticGateway || h.gateway || '');
  const [dns1, setDns1] = useState(h.staticDns[0] ?? h.dns[0] ?? '');
  const [dns2, setDns2] = useState(h.staticDns[1] ?? h.dns[1] ?? '');
  const up = game.engine.oper(i).up;
  const apply = () => {
    if (mode === 'dhcp') act(d.id, 'pc-dhcp');
    else act(d.id, 'pc-static', { ip, mask, gateway: gw, dns: [dns1, dns2].filter(Boolean) });
  };
  return (
    <div className="stack">
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Current status ({i.type === 'wlan' ? 'Wi-Fi' : 'Ethernet'})
        </div>
        <dl className="kv">
          <dt>Media</dt>
          <dd>{i.shutdown ? 'Adapter disabled' : up ? 'Connected' : 'Disconnected'}</dd>
          <dt>IPv4</dt>
          <dd className="mono">
            {i.ip ? `${i.ip} / ${i.mask}` : '—'} {i.ip?.startsWith('169.254') && <span className="tone-warn">(APIPA — DHCP failed)</span>} {h.ipConflict && <span className="tone-crit">(IP conflict!)</span>}
          </dd>
          <dt>Gateway</dt>
          <dd className="mono">{h.gateway ?? '—'}</dd>
          <dt>DNS</dt>
          <dd className="mono">{h.dns.join(', ') || '—'}</dd>
          <dt>DHCP</dt>
          <dd>{h.dhcp ? `Enabled${h.dhcpServer ? ` · server ${h.dhcpServer}` : ''}${h.leaseExpires ? ` · lease until ${fmtClock(h.leaseExpires)}` : ''}` : 'Disabled (static)'}</dd>
        </dl>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn small" disabled={!h.dhcp} onClick={() => act(d.id, 'pc-renew')}>
            Renew lease
          </button>
          <button className="btn small" disabled={!h.dhcp} onClick={() => act(d.id, 'pc-release')}>
            Release
          </button>
          <button className="btn small" onClick={() => act(d.id, 'pc-adapter', { enabled: i.shutdown })}>
            {i.shutdown ? 'Enable adapter' : 'Disable adapter'}
          </button>
        </div>
      </div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Internet Protocol Version 4 (TCP/IPv4) Properties
        </div>
        <div className="stack">
          <label className="row">
            <input type="radio" name={`m-${d.id}`} checked={mode === 'dhcp'} onChange={() => setMode('dhcp')} /> Obtain an IP address automatically (DHCP)
          </label>
          <label className="row">
            <input type="radio" name={`m-${d.id}`} checked={mode === 'static'} onChange={() => setMode('static')} /> Use the following IP address
          </label>
          <label className="field">
            IP address
            <input type="text" className="mono" value={ip} disabled={mode === 'dhcp'} onChange={(e) => setIp(e.target.value)} />
          </label>
          <label className="field">
            Subnet mask
            <input type="text" className="mono" value={mask} disabled={mode === 'dhcp'} onChange={(e) => setMask(e.target.value)} />
          </label>
          <label className="field">
            Default gateway
            <input type="text" className="mono" value={gw} disabled={mode === 'dhcp'} onChange={(e) => setGw(e.target.value)} />
          </label>
          <label className="field">
            Preferred DNS
            <input type="text" className="mono" value={dns1} disabled={mode === 'dhcp'} onChange={(e) => setDns1(e.target.value)} />
          </label>
          <label className="field">
            Alternate DNS
            <input type="text" className="mono" value={dns2} disabled={mode === 'dhcp'} onChange={(e) => setDns2(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary small" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
        {view}
      </div>
    </div>
  );
}

function SecurityTab({ d }: { d: Device }) {
  const { game } = useUi();
  const { act, view } = useAction();
  const pc = d.pc!;
  const edr = game.hasUpgrade('edr');
  return (
    <div className="stack">
      <div className="card">
        <dl className="kv">
          <dt>EDR agent</dt>
          <dd>{edr ? 'Installed' : <span className="muted">Not licensed (Shop → Security)</span>}</dd>
          <dt>Isolation</dt>
          <dd>{pc.edrIsolated ? <span className="tone-warn">Network-isolated by EDR</span> : 'Not isolated'}</dd>
          <dt>Scan</dt>
          <dd>{pc.scanUntil ? `Running — done at ${fmtClock(pc.scanUntil)}` : 'Idle'}</dd>
          <dt>Re-image</dt>
          <dd>{pc.reimageUntil ? `In progress — done at ${fmtClock(pc.reimageUntil)}` : 'Not running'}</dd>
        </dl>
        <p className="muted" style={{ fontSize: 14 }}>
          Without EDR you can't see inside the machine remotely — use the Terminal (<span className="mono">netstat -ano</span>, <span className="mono">tasklist</span>) and network evidence.
        </p>
        <div className="row wrap">
          <button className="btn small" disabled={!edr} onClick={() => act(d.id, 'edr-scan')}>
            EDR full scan
          </button>
          <button className="btn small" disabled={!edr} onClick={() => act(d.id, pc.edrIsolated ? 'edr-release' : 'edr-isolate')}>
            {pc.edrIsolated ? 'Release isolation' : 'Isolate host (EDR)'}
          </button>
          <ConfirmButton className="btn small" title={`The user loses the machine for ${edr ? 25 : 45} minutes; it comes back as a clean DHCP build.`} confirmLabel={`Confirm re-image (${edr ? 25 : 45} min offline)`} onConfirm={() => act(d.id, 'reimage')}>
            Re-image PC
          </ConfirmButton>
        </div>
        {view}
      </div>
    </div>
  );
}

function ServicesTab({ d }: { d: Device }) {
  const { act, view } = useAction();
  const srv = d.server!;
  return (
    <div className="stack">
      <dl className="kv">
        <dt>OS</dt>
        <dd>{srv.os}</dd>
        <dt>Disk /</dt>
        <dd>
          <div className="row">
            <XpBar className="w-[200px]" bare value={srv.diskUsedPct} fill={srv.diskUsedPct > 90 ? 'var(--crit)' : srv.diskUsedPct > 75 ? 'var(--warn)' : 'var(--good)'} aria-label="Disk usage" />
            <span className={srv.diskUsedPct > 90 ? 'tone-crit' : ''}>{Math.round(srv.diskUsedPct)}% used</span>
            <button className="btn small" onClick={() => act(d.id, 'free-disk')}>
              Clean up old logs
            </button>
          </div>
        </dd>
        <dt>CPU</dt>
        <dd>{Math.round(srv.cpuPct)}%</dd>
        {srv.backupWindow && (
          <>
            <dt>Backup window</dt>
            <dd>
              {String(srv.backupWindow.startHour).padStart(2, '0')}:00–{String(srv.backupWindow.endHour).padStart(2, '0')}:00
            </dd>
          </>
        )}
      </dl>
      <table className="grid">
        <thead>
          <tr>
            <th>Service</th>
            <th>Status</th>
            <th>Listens on</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {srv.services.map((s) => (
            <tr key={s.id}>
              <td>
                <b className="mono">{s.name}</b>
                <div className="dim" style={{ fontSize: 12.5 }}>
                  {s.label}
                </div>
              </td>
              <td>
                <span className="row" style={{ gap: 4 }}>
                  <span className={`dot ${s.running ? 'up' : s.failed ? 'bad' : 'down'}`} />
                  {s.running ? 'running' : s.failed ? `failed (${s.failed})` : 'stopped'}
                </span>
              </td>
              <td className="mono">
                {s.proto}/{s.ports.join(',')}
              </td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn small" onClick={() => act(d.id, 'restart-service', { svc: s.name })}>
                  Restart
                </button>
                <button className="btn small" disabled={!s.running} onClick={() => act(d.id, 'stop-service', { svc: s.name })}>
                  Stop
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {view}
    </div>
  );
}

function DnsTab({ d }: { d: Device }) {
  const { act, view } = useAction();
  const z = d.server!.dnsZone!;
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [nn, setNn] = useState('');
  const [nt, setNt] = useState<'A' | 'CNAME'>('A');
  const [nv, setNv] = useState('');
  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 14 }}>
        Zone <b>corp.local</b> (BIND9). Forwarders: {d.server!.dnsForwarders.join(', ')}. Changes reload the zone immediately.
      </div>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {z.map((r) => (
              <tr key={r.name}>
                <td className="mono">{r.name}</td>
                <td className="mono">{r.type}</td>
                <td>
                  <input type="text" className="mono" style={{ width: 150, padding: '2px 5px' }} value={edit[r.name] ?? r.value} onChange={(e) => setEdit({ ...edit, [r.name]: e.target.value })} aria-label={`Value for ${r.name}`} />
                </td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small" disabled={edit[r.name] === undefined || edit[r.name] === r.value} onClick={() => act(d.id, 'dns-set', { name: r.name, type: r.type, value: edit[r.name] })}>
                    Save
                  </button>
                  <button className="btn small ghost" onClick={() => act(d.id, 'dns-delete', { name: r.name })} aria-label={`Delete ${r.name}`}>
                    <Icon name="close" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        <input type="text" className="mono" placeholder="name.corp.local" value={nn} onChange={(e) => setNn(e.target.value)} aria-label="New record name" />
        <select value={nt} onChange={(e) => setNt(e.target.value as 'A' | 'CNAME')} aria-label="Record type">
          <option>A</option>
          <option>CNAME</option>
        </select>
        <input type="text" className="mono" placeholder={nt === 'A' ? '10.10.100.x' : 'target.corp.local'} value={nv} onChange={(e) => setNv(e.target.value)} aria-label="New record value" />
        <button className="btn small" onClick={() => act(d.id, 'dns-set', { name: nn, type: nt, value: nv })}>
          Add record
        </button>
      </div>
      {view}
    </div>
  );
}

function WirelessTab({ d }: { d: Device }) {
  const { game, openDevice } = useUi();
  const { act, view } = useAction();
  const ap = d.ap!;
  const e = game.engine;
  const clients = e.c.apClients.get(d.id) ?? [];
  const intf = clients.length ? (e.c.wlan.get(clients[0])?.interference ?? 0) : null;
  const neighbours = Object.values(game.s.net.devices).filter((x) => x.kind === 'ap' && x.id !== d.id && Math.hypot(x.pos.x - d.pos.x, x.pos.y - d.pos.y) < ap.rangePx * 1.7);
  return (
    <div className="stack">
      <dl className="kv">
        <dt>SSID</dt>
        <dd>{ap.ssid} (WPA2-Enterprise) → VLAN 70</dd>
        <dt>Radio</dt>
        <dd>
          <label className="row">
            <input type="checkbox" checked={ap.radioOn} onChange={(ev) => act(d.id, 'ap-set', { radioOn: ev.target.checked })} /> 2.4 GHz radio enabled
          </label>
        </dd>
        <dt>Channel</dt>
        <dd>
          <select value={ap.channel} onChange={(ev) => act(d.id, 'ap-set', { channel: Number(ev.target.value) })} aria-label="Channel">
            {Array.from({ length: 11 }, (_, k) => k + 1).map((c) => (
              <option key={c} value={c}>
                {c}
                {[1, 6, 11].includes(c) ? ' (non-overlapping)' : ''}
              </option>
            ))}
          </select>
        </dd>
        <dt>Tx power</dt>
        <dd>
          <select value={ap.txPower} onChange={(ev) => act(d.id, 'ap-set', { txPower: ev.target.value })} aria-label="Transmit power">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </dd>
        <dt>Channel interference</dt>
        <dd>{intf === null ? <span className="muted">no clients to measure</span> : <span className={intf > 0.3 ? 'tone-crit' : intf > 0.15 ? 'tone-warn' : 'tone-good'}>{Math.round(intf * 100)}%</span>}</dd>
        <dt>Nearby APs</dt>
        <dd>
          {neighbours.map((n) => (
            <span key={n.id} style={{ marginRight: 8 }}>
              <button className="linkish" onClick={() => openDevice(n.id)}>
                {n.name}
              </button>{' '}
              ch {n.ap!.channel}
            </span>
          ))}
          {game.s.net.wireless.foreign.map((f) => (
            <span key={f.id} className="tone-warn" style={{ marginRight: 8 }}>
              {f.ssid} (foreign) ch {f.channel}
            </span>
          ))}
        </dd>
      </dl>
      <table className="grid">
        <thead>
          <tr>
            <th>Client</th>
            <th>User</th>
            <th>Signal</th>
            <th>Quality</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((cid) => {
            const c = game.dev(cid);
            const w = e.c.wlan.get(cid)!;
            return (
              <tr key={cid} className="clickable" onClick={() => openDevice(cid)}>
                <td>{c.name}</td>
                <td>{game.ownerOf(cid)?.name}</td>
                <td>{Math.round(Math.min(99, 25 + w.signal * 110))}%</td>
                <td className={w.quality < 0.6 ? 'tone-crit' : ''}>{Math.round(w.quality * 100)}%</td>
                <td className="mono">{c.ifaces[0].ip ?? '—'}</td>
              </tr>
            );
          })}
          {!clients.length && (
            <tr>
              <td colSpan={5} className="muted">
                No clients associated.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {view}
    </div>
  );
}

function PrinterTab({ d }: { d: Device }) {
  const { act, view } = useAction();
  const h = d.host!;
  const [ip, setIp] = useState(h.staticIp || h.ip || '');
  const [mask, setMask] = useState(h.staticMask || '255.255.255.0');
  const [gw, setGw] = useState(h.staticGateway || h.gateway || '');
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Status</dt>
        <dd>{d.printer?.status}</dd>
        <dt>Pages today</dt>
        <dd>{d.printer?.pagesToday}</dd>
        <dt>Protocols</dt>
        <dd>RAW/9100, IPP/631, HTTPS</dd>
      </dl>
      <div className="card stack">
        <div className="section-title" style={{ marginTop: 0 }}>
          Embedded web server · Network
        </div>
        <label className="field">
          IPv4 address
          <input type="text" className="mono" value={ip} onChange={(e) => setIp(e.target.value)} />
        </label>
        <label className="field">
          Subnet mask
          <input type="text" className="mono" value={mask} onChange={(e) => setMask(e.target.value)} />
        </label>
        <label className="field">
          Gateway
          <input type="text" className="mono" value={gw} onChange={(e) => setGw(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn small primary" onClick={() => act(d.id, 'printer-set', { ip, mask, gateway: gw })}>
            Apply
          </button>
          <button className="btn small" onClick={() => act(d.id, 'printer-clear')}>
            Clear queue
          </button>
        </div>
      </div>
      {view}
    </div>
  );
}

function IspTab({ d }: { d: Device }) {
  const { game } = useUi();
  const { act, view } = useAction();
  const net = game.s.net;
  const u = game.engine.wanUtil();
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Circuit</dt>
        <dd>
          {net.ispMbps} Mb/s fiber · ID {d.serial}
        </dd>
        <dt>Provider status</dt>
        <dd>{net.ispOutage ? <span className="tone-crit">Not passing traffic upstream{net.lteBackup ? ' (LTE backup active)' : ''}</span> : <span className="tone-good">Normal</span>}</dd>
        <dt>Utilisation</dt>
        <dd className={u > 0.85 ? 'tone-crit' : ''}>{Math.round(u * 100)}% (from the firewall's counters)</dd>
        <dt>Ticket</dt>
        <dd>{net.ispTicketOpen ? 'Open (#CX-48817)' : 'None'}</dd>
        <dt>Upstream filtering</dt>
        <dd>{net.ispUpstreamFilter ? 'Active' : 'Off'}</dd>
      </dl>
      <p className="muted" style={{ fontSize: 14 }}>
        This box is managed by the ISP — you can't log in. You can open tickets and request services.
      </p>
      <div className="row wrap">
        <button className="btn small" onClick={() => act(d.id, 'isp-ticket')}>
          Open ticket with ISP
        </button>
        <button className="btn small" onClick={() => act(d.id, 'isp-filter')} title={`Emergency DDoS filtering upstream — ${money(500)}`}>
          Request upstream filtering ({money(500)})
        </button>
      </div>
      {view}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DeviceWindow({ w }: { w: DevWindow }) {
  const { game, ui, setUi, closeWindow, focusWindow } = useUi();
  useGameTick(game);
  const d = game.dev(w.devId);
  const drag = useRef<{ x: number; y: number; wx: number; wy: number } | null>(null);
  useEffect(() => {
    game.markViewed(w.devId);
  }, [game, w.devId]);
  if (!d) {
    return (
      <div className="window" style={{ left: w.x, top: w.y, width: 360, height: 160, zIndex: 30 + w.z }}>
        <div className="win-title">
          <h3>Device removed</h3>
          <span className="grow" />
          <button className="btn small ghost" onClick={() => closeWindow(w.id)} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="win-body muted">This device is no longer on the network.</div>
      </div>
    );
  }
  const tabs = tabsFor(d);
  const tab = tabs.some((t) => t.id === w.tab) ? w.tab : 'overview';
  const setTab = (t: string) => {
    setUi((u) => ({ ...u, windows: u.windows.map((x) => (x.id === w.id ? { ...x, tab: t } : x)) }));
    if (t === 'cli') game.flag('opened-cli');
  };
  const shell = tab === 'cli' ? game.getShell(d.id) : null;
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, wx: w.x, wy: w.y };
    focusWindow(w.id);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 120, g.wx + e.clientX - g.x));
    const ny = Math.max(0, Math.min(window.innerHeight - 100, g.wy + e.clientY - g.y));
    setUi((u) => ({ ...u, windows: u.windows.map((x) => (x.id === w.id ? { ...x, x: nx, y: ny } : x)) }));
  };
  const focused = ui.focusedWin === w.id;
  return (
    <section
      className={`window ${focused ? 'focused' : ''}`}
      style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 30 + w.z }}
      onPointerDownCapture={() => !focused && focusWindow(w.id)}
      role="dialog"
      aria-label={`${d.name} inspector`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeWindow(w.id);
        }
      }}
    >
      <div className="win-title" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
        <Icon name={KIND_ICON[d.kind] ?? 'info'} size={20} style={{ color: d.kind === 'rogue' ? '#ffd166' : '#ffffff' }} />
        <h3>{d.kind === 'rogue' ? 'Unknown device' : d.name}</h3>
        <span className="dim" style={{ fontSize: 14 }}>
          {KIND_LABEL[d.kind]}
        </span>
        <span className="grow" />
        <span className="status-pill">
          <StatusChip d={d} />
        </span>
        <button className="btn small ghost" onClick={() => closeWindow(w.id)} aria-label="Close window">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={`win-body ${tab === 'cli' ? 'flush' : ''}`}>
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'ports' && <PortsTab d={d} />}
        {tab === 'cli' && shell && <Terminal shell={shell} />}
        {tab === 'config' && <ConfigTab d={d} />}
        {tab === 'logs' && <LogsTab d={d} />}
        {tab === 'network' && <NetworkTab d={d} />}
        {tab === 'security' && <SecurityTab d={d} />}
        {tab === 'services' && <ServicesTab d={d} />}
        {tab === 'dns' && <DnsTab d={d} />}
        {tab === 'wireless' && <WirelessTab d={d} />}
        {tab === 'printer' && <PrinterTab d={d} />}
        {tab === 'isp' && <IspTab d={d} />}
      </div>
    </section>
  );
}
