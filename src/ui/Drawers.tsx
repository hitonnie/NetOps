import { useState } from 'react';
import { dayIndex, fmtClock, fmtDay } from '../core/time';
import { SHOP } from '../content/shop';
import { Game, rankFor, SEV_LABEL } from '../sim/game';
import type { Email } from '../sim/types';
import { type DrawerId, useGameTick, useUi } from './ctx';
import { ConfirmButton } from './ConfirmButton';
import { Icon } from './icons';
import { ManualPanel } from './ManualPanel';
import { NetworkPanel } from './NetworkPanel';

export function Drawer() {
  const { ui, setDrawer, game } = useUi();
  useGameTick(game);
  if (!ui.drawer) return null;
  const titles: Record<DrawerId, string> = { inbox: 'Inbox', tasks: 'Tasks & checklist', shop: 'IT Shop', manager: "Manager's office", manual: 'Manual & runbook', network: 'Network', feed: 'Event log', settings: 'Settings & game' };
  const wide = ui.drawer === 'manual' || ui.drawer === 'network' || ui.drawer === 'inbox';
  return (
    <aside
      className={`drawer ${wide ? 'wide' : ''}`}
      aria-label={titles[ui.drawer]}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDrawer(null);
        }
      }}
    >
      <div className="drawer-head">
        <h2>{titles[ui.drawer]}</h2>
        <span className="grow" />
        <button className="btn small ghost" onClick={() => setDrawer(null)} aria-label="Close panel">
          <Icon name="close" size={18} />
        </button>
      </div>
      {ui.drawer === 'inbox' && <Inbox />}
      {ui.drawer === 'tasks' && <Tasks />}
      {ui.drawer === 'shop' && <Shop />}
      {ui.drawer === 'manager' && <Manager />}
      {ui.drawer === 'manual' && <ManualPanel />}
      {ui.drawer === 'network' && <NetworkPanel />}
      {ui.drawer === 'feed' && <Feed />}
      {ui.drawer === 'settings' && <Settings />}
    </aside>
  );
}

// ---------------------------------------------------------------------------

const KIND_LABEL: Record<Email['kind'], { label: string; color: string }> = {
  report: { label: 'User report', color: '#c2410c' },
  request: { label: 'Request', color: '#0369a1' },
  thanks: { label: 'Thanks', color: '#17733f' },
  noise: { label: 'FYI', color: '#5d6f8a' },
  system: { label: 'Monitoring', color: '#6d28d9' },
  security: { label: 'SECURITY', color: '#b91c1c' },
};

