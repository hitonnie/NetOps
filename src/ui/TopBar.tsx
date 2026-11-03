import { useEffect, useRef, useState } from 'react';
import { XpBar } from '@/components/ui/8bit-xp-bar';
import { AUTOSAVE_MS, desktop } from '../core/platform';
import { daylight, fmtClock, fmtDay, minuteOfDay } from '../core/time';
import { prodLevel, rankProgress, SPEEDS } from '../sim/game';
import { useGameTick, useUi } from './ctx';
import { Icon } from './icons';

const TONE_FILL: Record<string, string> = {
  good: '#3ecf6e',
  ok: '#9bd34a',
  warn: '#f5b70a',
  bad: '#ff8a3d',
  crit: '#ff5252',
};
const LEVEL_UP_MS = 6000;

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
  const rank = rankProgress(s.score);
  const levelUp = useLevelUp(rank.level);
  return (
    <header className="topbar" role="banner">
      <div className="prod" title={`Company productivity: how much work employees can get done right now (${lvl.label}). Network problems drag it down.`}>
        <XpBar
          variant="retro"
          value={p}
          label="PRODUCTIVITY"
          valueLabel={
            <span className={`tone-${lvl.tone}`}>
              {Math.round(p)}% {trend < -3 ? '▼' : trend > 3 ? '▲' : ''}
            </span>
          }
          fill={TONE_FILL[lvl.tone]}
          aria-label={`Company productivity ${Math.round(p)}%, ${lvl.label}`}
        />
      </div>
      <div className="xp-stat" title={`Rank: ${rank.name}. ${rank.next !== null ? `${(rank.next - s.score).toLocaleString()} more points to the next rank.` : 'Top rank reached.'} Fast, verified fixes without hints score best.`}>
        <XpBar value={levelUp ? 100 : rank.pct} label={`LV${rank.level} ${rank.short}`} valueLabel={rank.next !== null ? `${s.score.toLocaleString()}/${rank.next.toLocaleString()}` : `${s.score.toLocaleString()} MAX`} levelUp={levelUp} aria-label={`Rank ${rank.name}, score ${s.score}`} />
      </div>
      <div className="stat" title="IT budget for purchases. Topped up every evening based on how the day went.">
        <small>Budget</small>
        <b style={{ color: s.budget < 500 ? 'var(--crit)' : 'var(--gold)' }}>${Math.round(s.budget).toLocaleString()}</b>
      </div>
      <button className="stat btn ghost" style={{ alignItems: 'flex-start', padding: '2px 6px', textTransform: 'none' }} onClick={() => setDrawer('manager')} title="Your manager's confidence in you. If it reaches 0 you are fired.">
        <small>Manager</small>
        <b className={sat >= 50 ? 'tone-good' : sat >= 30 ? 'tone-warn' : 'tone-crit'}>
          {Math.round(sat)} {satLabel.toUpperCase()}
        </b>
      </button>
      {sec.length > 0 && (
        <button className="sec-banner" onClick={() => setUi((u) => ({ ...u, expandedIncident: sec[0].id }))} aria-label={`${sec.length} active security threat${sec.length > 1 ? 's' : ''}`}>
          <Icon name="shield" size={18} /> SECURITY THREAT ({sec.length})
        </button>
      )}
      <div className="clock">
        <Icon name={night ? 'moon' : 'sun'} size={22} style={{ color: night ? '#c7d2fe' : 'var(--gold)' }} title={night ? 'Night' : 'Day'} />
        <div className="stat">
          <small>{fmtDay(s.t)}</small>
          <span className="clock-time" aria-live="off">
            {fmtClock(s.t)}
          </span>
        </div>
        <div className="speed-group" role="group" aria-label="Simulation speed">
          {SPEEDS.map((sp, i) => (
            <button key={sp} className={`btn ${s.speed === i ? 'active' : ''}`} onClick={() => game.setSpeed(i)} aria-pressed={s.speed === i} title={i === 0 ? 'Pause (Space)' : `${sp}× speed (key ${i})`}>
              {i === 0 ? <Icon name="pause" size={16} title="Pause" /> : `${sp}x`}
            </button>
          ))}
        </div>
        {canSkip && (
          <button className="btn primary" onClick={() => game.skipToMorning()} title="Fast-forward to the next working morning">
            <Icon name="skip" size={16} /> Skip to morning
          </button>
        )}
        <AutosaveBadge />
        <button className="btn ghost" onClick={() => setDrawer('settings')} aria-label="Settings and game menu" title="Settings & game menu">
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}

/** True for a few seconds after the rank goes up. */
function useLevelUp(level: number): boolean {
  const prev = useRef(level);
  const [until, setUntil] = useState(0);
  useEffect(() => {
    if (level > prev.current) setUntil(Date.now() + LEVEL_UP_MS);
    prev.current = level;
  }, [level]);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = window.setTimeout(() => rerender((n) => n + 1), Math.max(0, until - Date.now()) + 50);
    return () => window.clearTimeout(t);
  }, [until]);
  return Date.now() < until;
}

/** Shows that autosave is on, and flashes SAVED each time the game saves. */
function AutosaveBadge() {
  const { game } = useUi();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let t: number | undefined;
    const off = game.onSaved((ok) => {
      if (!ok) return;
      setFlash(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setFlash(false), 2200);
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [game]);
  const where = desktop ? 'to a save file on this PC' : 'in this browser';
  const last = game.lastSavedAt ? ` Last saved ${new Date(game.lastSavedAt).toLocaleTimeString()}.` : '';
  return (
    <span className={`autosave ${flash ? 'just' : ''}`} title={`Autosave is on: every ${AUTOSAVE_MS / 1000} seconds and when you close the game, ${where}.${last}`} role="status">
      <Icon name="save" size={18} /> {flash ? 'SAVED' : 'AUTO'}
    </span>
  );
}
