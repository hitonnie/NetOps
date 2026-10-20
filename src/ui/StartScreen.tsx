import { useState } from 'react';
import { fmtClock, fmtDay } from '../core/time';
import { Game } from '../sim/game';
import { ConfirmButton } from './ConfirmButton';
import { Icon } from './icons';

export function StartScreen({ onStart }: { onStart: (g: Game) => void }) {
  const [saved] = useState(() => Game.load());
  const [tutorial, setTutorial] = useState(true);
  const [hintMode, setHintMode] = useState<'earned' | 'free'>('earned');
  const [seed, setSeed] = useState('');
  const [repro, setRepro] = useState(false);
  const start = () => {
    const sd = seed ? Number(seed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const g = Game.create(sd, { tutorial, reproducible: repro, hintMode });
    g.save();
    onStart(g);
  };
  return (
    <main className="start">
      <div className="start-inner">
        <section>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" rx="8" fill="#2f7fd8" stroke="#1f63b5" />
              <path d="M8 22h16M10 22v-5h12v5M16 17v-6M12 11h8" stroke="#ffffff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <circle cx="16" cy="9" r="2.5" fill="#ffd166" />
            </svg>
            <span className="dim" style={{ fontWeight: 700, letterSpacing: '.1em' }}>
              BRIGHTLOOP SOFTWARE · IT DEPARTMENT
            </span>
          </div>
          <h1>
            NetOps: <span>Office Network Engineer</span>
          </h1>
          <p>Run the network of a busy software company. Watch the office from above, take incident reports, investigate with real Cisco-style and Windows/Linux commands, fix the root cause — and keep everyone productive.</p>
          <ul className="feature-list">
            <li>
              <Icon name="terminal" style={{ color: 'var(--accent)' }} /> A stateful network: VLANs, trunks, DHCP, DNS, routing, ACLs, NAT, Wi-Fi, PoE — commands change it.
            </li>
            <li>
              <Icon name="warning" style={{ color: 'var(--bad)' }} /> 30 incident types, from unplugged cables to rogue DHCP servers, malware C2 and SYN floods.
            </li>
            <li>
              <Icon name="user" style={{ color: 'var(--accent-2)' }} /> 26 employees with schedules, meetings, coffee breaks — and opinions about the Wi-Fi.
            </li>
            <li>
              <Icon name="briefcase" style={{ color: 'var(--good)' }} /> A budget, a manager, a shop, an inbox, and a runbook for when you're stuck.
            </li>
          </ul>
          <p className="dim" style={{ fontSize: 14 }}>
            PC game — play with a mouse and keyboard. All company names, people and incidents are fictional. Progress is saved in this browser.
          </p>
        </section>
        <section className="card stack" style={{ alignSelf: 'center', padding: 18 }}>
          {saved && (
            <>
              <button className="btn primary" style={{ justifyContent: 'center', padding: '10px 14px', fontSize: 17.5 }} onClick={() => onStart(saved)} autoFocus>
                <Icon name="play" size={18} /> Continue — {fmtDay(saved.s.t)} {fmtClock(saved.s.t)}
              </button>
              <div className="dim" style={{ fontSize: 14, textAlign: 'center' }}>
                Score {saved.s.score.toLocaleString()} · budget ${Math.round(saved.s.budget).toLocaleString()} · {saved.s.stats.resolved} incidents resolved
              </div>
              <hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />
            </>
          )}
          <b>New game</b>
          <label className="row">
            <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} /> Guided tutorial (recommended for your first game)
          </label>
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
            <legend className="dim" style={{ fontSize: 14 }}>
              Hints
            </legend>
            <label className="row">
              <input type="radio" name="hint" checked={hintMode === 'earned'} onChange={() => setHintMode('earned')} /> Earned — tokens, earned by fast fixes
            </label>
            <label className="row">
              <input type="radio" name="hint" checked={hintMode === 'free'} onChange={() => setHintMode('free')} /> Free — unlimited, but lower scores
            </label>
          </fieldset>
          <details>
            <summary className="dim" style={{ cursor: 'pointer', fontSize: 15 }}>
              Advanced: seed / reproducible mode
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <label className="field">
                Seed
                <input type="text" className="mono" value={seed} placeholder="random" onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="row">
                <input type="checkbox" checked={repro} onChange={(e) => setRepro(e.target.checked)} /> Reproducible mode (same seed → same incidents)
              </label>
            </div>
          </details>
          {saved ? (
            <ConfirmButton className="btn" style={{ justifyContent: 'center', padding: '10px 14px', fontSize: 17.5 }} onConfirm={start} confirmLabel={<>Click again — this replaces your saved game</>}>
              <Icon name="play" size={18} /> Start new game
            </ConfirmButton>
          ) : (
            <button className="btn primary" style={{ justifyContent: 'center', padding: '10px 14px', fontSize: 17.5 }} onClick={start} autoFocus>
              <Icon name="play" size={18} /> Start new game
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
