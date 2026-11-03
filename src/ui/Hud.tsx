import { useEffect, useState } from 'react';
import { Button as MapButton } from '@/components/ui/button-1';
import { fmtClock } from '../core/time';
import type { Toast } from '../sim/game';
import { NOC_VIEW } from '../world/layout';
import { type DrawerId, useGameTick, useUi } from './ctx';
import { Icon } from './icons';
import { fitCenter, fitZoom } from './OfficeView';

export function Dock() {
  const { game, ui, setDrawer } = useUi();
  useGameTick(game);
  const s = game.s;
  const unreadMail = s.inbox.filter((m) => !m.read && !m.archived && m.kind !== 'noise').length;
  const openTasks = game.openIncidents().length + s.tasks.filter((t) => !t.done && !t.failed && t.kind !== 'note').length;
  const unreadMgr = s.manager.filter((m) => !m.read).length;
  const items: { id: DrawerId; label: string; icon: string; key: string; badge?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: 'mail', key: 'I', badge: unreadMail },
    { id: 'tasks', label: 'Tasks', icon: 'tasks', key: 'T', badge: openTasks },
    { id: 'shop', label: 'Shop', icon: 'cart', key: 'B' },
    { id: 'manager', label: 'Manager', icon: 'briefcase', key: 'M', badge: unreadMgr },
    { id: 'manual', label: 'Manual', icon: 'book', key: 'H' },
    { id: 'network', label: 'Network', icon: 'network', key: 'N' },
    { id: 'feed', label: 'Event log', icon: 'list', key: 'L' },
  ];
  return (
    <nav className="dock" aria-label="Main panels">
      {items.map((it) => (
        <button key={it.id} className={`dock-btn ${ui.drawer === it.id ? 'active' : ''}`} onClick={() => setDrawer(ui.drawer === it.id ? null : it.id)} aria-pressed={ui.drawer === it.id} title={`${it.label} (${it.key})`}>
          <Icon name={it.icon} size={26} />
          <span className="lbl">{it.label}</span>
          <kbd>{it.key}</kbd>
          {it.badge ? (
            <span className="badge" aria-label={`${it.badge} new`}>
              {it.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function MapControls() {
  const { game, ui, setUi, cameraRef, flyTo } = useUi();
  useGameTick(game);
  const zoom = (f: number) => {
    cameraRef.current.zoom = Math.max(0.5, Math.min(4, cameraRef.current.zoom * f));
    game.flag('zoomed');
  };
  return (
    <div className="mapctl" role="toolbar" aria-label="Map controls">
      <span title="Zoom in (+)">
        <MapButton aria-label="Zoom in" shape="square" size="medium" svgOnly type="secondary" onClick={() => zoom(1.25)}>
          <Icon name="zoomIn" size={20} />
        </MapButton>
      </span>
      <span title="Zoom out (−)">
        <MapButton aria-label="Zoom out" shape="square" size="medium" svgOnly type="secondary" onClick={() => zoom(0.8)}>
          <Icon name="zoomOut" size={20} />
        </MapButton>
      </span>
      <span title="Fit office (0)">
        <MapButton
          type="secondary"
          prefix={<Icon name="target" size={18} />}
          onClick={() => {
            const z = fitZoom(window.innerWidth, window.innerHeight - 60);
            const c = fitCenter(z);
            flyTo(c.x, c.y, z);
          }}
        >
          Fit
        </MapButton>
      </span>
      <span title="Jump to the NOC and server room">
        <MapButton type="secondary" prefix={<Icon name="server" size={18} />} onClick={() => flyTo(NOC_VIEW.x, NOC_VIEW.y, 1.8)}>
          NOC
        </MapButton>
      </span>
      <span title="Cable view (C): Auto shows uplinks + the selected device's cables">
        <MapButton type="secondary" prefix={<Icon name="cable" size={18} />} onClick={() => setUi((u) => ({ ...u, cables: u.cables === 'auto' ? 'all' : u.cables === 'all' ? 'off' : 'auto' }))}>
          Cables: {ui.cables === 'auto' ? 'Auto' : ui.cables === 'all' ? 'All' : 'Off'}
        </MapButton>
      </span>
      <span title="Wi-Fi coverage and channels">
        <MapButton type={ui.overlay === 'wifi' ? 'primary' : 'secondary'} aria-pressed={ui.overlay === 'wifi'} prefix={<Icon name="wifi" size={18} />} onClick={() => setUi((u) => ({ ...u, overlay: u.overlay === 'wifi' ? 'none' : 'wifi' }))}>
          Wi-Fi
        </MapButton>
      </span>
      <span title={game.hasUpgrade('nms') ? 'Device health & uplink utilisation (NMS)' : 'Requires the Network monitoring suite (Shop)'}>
        <MapButton type={ui.overlay === 'health' ? 'primary' : 'secondary'} disabled={!game.hasUpgrade('nms')} aria-pressed={ui.overlay === 'health'} prefix={<Icon name="layers" size={18} />} onClick={() => setUi((u) => ({ ...u, overlay: u.overlay === 'health' ? 'none' : 'health' }))}>
          Health
        </MapButton>
      </span>
    </div>
  );
}

export function Toasts() {
  const { game, setUi, setDrawer } = useUi();
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    return game.onEvent((e) => {
      if (e.type !== 'toast' || game.skipping) return;
      setList((l) => [...l.slice(-4), e.toast]);
      const id = e.toast.id;
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), e.toast.kind === 'security' || e.toast.kind === 'incident' ? 9000 : 6000);
    });
  }, [game]);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <button
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={() => {
            setList((l) => l.filter((x) => x.id !== t.id));
            if (t.kind === 'email') setDrawer('inbox');
            else if (t.kind === 'manager') setDrawer('manager');
            else if (t.incidentId) setUi((u) => ({ ...u, expandedIncident: t.incidentId! }));
          }}
        >
          <Icon name={t.kind === 'security' ? 'shield' : t.kind === 'email' ? 'mail' : t.kind === 'manager' ? 'briefcase' : t.kind === 'good' ? 'check' : 'warning'} size={18} />
          <span>
            <b>{t.title}</b>
            {t.body && <div className="muted" style={{ fontSize: 14 }}>{t.body}</div>}
          </span>
          <span className="dim mono" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
            {fmtClock(t.t)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function EmployeeCard() {
  const { game, ui, selectEmp, openDevice, select } = useUi();
  useGameTick(game);
  if (!ui.selectedEmp) return null;
  const { r, e } = game.employeeAt(ui.selectedEmp);
  const dev = game.deviceOf(r.id);
  const mood = e.frustration > 60 ? 'Frustrated' : e.frustration > 30 ? 'Annoyed' : 'Content';
  return (
    <aside className="popover" style={{ left: 106, bottom: 70 }} aria-label={`${r.name} details`}>
      <div className="row">
        <Icon name="user" style={{ color: 'var(--accent-2)' }} />
        <b className="grow">{r.name}</b>
        <button className="btn small ghost" onClick={() => selectEmp(null)} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>
        {r.role} · {r.dept} · desk {r.desk}
      </div>
      <dl className="kv" style={{ marginTop: 8, fontSize: 14.5 }}>
        <dt>Doing</dt>
        <dd>{e.present ? e.activity : 'Not in the office'}</dd>
        <dt>Mood</dt>
        <dd className={e.frustration > 60 ? 'tone-crit' : e.frustration > 30 ? 'tone-warn' : 'tone-good'}>
          {mood} ({Math.round(e.frustration)}/100 frustration)
        </dd>
        <dt>Connectivity</dt>
        <dd>{e.present ? (e.failing.length ? <span className="tone-warn">Trouble with: {e.failing.join(', ')}</span> : <span className="tone-good">Everything works</span>) : '—'}</dd>
        <dt>Schedule</dt>
        <dd>
          In ~{fmtClock(e.arrive)}, out ~{fmtClock(e.leave)}
        </dd>
      </dl>
      {dev && (
        <button
          className="btn small"
          style={{ marginTop: 8 }}
          onClick={() => {
            select(dev.id);
            openDevice(dev.id);
          }}
        >
          <Icon name="terminal" size={16} /> Open {dev.name}
        </button>
      )}
    </aside>
  );
}

export function ShortcutsModal() {
  const { ui, setUi } = useUi();
  if (!ui.showShortcuts) return null;
  const rows: [string, string][] = [
    ['Space', 'Pause / resume'],
    ['1 – 5', 'Speed 1× … 16×'],
    ['W A S D / arrows', 'Pan the map'],
    ['+ / −', 'Zoom'],
    ['0', 'Fit the office'],
    ['C', 'Cycle cable view'],
    ['I T B M H N L', 'Inbox, Tasks, Shop, Manager, Manual, Network, Event log'],
    ['Esc', 'Close the window / panel / selection'],
    ['?', 'This help'],
    ['In terminals', '↑/↓ history, Tab completion, ? (IOS) context help, Ctrl+L clear'],
  ];
  return (
    <div className="modal-bg" onClick={() => setUi((u) => ({ ...u, showShortcuts: false }))}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="grid">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="grow" />
          <button className="btn primary" onClick={() => setUi((u) => ({ ...u, showShortcuts: false }))} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function DayModal() {
  const { game, ui, setUi } = useUi();
  useGameTick(game);
  const s = game.s;
  if (s.gameOver && ui.daySummary !== -2) {
    return (
      <div className="modal-bg">
        <div className="modal" role="alertdialog" aria-label="Game over">
          <h2>You've been let go</h2>
          <p className="muted">Dana lost confidence after too many outages. Final score: {s.score.toLocaleString()} · {s.stats.resolved} incidents resolved.</p>
          <div className="row">
            <button className="btn" onClick={() => setUi((u) => ({ ...u, daySummary: -2 }))}>
              Keep playing (sandbox)
            </button>
            <span className="grow" />
            <button className="btn primary" onClick={() => setUi((u) => ({ ...u, drawer: 'settings', daySummary: -2 }))}>
              New game…
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (ui.daySummary === null || ui.daySummary < 0) return null;
  const d = s.days.find((x) => x.day === ui.daySummary);
  if (!d) return null;
  const close = () => setUi((u) => ({ ...u, daySummary: null }));
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" role="dialog" aria-label={`Day ${d.day + 1} summary`} onClick={(e) => e.stopPropagation()}>
        <h2>Day {d.day + 1} complete</h2>
        <dl className="kv" style={{ fontSize: 16 }}>
          <dt>Average productivity</dt>
          <dd>{d.avgProductivity}%</dd>
          <dt>Incidents resolved</dt>
          <dd>{d.incidentsResolved}</dd>
          <dt>SLA breaches</dt>
          <dd>{d.slaBreaches}</dd>
          <dt>Still open</dt>
          <dd>{d.incidentsOpen}</dd>
          <dt>Budget allowance</dt>
          <dd>+${d.allowance.toLocaleString()}</dd>
          <dt>Score</dt>
          <dd>{d.score.toLocaleString()}</dd>
        </dl>
        <p className="muted" style={{ fontSize: 15 }}>
          Tip: evenings are a good time to save configs, finish requests in Tasks and spend budget in the Shop. Security incidents can still happen overnight.
        </p>
        <div className="row">
          <button className="btn" onClick={close}>
            Keep watching
          </button>
          <span className="grow" />
          <button
            className="btn primary"
            onClick={() => {
              close();
              game.skipToMorning();
            }}
          >
            <Icon name="skip" size={16} /> Skip to tomorrow morning
          </button>
        </div>
      </div>
    </div>
  );
}
