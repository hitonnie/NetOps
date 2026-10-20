import { useEffect } from 'react';
import { isUnsaved } from '../net/config';
import type { Game } from '../sim/game';
import { useGameTick, useUi } from './ctx';
import { Icon } from './icons';

interface Step {
  title: string;
  body: string;
  done?: (g: Game) => boolean;
  onEnter?: (g: Game) => void;
  button?: string;
}

const f = (g: Game, n: string) => !!g.s.tutorial.flags[n];

export const STEPS: Step[] = [
  {
    title: 'Welcome to the NOC',
    body: "You're the network engineer at Brightloop Software. People will start arriving around 07:00. When the network breaks, they can't work — that's where you come in. This short tutorial walks you through one real incident.",
    button: "Let's go",
  },
  {
    title: 'Look around the office',
    body: 'Drag to pan and use the mouse wheel (or pinch) to zoom. Keyboard: W A S D / arrow keys pan, + and − zoom, 0 fits the office.',
    done: (g) => f(g, 'panned') && f(g, 'zoomed'),
    button: 'Skip',
  },
  {
    title: 'Time controls',
    body: 'The clock is at the top. Space pauses; 1–5 change speed (1× to 16×). New incidents automatically slow the game back down.',
    done: (g) => f(g, 'speed-changed'),
    button: 'Next',
  },
  {
    title: 'Inspect a device',
    body: 'Click any device to open its inspection window — try NOC-PC, your own workstation in Network Operations (top right of the office). You can also find every device in the Network panel (N).',
    done: (g) => f(g, 'selected-device'),
    button: 'Skip',
  },
  {
    title: 'An incident comes in',
    body: 'A user just reported a problem — it appears top right. Click the incident card to expand it and read the symptom.',
    onEnter: (g) => g.flag('tutorial-incident'),
    done: (g) => f(g, 'incident-viewed') && g.s.incidents.length > 0,
  },
  {
    title: "Go to the user's PC",
    body: "Alex Kim sits at desk ENG-01 in Engineering. Click 'Go to desk' on the incident card, or click Alex's PC in the office.",
    done: (g) => f(g, 'opened-pc-eng-01'),
  },
  {
    title: 'Check the IP configuration',
    body: "In Alex's PC window open the Terminal tab and run:  ipconfig",
    done: (g) => f(g, 'cmd-ipconfig'),
  },
  {
    title: 'Follow the cable',
    body: '"Media disconnected" means the PC has no link at all — a physical/layer-2 problem. The Overview tab\'s Cabling table shows where the desk is patched: SW-ENG port Gi1/0/1. Click the SW-ENG link (or the switch cabinet on the map).',
    done: (g) => f(g, 'opened-sw-eng'),
  },
  {
    title: 'Ask the switch',
    body: 'Open SW-ENG\'s CLI tab and type:  enable  then  show ip interface brief   (abbreviations like "sh ip int br" work too; press ? for help).',
    done: (g) => f(g, 'cmd-show-int'),
  },
  {
    title: 'Fix the root cause',
    body: 'Gi1/0/1 is "administratively down" — someone shut it. Bring it up:\n  configure terminal\n  interface gi1/0/1\n  no shutdown\n  end',
    done: (g) => f(g, 'incident-fixed'),
  },
  {
    title: 'Verify, then close',
    body: "Good — the port is up. Confirm it from the user's side (e.g. ping 10.10.10.1 on Alex's PC), then press \"Verify & close\" on the incident card.",
    done: (g) => f(g, 'incident-verified'),
  },
  {
    title: 'Save your work',
    body: 'Your change lives only in running-config. If SW-ENG reboots, it is lost. In the SW-ENG CLI type:  write memory   (or: copy running-config startup-config).',
    done: (g) => !isUnsaved(g.dev('sw-eng')),
    button: 'Skip',
  },
  {
    title: "You're on your own now",
    body: 'Incidents will arrive at a realistic pace. Use the Inbox (I) for user reports, Tasks (T) for checklists and requests, the Shop (B) for spares and upgrades, the Manager panel (M) and the Manual (H) when stuck. Hints are on each incident card. Good luck!',
    button: 'Start the day',
  },
];

export function Tutorial() {
  const { game } = useUi();
  useGameTick(game);
  const t = game.s.tutorial;
  const step = STEPS[t.step];
  useEffect(() => {
    if (!t.active || t.done || !step) return;
    step.onEnter?.(game);
  }, [t.step, t.active, t.done, game, step]);
  useEffect(() => {
    if (!t.active || t.done || !step?.done) return;
    if (step.done(game)) {
      t.step++;
      game.touch();
    }
  });
  if (!t.active || t.done || !step) return null;
  const finish = () => {
    t.done = true;
    t.active = false;
    game.s.director.nextAt = Math.max(game.s.t + 35, game.s.director.nextAt === 8 * 60 + 25 ? game.s.t + 35 : game.s.director.nextAt);
    game.touch();
  };
  const next = () => {
    if (t.step >= STEPS.length - 1) finish();
    else {
      t.step++;
      game.touch();
    }
  };
  return (
    <div className="coach" role="dialog" aria-live="polite" aria-label="Tutorial">
      <div className="row">
        <Icon name="help" size={20} style={{ color: 'var(--accent)' }} />
        <h3 className="grow">{step.title}</h3>
        <span className="progress">
          {t.step + 1}/{STEPS.length}
        </span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{step.body}</p>
      <div className="row">
        <button className="btn small ghost" onClick={finish}>
          Skip tutorial
        </button>
        <span className="grow" />
        {step.button && (
          <button className="btn small primary" onClick={next}>
            {step.button}
          </button>
        )}
        {!step.button && <span className="dim" style={{ fontSize: 14 }}>Do it to continue…</span>}
      </div>
    </div>
  );
}
