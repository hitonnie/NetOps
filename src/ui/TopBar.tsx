import { daylight, fmtClock, fmtDay, minuteOfDay } from '../core/time';
import { prodLevel, rankFor, SPEEDS } from '../sim/game';
import { useGameTick, useUi } from './ctx';
import { Icon } from './icons';

const TONE_BG: Record<string, string> = {
  good: 'linear-gradient(90deg,#3ccf7a,#7fe3a2)',
  ok: 'linear-gradient(90deg,#8cc63f,#c3e27a)',
  warn: 'linear-gradient(90deg,#f5b829,#ffd970)',
  bad: 'linear-gradient(90deg,#f0803c,#ffb07a)',
  crit: 'linear-gradient(90deg,#e04848,#ff8a8a)',
};

export function TopBar() {
  const { game, setDrawer, setUi } = useUi();
  useGameTick(game);
  const s = game.s;
  const p = Math.max(0, Math.min(100, s.productivity));
  const lvl = prodLevel(p);
  const hist = s.prodHistory.slice(-6);
  const trend = hist.length >= 2 ? hist[hist.length - 1] - hist[0] : 0;
  const mod = minuteOfDay(s.t);
  const night = daylight(s.t) < 0.4;
  const anyPresent = s.employees.some((e) => e.present);
  const canSkip = !anyPresent && (mod >= 1110 || mod < 380);
  const sec = game.openIncidents().filter((i) => i.security);
  const sat = s.satisfaction;
  const satLabel = sat >= 75 ? 'Confident' : sat >= 50 ? 'Satisfied' : sat >= 30 ? 'Concerned' : 'Unhappy';
  return (
    <header className="topbar" role="banner">
      <div className="prod" title="Company productivity: how much work employees can get done right now. Network problems drag it down.">
        <div className="stat">
          <small>Productivity</small>
          <div className="row" style={{ gap: 6 }}>
            <div className="prod-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label="Company productivity">
              <div className="prod-fill" style={{ width: `${p}%`, background: TONE_BG[lvl.tone] }} />
            </div>
            <span className={`prod-label tone-${lvl.tone}`}>
              {Math.round(p)}% {lvl.label}
            </span>
            <span className="trend" aria-label={trend < -3 ? 'falling' : trend > 3 ? 'rising' : 'steady'}>
              {trend < -3 ? '▼' : trend > 3 ? '▲' : '■'}
            </span>
          </div>
        </div>
      </div>
      <div className="stat" title="IT budget for purchases. Topped up every evening based on how the day went.">
        <small>Budget</small>
        <b style={{ color: s.budget < 500 ? 'var(--crit)' : undefined }}>${Math.round(s.budget).toLocaleString()}</b>
      </div>
      <button className="stat btn ghost" style={{ alignItems: 'flex-start', padding: '2px 6px' }} onClick={() => setDrawer('manager')} title="Your manager's confidence in you. If it reaches 0 you are fired.">
        <small>Manager</small>
        <b className={sat >= 50 ? 'tone-good' : sat >= 30 ? 'tone-warn' : 'tone-crit'}>
          {Math.round(sat)} · {satLabel}
        </b>
      </button>
      <div className="stat" title="Score and rank. Fast, verified fixes without hints score best.">
        <small>Score · {rankFor(s.score)}</small>
        <b>{s.score.toLocaleString()}</b>
      </div>
      {sec.length > 0 && (
        <button className="sec-banner" onClick={() => setUi((u) => ({ ...u, expandedIncident: sec[0].id }))} aria-label={`${sec.length} active security threat${sec.length > 1 ? 's' : ''}`}>
          <Icon name="shield" size={18} /> SECURITY THREAT ACTIVE ({sec.length})
        </button>
      )}
      <div className="clock">
        <Icon name={night ? 'moon' : 'sun'} size={22} style={{ color: night ? '#dbe4ff' : '#ffe08a' }} title={night ? 'Night' : 'Day'} />
        <div className="stat">
          <small>{fmtDay(s.t)}</small>
          <span className="clock-time" aria-live="off">
            {fmtClock(s.t)}
          </span>
        </div>
        <div className="speed-group" role="group" aria-label="Simulation speed">
          {SPEEDS.map((sp, i) => (
            <button key={sp} className={`btn ${s.speed === i ? 'active' : ''}`} onClick={() => game.setSpeed(i)} aria-pressed={s.speed === i} title={i === 0 ? 'Pause (Space)' : `${sp}× speed (key ${i})`}>
              {i === 0 ? <Icon name="pause" size={16} title="Pause" /> : `${sp}×`}
            </button>
          ))}
        </div>
        {canSkip && (
          <button className="btn primary" onClick={() => game.skipToMorning()} title="Fast-forward to the next working morning">
            <Icon name="skip" size={16} /> Skip to morning
          </button>
        )}
        <button className="btn ghost" onClick={() => setDrawer('settings')} aria-label="Settings and game menu" title="Settings & game menu">
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