function Inbox() {
  const { game, ui, setUi } = useUi();
  const [filter, setFilter] = useState<'all' | 'unread' | 'incident' | 'starred' | 'archived'>('all');
  const mails = game.s.inbox
    .filter((m) => (filter === 'archived' ? m.archived : !m.archived))
    .filter((m) => (filter === 'unread' ? !m.read : filter === 'incident' ? !!m.incidentId : filter === 'starred' ? m.starred : true))
    .slice()
    .reverse();
  const sel = game.s.inbox.find((m) => m.id === ui.inboxSel) ?? null;
  const open = (m: Email) => {
    m.read = true;
    setUi((u) => ({ ...u, inboxSel: m.id }));
    game.touch();
  };
  const unread = game.s.inbox.filter((m) => !m.read && !m.archived).length;
  return (
    <>
      <div className="tabs" role="tablist">
        {(['all', 'unread', 'incident', 'starred', 'archived'] as const).map((f) => (
          <button key={f} className="tab" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {f === 'incident' ? 'Incident-related' : f[0].toUpperCase() + f.slice(1)}
            {f === 'unread' && unread ? ` (${unread})` : ''}
          </button>
        ))}
        <span className="grow" />
        <button
          className="btn small ghost"
          onClick={() => {
            for (const m of game.s.inbox) m.read = true;
            game.touch();
          }}
        >
          Mark all read
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', flex: 1, minHeight: 0 }}>
        <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }} role="list" aria-label="Messages">
          {mails.length === 0 && <div className="muted" style={{ padding: 14 }}>No messages.</div>}
          {mails.map((m) => (
            <button
              key={m.id}
              role="listitem"
              onClick={() => open(m)}
              className="btn ghost"
              style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0, borderBottom: '1px solid var(--border)', padding: '8px 10px', background: sel?.id === m.id ? 'var(--sel)' : undefined, boxShadow: 'none', whiteSpace: 'normal' }}
            >
              <div className="row" style={{ gap: 6 }}>
                {!m.read && <span className="dot" style={{ background: 'var(--accent)' }} aria-label="unread" />}
                <span style={{ fontWeight: m.read ? 500 : 800, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fromName}</span>
                <span className="dim mono" style={{ fontSize: 12.5 }}>
                  {fmtClock(m.t)}
                </span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: m.read ? 400 : 700, margin: '2px 0' }}>{m.subject}</div>
              <span className="chip" style={{ color: KIND_LABEL[m.kind].color, borderColor: KIND_LABEL[m.kind].color, fontSize: 11.5 }}>
                {KIND_LABEL[m.kind].label}
              </span>
              {m.starred && <Icon name="star" size={14} style={{ color: '#d48a12', marginLeft: 6 }} />}
            </button>
          ))}
        </div>
        <div style={{ overflow: 'auto', padding: '12px 14px' }}>
          {sel ? (
            <article>
              <h3 style={{ margin: '0 0 4px' }}>{sel.subject}</h3>
              <div className="muted" style={{ fontSize: 14 }}>
                From <b>{sel.fromName}</b> · {fmtDay(sel.t)} {fmtClock(sel.t)}
              </div>
              <div className="row wrap" style={{ margin: '10px 0' }}>
                {sel.incidentId && (
                  <button className="btn small primary" onClick={() => setUi((u) => ({ ...u, expandedIncident: sel.incidentId, drawer: null }))}>
                    <Icon name="warning" size={16} /> Open {sel.incidentId}
                  </button>
                )}
                {sel.from !== 'system' && game.deviceOf(sel.from) && (
                  <button
                    className="btn small"
                    onClick={() => {
                      const d = game.deviceOf(sel.from)!;
                      setUi((u) => ({ ...u, selected: d.id }));
                    }}
                  >
                    <Icon name="target" size={16} /> Select their computer
                  </button>
                )}
                <button
                  className="btn small"
                  onClick={() => {
                    sel.starred = !sel.starred;
                    game.touch();
                  }}
                >
                  <Icon name="star" size={16} /> {sel.starred ? 'Unstar' : 'Star'}
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    sel.archived = !sel.archived;
                    game.touch();
                  }}
                >
                  <Icon name="archive" size={16} /> {sel.archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{sel.body}</div>
            </article>
          ) : (
            <div className="muted">Select a message. Users describe symptoms in their own words — read carefully, and don't take their diagnosis at face value.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Tasks() {
  const { game, setUi } = useUi();
  const [note, setNote] = useState('');
  const open = game.openIncidents();
  const tasks = game.s.tasks.filter((t) => t.kind !== 'note');
  const notes = game.s.tasks.filter((t) => t.kind === 'note');
  return (
    <div className="drawer-body">
      <div className="section-title" style={{ marginTop: 0 }}>
        Active incidents
      </div>
      {open.length === 0 && <div className="muted">No active incidents.</div>}
      {open.map((inc) => (
        <div key={inc.id} className="card" style={{ marginBottom: 8, borderColor: inc.security ? 'var(--sec)' : undefined }}>
          <div className="row" style={{ gap: 6 }}>
            <span className={`chip sev-${inc.severity}`}>{SEV_LABEL[inc.severity]}</span>
            {inc.security && <span className="chip sec">⚠ SECURITY</span>}
            <button className="linkish" onClick={() => setUi((u) => ({ ...u, expandedIncident: inc.id }))}>
              {inc.id}
            </button>
          </div>
          <div style={{ fontWeight: 700, margin: '4px 0' }}>{inc.title}</div>
          <ul className="checklist">
            {inc.checklist.map((c) => (
              <li key={c.id} className={c.done ? 'done' : ''}>
                <span className="box">{c.done && <Icon name="check" size={14} />}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="section-title">Requests & follow-ups</div>
      {tasks.length === 0 && <div className="muted">Nothing here yet.</div>}
      {tasks
        .slice()
        .reverse()
        .map((t) => (
          <div key={t.id} className="card" style={{ marginBottom: 8, opacity: t.done || t.failed ? 0.7 : 1 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="box" style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: t.done ? 'var(--good)' : undefined }}>
                {t.done && <Icon name="check" size={14} />}
              </span>
              <b style={{ flex: 1, textDecoration: t.done ? 'line-through' : undefined }}>{t.title}</b>
              {t.failed && <span className="chip sev-1">OVERDUE</span>}
              {t.kind === 'request' && <span className="chip sev-4">REQUEST</span>}
              {t.kind === 'followup' && <span className="chip sev-3">FOLLOW-UP</span>}
            </div>
            <p style={{ margin: '6px 0', fontSize: 15, lineHeight: 1.45 }}>{t.detail}</p>
            <div className="dim" style={{ fontSize: 14 }}>
              {t.requester ? `From ${t.requester} · ` : ''}
              {t.due ? `Due ${fmtDay(t.due)} ${fmtClock(t.due)} · ` : ''}
              {t.done ? `Completed ${fmtClock(t.doneAt ?? 0)}` : 'Checked automatically when done'}
            </div>
          </div>
        ))}
      <div className="section-title">My notes</div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          game.addTask({ title: note.trim(), detail: '', kind: 'note', incidentId: null, check: null, checkArgs: {}, due: null, reward: 0, requester: null });
          setNote('');
        }}
      >
        <input type="text" className="grow" placeholder="Add a note or to-do…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
        <button className="btn small" type="submit">
          Add
        </button>
      </form>
      <ul className="checklist" style={{ marginTop: 8 }}>
        {notes.map((n) => (
          <li key={n.id} className={n.done ? 'done' : ''}>
            <button
              className="box"
              style={{ background: n.done ? 'var(--good)' : 'transparent', cursor: 'pointer' }}
              onClick={() => {
                n.done = !n.done;
                game.touch();
              }}
              aria-label={n.done ? 'Mark not done' : 'Mark done'}
            >
              {n.done && <Icon name="check" size={14} />}
            </button>
            <span className="grow">{n.title}</span>
            <button
              className="btn small ghost"
              onClick={() => {
                game.s.tasks = game.s.tasks.filter((x) => x !== n);
                game.touch();
              }}
              aria-label="Delete note"
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Shop() {
  const { game } = useUi();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cats = [...new Set(SHOP.map((x) => x.category))];
  return (
    <div className="drawer-body">
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>
            BUDGET
          </div>
          <b style={{ fontSize: 23 }}>${Math.round(game.s.budget).toLocaleString()}</b>
        </div>
        <div className="dim" style={{ fontSize: 14, textAlign: 'right' }}>
          In stock: {game.s.inventory.cable ?? 0} patch cables · {game.s.inventory.fiber ?? 0} fiber/SFP · {game.s.inventory.psu ?? 0} PSU
        </div>
      </div>
      {msg && (
        <div className={`hint ${msg.ok ? 'ok' : 'bad'}`} role="status">
          {msg.text}
        </div>
      )}
      {cats.map((c) => (
        <section key={c}>
          <div className="section-title">{c}</div>
          {SHOP.filter((x) => x.category === c).map((item) => {
            const owned = item.kind === 'upgrade' && game.s.purchases.includes(item.id);
            const afford = game.s.budget >= item.price;
            return (
              <div key={item.id} className="card" style={{ marginBottom: 8, opacity: owned ? 0.7 : 1 }}>
                <div className="row">
                  <b className="grow">{item.name}</b>
                  <b className="mono">${item.price.toLocaleString()}</b>
                </div>
                <div className="muted" style={{ fontSize: 14.5, margin: '4px 0' }}>
                  {item.desc}
                </div>
                <div style={{ fontSize: 14.5 }}>
                  <b>Effect:</b> {item.effect}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  {item.kind === 'consumable' && <span className="dim">In stock: {game.s.inventory[item.id] ?? 0}</span>}
                  <span className="grow" />
                  {owned ? (
                    <span className="tone-good">
                      <Icon name="check" size={16} /> Owned
                    </span>
                  ) : (
                    <button className="btn small primary" disabled={!afford} onClick={() => {
                      const r = game.buy(item.id);
                      setMsg({ ok: r.ok, text: r.msg });
                    }} title={afford ? 'Buy' : 'Not enough budget'}>
                      <Icon name="cart" size={16} /> Buy
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Manager() {
  const { game } = useUi();
  const s = game.s;
  const [sel, setSel] = useState<string | null>(null);
  const msgs = s.manager.slice().reverse();
  const cur = s.manager.find((m) => m.id === sel) ?? msgs[0];
  if (cur && !cur.read) {
    cur.read = true;
  }
  const sat = s.satisfaction;
  return (
    <div className="drawer-body">
      <div className="card row" style={{ gap: 14 }}>
        <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden>
          <circle cx="27" cy="27" r="26" fill="#d5e5fb" />
          <path d="M10 50c3-11 10-15 17-15s14 4 17 15" fill="#7c3aed" />
          <circle cx="27" cy="22" r="10" fill="#c68a62" />
          <path d="M16 21c1-9 7-12 11-12s11 3 11 12c-3-4-6-5-11-5s-8 1-11 5z" fill="#2e1f14" />
        </svg>
        <div className="grow">
          <b>Dana Whitfield</b> <span className="dim">· COO, your manager</span>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="dim" style={{ fontSize: 14 }}>
              Confidence
            </span>
            <div className="prod-bar" style={{ width: 140 }} role="meter" aria-valuenow={Math.round(sat)} aria-valuemin={0} aria-valuemax={100} aria-label="Manager confidence">
              <div className="prod-fill" style={{ width: `${sat}%`, background: sat >= 50 ? 'var(--good)' : sat >= 30 ? 'var(--warn)' : 'var(--crit)' }} />
            </div>
            <b>{Math.round(sat)}</b>
          </div>
        </div>
      </div>
      <dl className="kv" style={{ margin: '10px 2px' }}>
        <dt>Budget</dt>
        <dd>${Math.round(s.budget).toLocaleString()}</dd>
        <dt>Score</dt>
        <dd>
          {s.score.toLocaleString()} · {rankFor(s.score)}
        </dd>
        <dt>Resolved</dt>
        <dd>
          {s.stats.resolved} incidents ({s.stats.securityResolved} security) · {s.stats.breaches} SLA breaches · {s.stats.hintsUsed} hints
        </dd>
        <dt>Hint tokens</dt>
        <dd>{s.settings.hintMode === 'earned' ? s.hintTokens : 'Free mode'}</dd>
      </dl>
      {s.days.length > 0 && (
        <>
          <div className="section-title">Daily reports</div>
          <table className="grid">
            <thead>
              <tr>
                <th>Day</th>
                <th>Avg productivity</th>
                <th>Resolved</th>
                <th>Breaches</th>
                <th>Allowance</th>
              </tr>
            </thead>
            <tbody>
              {s.days.map((d) => (
                <tr key={d.day}>
                  <td>{d.day + 1}</td>
                  <td>{d.avgProductivity}%</td>
                  <td>{d.incidentsResolved}</td>
                  <td>{d.slaBreaches}</td>
                  <td>+${d.allowance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="section-title">Messages from Dana</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {msgs.map((m) => (
          <button key={m.id} className="btn ghost" style={{ display: 'block', textAlign: 'left', whiteSpace: 'normal', background: cur?.id === m.id ? 'var(--sel)' : undefined, border: '2px solid var(--border)', boxShadow: 'none' }} onClick={() => setSel(m.id)}>
            <div className="row">
              <b className="grow" style={{ color: m.kind === 'escalation' ? '#b52a2a' : m.kind === 'praise' ? '#17733f' : undefined }}>
                {m.subject}
              </b>
              <span className="dim mono" style={{ fontSize: 12.5 }}>
                D{dayIndex(m.t) + 1} {fmtClock(m.t)}
              </span>
            </div>
            {cur?.id === m.id && <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, lineHeight: 1.5, fontSize: 15 }}>{m.body}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Feed() {
  const { game } = useUi();
  const [kind, setKind] = useState<string>('all');
  const items = game.s.feed.filter((f) => kind === 'all' || f.kind === kind).slice().reverse();
  const color: Record<string, string> = { info: 'var(--muted)', good: '#17733f', bad: '#b5481a', security: '#b52a2a', change: '#1d5aa0' };
  return (
    <>
      <div className="tabs">
        {['all', 'change', 'bad', 'good', 'security', 'info'].map((k) => (
          <button key={k} className="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            {k === 'change' ? 'My changes' : k === 'bad' ? 'Problems' : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="drawer-body">
        {items.map((f, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 15 }}>
            <span className="mono dim" style={{ fontSize: 12.5, minWidth: 64 }}>
              D{dayIndex(f.t) + 1} {fmtClock(f.t)}
            </span>
            <span style={{ color: color[f.kind] }}>{f.msg}</span>
          </div>
        ))}
        {!items.length && <div className="muted">Nothing logged yet.</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Settings() {
  const { game, restart, setUi } = useUi();
  const st = game.s.settings;
  const [seed, setSeed] = useState('');
  const [repro, setRepro] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<typeof st>) => {
    Object.assign(st, patch);
    game.touch();
  };
  return (
    <div className="drawer-body stack">
      <div className="section-title" style={{ marginTop: 0 }}>
        Gameplay
      </div>
      <label className="row">
        <input type="checkbox" checked={st.autoSlow} onChange={(e) => set({ autoSlow: e.target.checked })} /> Drop to 1× speed when a new incident is reported
      </label>
      <div className="card">
        <b>Hint mode</b>
        <label className="row" style={{ marginTop: 6 }}>
          <input type="radio" name="hm" checked={st.hintMode === 'earned'} onChange={() => set({ hintMode: 'earned' })} /> Earned — hints cost tokens (you have {game.s.hintTokens}); earn one per incident solved within SLA. Each hint reduces that incident's score by 15%.
        </label>
        <label className="row" style={{ marginTop: 6 }}>
          <input type="radio" name="hm" checked={st.hintMode === 'free'} onChange={() => set({ hintMode: 'free' })} /> Free — unlimited hints, but each one reduces that incident's score by 25%.
        </label>
      </div>
      <div className="section-title">Display</div>
      <label className="row">
        <input type="checkbox" checked={st.labels} onChange={(e) => set({ labels: e.target.checked })} /> Show device labels when zoomed in
      </label>
      <label className="row">
        <input type="checkbox" checked={st.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduce motion (no animated LEDs/rings)
      </label>
      <button
        className="btn small"
        onClick={() => {
          game.s.tutorial = { step: 0, active: true, done: false, flags: {} };
          game.touch();
        }}
      >
        <Icon name="help" size={16} /> Replay tutorial
      </button>
      <button className="btn small" onClick={() => setUi((u) => ({ ...u, showShortcuts: true, drawer: null }))}>
        <Icon name="info" size={16} /> Keyboard shortcuts
      </button>
      <div className="section-title">Save</div>
      <div className="muted" style={{ fontSize: 14.5 }}>
        Progress saves automatically to this browser every 20 seconds and when you leave the page.
      </div>
      <div className="row">
        <button className="btn small" onClick={() => setSaved(game.save() ? 'Saved.' : 'Could not save (storage unavailable).')}>
          <Icon name="save" size={16} /> Save now
        </button>
        {saved && <span className="muted">{saved}</span>}
      </div>
      <div className="section-title">New game</div>
      <div className="muted" style={{ fontSize: 14.5 }}>
        Current seed: <span className="mono">{game.s.seed}</span>
        {game.s.reproducible ? ' (reproducible mode)' : ''}. Use the same seed with reproducible mode to replay the same incident sequence (useful for debugging and teaching).
      </div>
      <label className="field">
        Seed (optional)
        <input type="text" className="mono" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="random" />
      </label>
      <label className="row">
        <input type="checkbox" checked={repro} onChange={(e) => setRepro(e.target.checked)} /> Reproducible mode
      </label>
      <div className="row">
        <ConfirmButton
          className="btn"
          confirmLabel="Click again — current progress is lost"
          onConfirm={() => {
            Game.clearSave();
            const g = Game.create(seed ? Number(seed) >>> 0 : (Math.random() * 2 ** 32) >>> 0, { tutorial: false, reproducible: repro, hintMode: st.hintMode });
            g.save();
            restart(g);
          }}
        >
          Start new game
        </ConfirmButton>
        <button
          className="btn"
          onClick={() => {
            game.save();
            restart();
          }}
          title="Return to the title screen (your game is kept unless you start a new one)"
        >
          Title screen
        </button>
      </div>
    </div>
  );
}
