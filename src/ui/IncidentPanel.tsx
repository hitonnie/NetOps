import { useState } from 'react';
import { fmtClock, fmtDuration } from '../core/time';
import { SEV_LABEL, SLA } from '../sim/game';
import type { Incident } from '../sim/types';
import { MANUAL } from '../content/manual';
import { useGameTick, useUi } from './ctx';
import { Icon } from './icons';

function IncidentCard({ inc }: { inc: Incident }) {
  const { game, ui, setUi, openManual, flyTo, openDevice, select } = useUi();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const expanded = ui.expandedIncident === inc.id;
  const elapsed = game.s.t - (inc.reportedAt ?? game.s.t);
  const slaUsed = inc.slaElapsed ?? elapsed;
  const sla = SLA[inc.severity];
  const frac = Math.min(1, slaUsed / sla);
  const hints = game.hintsFor(inc);
  const fixed = inc.fixedSince !== null;
  const affectedNames = inc.affectedDevs.map((d) => game.ownerOf(d)?.name ?? game.dev(d)?.name).filter(Boolean) as string[];
  const userDevs = inc.affectedDevs.filter((d) => ['pc', 'laptop'].includes(game.dev(d)?.kind ?? ''));
  const deskTarget = inc.area.includes('desk') && inc.affectedDevs.length === 1 ? game.dev(inc.affectedDevs[0]) : null;
  const toggle = () => {
    setUi((u) => ({ ...u, expandedIncident: expanded ? null : inc.id }));
    game.flag('incident-viewed');
  };
  const verify = () => {
    const r = game.verifyIncident(inc.id);
    setMsg({ ok: r.ok, text: r.msg });
  };
  const hint = () => {
    const r = game.useHint(inc.id);
    if (!r.ok) setMsg({ ok: false, text: r.msg });
  };
  return (
    <article className={`inc-card s${inc.severity} ${inc.security ? 'security' : ''} ${fixed ? 'fixed' : ''}`} aria-label={`Incident ${inc.id}`}>
      <button className="inc-top" onClick={toggle} aria-expanded={expanded}>
        {inc.security ? <Icon name="warning" size={24} style={{ color: 'var(--sec)', flex: 'none' }} title="Security threat" /> : <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={20} style={{ flex: 'none', marginTop: 2 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 5, marginBottom: 3 }}>
            <span className={`chip sev-${inc.severity}`}>{SEV_LABEL[inc.severity]}</span>
            {inc.security && <span className="chip sec">⚠ SECURITY</span>}
            {fixed && <span className="chip fixed">✓ looks fixed — verify</span>}
            <span className="dim" style={{ fontSize: 12.5 }}>{inc.id}</span>
          </div>
          <div className="inc-title">{inc.title}</div>
          <div className="inc-meta">
            <span>
              <Icon name="target" size={14} /> {inc.area}
            </span>
            <span>
              Reported {fmtClock(inc.reportedAt ?? inc.createdAt)} · open {fmtDuration(elapsed)}
            </span>
          </div>
        </div>
      </button>
      <div className="sla" title={`SLA ${fmtDuration(sla)} (business hours) — ${inc.breached ? 'BREACHED' : `${fmtDuration(Math.max(0, sla - slaUsed))} left`}`}>
        <div style={{ width: `${frac * 100}%`, background: frac >= 1 ? 'var(--crit)' : frac > 0.66 ? 'var(--warn)' : 'var(--good)' }} />
      </div>
      {expanded && (
        <div className="inc-body">
          <p>{inc.symptom}</p>
          {affectedNames.length > 0 && affectedNames.length <= 8 && (
            <p className="muted" style={{ fontSize: 14 }}>
              Reported by / affecting: {affectedNames.join(', ')}
            </p>
          )}
          <div className="section-title" style={{ marginTop: 6 }}>
            Checklist
          </div>
          <ul className="checklist">
            {inc.checklist.map((c) => (
              <li key={c.id} className={c.done ? 'done' : ''}>
                <span className="box" aria-hidden>
                  {c.done && <Icon name="check" size={14} />}
                </span>
                <span>
                  {c.text}
                  <span className="sr-only">{c.done ? ' (done)' : ' (not done)'}</span>
                </span>
              </li>
            ))}
          </ul>
          {hints.map((h, i) => (
            <div key={i} className="hint">
              <b>Hint {i + 1}:</b> {h}
            </div>
          ))}
          {msg && (
            <div className={`hint ${msg.ok ? 'ok' : 'bad'}`} role="status">
              {msg.text}
            </div>
          )}
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn primary small" onClick={verify} title="Run checks against the affected users/services. Closing an incident that isn't fixed costs a little confidence.">
              <Icon name="check" size={16} /> Verify &amp; close
            </button>
            <button className="btn small" onClick={hint} disabled={inc.hintsUsed >= 3} title={game.s.settings.hintMode === 'earned' ? `Costs 1 hint token (you have ${game.s.hintTokens}). Each hint lowers this incident's score.` : 'Free hints — each one lowers the score for this incident by 25%.'}>
              <Icon name="bulb" size={16} /> Hint {inc.hintsUsed}/3{game.s.settings.hintMode === 'earned' ? ` · ${game.s.hintTokens} tokens` : ''}
            </button>
            <button className="btn small" onClick={() => setMsg({ ok: true, text: game.statusUpdate(inc.id).msg })} title="Keep your manager informed — reduces the confidence hit from SLA breaches.">
              <Icon name="send" size={16} /> Status update
            </button>
            {userDevs.length > 0 && (
              <button className="btn small" onClick={() => setMsg({ ok: true, text: game.askRestart(inc.id).msg })} title="Ask affected users to restart their computers (they will re-request DHCP).">
                <Icon name="refresh" size={16} /> Ask users to restart
              </button>
            )}
            {deskTarget && (
              <button
                className="btn small"
                onClick={() => {
                  flyTo(deskTarget.pos.x, deskTarget.pos.y, 2.2);
                  select(deskTarget.id);
                  openDevice(deskTarget.id);
                }}
              >
                <Icon name="target" size={16} /> Go to desk
              </button>
            )}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className="dim" style={{ fontSize: 14 }}>
              <Icon name="book" size={14} /> Runbook:
            </span>
            {game.manualRefs(inc).map((m) => (
              <button key={m} className="linkish" style={{ fontSize: 14 }} onClick={() => openManual(m)}>
                {MANUAL.find((a) => a.id === m)?.title ?? m}
              </button>
            ))}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="dim" style={{ fontSize: 14, cursor: 'pointer' }}>
              Timeline
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14 }}>
              {inc.timeline.map((t, i) => (
                <li key={i}>
                  <span className="mono dim">{fmtClock(t.t)}</span> {t.msg}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </article>
  );
}

export function IncidentPanel() {
  const { game } = useUi();
  useGameTick(game);
  const [showResolved, setShowResolved] = useState(false);
  const open = game
    .openIncidents()
    .slice()
    .sort((a, b) => Number(b.security) - Number(a.security) || a.severity - b.severity || (a.reportedAt ?? 0) - (b.reportedAt ?? 0));
  const resolved = game.s.incidents.filter((i) => i.status === 'resolved').slice(-4).reverse();
  return (
    <section className="incidents" aria-label="Incidents">
      <div className="inc-head">
        <Icon name="warning" size={18} style={{ color: open.length ? 'var(--bad)' : 'var(--good)' }} />
        <span>{open.length ? `${open.length} active incident${open.length > 1 ? 's' : ''}` : 'No active incidents'}</span>
        <span className="grow" />
        {resolved.length > 0 && (
          <button className="btn small ghost" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved}>
            {showResolved ? 'Hide' : 'Recent'} ({resolved.length})
          </button>
        )}
      </div>
      {open.map((inc) => (
        <IncidentCard key={inc.id} inc={inc} />
      ))}
      {showResolved &&
        resolved.map((inc) => (
          <article key={inc.id} className="inc-card" style={{ borderLeftColor: 'var(--good)', opacity: 0.92 }}>
            <div style={{ padding: '8px 10px', fontSize: 14.5 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="chip fixed">
                  {inc.verified ? 'RESOLVED' : 'AUTO-CLOSED'}
                </span>
                <span className="dim">{inc.id}</span>
                <span className="grow" />
                <b>+{inc.score}</b>
              </div>
              <div style={{ fontWeight: 700, margin: '4px 0' }}>{inc.title}</div>
              <div>
                <b>Root cause:</b> {inc.rootCause}
              </div>
              <div className="muted">
                <b>Fix:</b> {inc.fixSummary}
              </div>
              <div className="dim">Time to resolve: {fmtDuration((inc.resolvedAt ?? 0) - (inc.reportedAt ?? inc.createdAt))}</div>
            </div>
          </article>
        ))}
      {!open.length && !showResolved && (
        <div className="inc-card" style={{ borderLeftColor: 'var(--good)', padding: '8px 10px', fontSize: 14.5 }}>
          <span className="muted">All quiet. Use the time to check the Inbox and Tasks, save configs, or invest in upgrades.</span>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {open.length ? `${open.length} active incidents` : ''}
      </span>
    </section>
  );
}
