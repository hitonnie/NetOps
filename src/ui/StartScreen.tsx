import { useEffect, useRef, useState } from 'react';
import MainMenu, { type MainMenuItem } from '@/components/ui/8bit-main-menu';
import { desktop } from '../core/platform';
import { fmtClock, fmtDay } from '../core/time';
import { Game, rankFor } from '../sim/game';

const FEATURES = [
  'A stateful network: VLANs, trunks, DHCP, DNS, routing, ACLs, NAT, Wi-Fi, PoE — your commands change it.',
  '30 incident types, from unplugged cables to rogue DHCP servers, malware C2 and SYN floods.',
  '26 employees with schedules, meetings, coffee breaks — and opinions about the Wi-Fi.',
  'A budget, a manager, a shop, an inbox, a runbook — and a career ladder from Junior Tech to Architect.',
];

export function StartScreen({ onStart }: { onStart: (g: Game) => void }) {
  const [saved] = useState(() => Game.load());
  const [tutorial, setTutorial] = useState(true);
  const [hintMode, setHintMode] = useState<'earned' | 'free'>('earned');
  const [seed, setSeed] = useState('');
  const [repro, setRepro] = useState(false);
  const [options, setOptions] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button[data-menu-item]')?.focus();
  }, []);
  useEffect(() => {
    if (!confirmNew) return;
    const t = window.setTimeout(() => setConfirmNew(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmNew]);

  const start = () => {
    const sd = seed ? Number(seed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const g = Game.create(sd, { tutorial, reproducible: repro, hintMode });
    g.save();
    onStart(g);
  };

  const items: MainMenuItem[] = [
    ...(saved ? [{ id: 'continue', label: 'CONTINUE', variant: 'xp' as const, action: () => onStart(saved), hint: `Resume ${fmtDay(saved.s.t)} ${fmtClock(saved.s.t)}` }] : []),
    {
      id: 'new',
      label: confirmNew ? 'OVERWRITE SAVE?' : 'NEW GAME',
      variant: confirmNew ? 'destructive' : saved ? 'default' : 'xp',
      action: () => (saved && !confirmNew ? setConfirmNew(true) : start()),
      hint: saved ? 'Starts over and replaces your saved game (click twice)' : 'Start your first shift',
    },
    { id: 'tutorial', label: `TUTORIAL: ${tutorial ? 'ON' : 'OFF'}`, variant: 'secondary', action: () => setTutorial((t) => !t), hint: 'A guided first incident — recommended for your first game' },
    {
      id: 'hints',
      label: `HINTS: ${hintMode === 'earned' ? 'EARNED' : 'FREE'}`,
      variant: 'secondary',
      action: () => setHintMode((m) => (m === 'earned' ? 'free' : 'earned')),
      hint: 'Earned: hints cost tokens you win with fast fixes. Free: unlimited hints, lower scores.',
    },
    { id: 'options', label: 'OPTIONS', variant: options ? 'default' : 'secondary', action: () => setOptions((o) => !o), hint: 'Seed and reproducible mode' },
    ...(desktop ? [{ id: 'quit', label: 'QUIT', variant: 'outline' as const, action: () => window.close(), hint: 'Close NetOps (your game is saved)' }] : []),
  ];

  return (
    <main className="start">
      <div className="grid w-full max-w-[1160px] grid-cols-[1.15fr_1fr] items-center gap-16">
        <section>
          <div className="mb-8 flex items-center gap-4">
            <img src="/favicon.svg" alt="" width={72} height={72} className="[image-rendering:pixelated]" />
            <span className="retro text-[10px] leading-loose text-muted-foreground">
              BRIGHTLOOP SOFTWARE
              <br />
              IT DEPARTMENT
            </span>
          </div>
          <h1 className="retro m-0 text-5xl leading-tight text-xp [text-shadow:5px_5px_0_#000]">NETOPS</h1>
          <div className="retro mt-4 text-sm leading-relaxed text-primary [text-shadow:3px_3px_0_#000]">OFFICE NETWORK ENGINEER</div>
          <p className="mt-6 text-[17px] leading-relaxed text-muted-foreground">
            Run the network of a busy software company. Watch the office from above, take incident reports, investigate with real Cisco-style and Windows/Linux commands, fix the root cause — and keep everyone productive.
          </p>
          <ul className="feature-list">
            {FEATURES.map((f) => (
              <li key={f}>
                <span className="mt-2 size-2.5 shrink-0 bg-xp" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">PC game — play with a mouse and keyboard. All company names, people and incidents are fictional. Autosave is on: progress is saved {desktop ? 'to a file on this PC' : 'in this browser'}.</p>
        </section>

        <div ref={menuRef} className="flex justify-center">
          <MainMenu className="w-full max-w-[460px]" items={items} title="Main Menu" description={saved ? `SAVE: ${fmtDay(saved.s.t)} ${fmtClock(saved.s.t)}` : 'NEW HIRE · DAY 1'}>
            {saved && (
              <p className="retro mt-6 text-center text-[9px] leading-loose text-muted-foreground">
                {rankFor(saved.s.score).toUpperCase()}
                <br />
                SCORE {saved.s.score.toLocaleString()} · ${Math.round(saved.s.budget).toLocaleString()} · {saved.s.stats.resolved} FIXED
              </p>
            )}
            {options && (
              <div className="mt-6 flex flex-col gap-3">
                <label className="field">
                  Seed
                  <input type="text" className="mono" value={seed} placeholder="random" onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
                </label>
                <label className="row">
                  <input type="checkbox" checked={repro} onChange={(e) => setRepro(e.target.checked)} /> Reproducible mode (same seed → same incidents)
                </label>
              </div>
            )}
          </MainMenu>
        </div>
      </div>
    </main>
  );
}
