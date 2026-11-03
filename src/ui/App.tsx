import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOSAVE_MS } from '../core/platform';
import type { Camera } from '../render/renderer';
import { Game } from '../sim/game';
import { BH, BW, T } from '../world/layout';
import { Ctx, type DrawerId, type UiApi, type UiState } from './ctx';
import { DeviceWindow } from './DevicePanel';
import { Drawer } from './Drawers';
import { DayModal, Dock, EmployeeCard, MapControls, ShortcutsModal, Toasts } from './Hud';
import { IncidentPanel } from './IncidentPanel';
import { clampCam, fitCenter, fitZoom, OfficeView } from './OfficeView';
import { PcGate } from './PcGate';
import { StartScreen } from './StartScreen';
import { TopBar } from './TopBar';
import { Tutorial } from './Tutorial';

export function App() {
  return (
    <PcGate>
      <Screens />
    </PcGate>
  );
}

function Screens() {
  const [game, setGame] = useState<Game | null>(null);
  const [gen, setGen] = useState(0);
  if (!game) return <StartScreen onStart={(g) => { setGame(g); setGen((n) => n + 1); }} />;
  return (
    <GameScreen
      key={gen}
      game={game}
      restart={(g) => {
        setGame(g ?? null);
        setGen((n) => n + 1);
      }}
    />
  );
}

const INITIAL_UI: UiState = {
  drawer: null,
  windows: [],
  focusedWin: null,
  selected: null,
  selectedEmp: null,
  cables: 'auto',
  overlay: 'none',
  expandedIncident: null,
  manualArticle: null,
  inboxSel: null,
  showShortcuts: false,
  daySummary: null,
};

const DRAWER_KEYS: Record<string, DrawerId> = { i: 'inbox', t: 'tasks', b: 'shop', m: 'manager', h: 'manual', n: 'network', l: 'feed' };

function GameScreen({ game, restart }: { game: Game; restart: (g?: Game) => void }) {
  const [ui, setUiState] = useState<UiState>(INITIAL_UI);
  const cameraRef = useRef<Camera>({ x: (BW * T) / 2, y: (BH * T) / 2, zoom: 0.8 });
  const zSeq = useRef(1);
  const lastSpeed = useRef(1);
  const setUi = useCallback((fn: (u: UiState) => UiState) => setUiState(fn), []);

  const flyTo = useCallback((x: number, y: number, zoom?: number) => {
    const cam = cameraRef.current;
    const from = { ...cam };
    const to = { x, y, zoom: zoom ?? Math.max(cam.zoom, 1.4) };
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 380);
      const e = 1 - (1 - k) ** 3;
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      cam.zoom = from.zoom + (to.zoom - from.zoom) * e;
      clampCam(cam);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const api: UiApi = useMemo(
    () => ({
      game,
      ui,
      setUi,
      cameraRef,
      flyTo,
      restart,
      openDevice: (devId, tab) => {
        game.flag('selected-device');
        game.flag(`opened-${devId}`);
        game.markViewed(devId);
        setUiState((u) => {
          const existing = u.windows.find((w) => w.devId === devId);
          const z = zSeq.current++;
          if (existing) return { ...u, selected: devId, focusedWin: existing.id, windows: u.windows.map((w) => (w.id === existing.id ? { ...w, z, tab: tab ?? w.tab } : w)) };
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const w = Math.min(880, vw - 40);
          // keep clear of the tutorial coach (bottom centre) while the tutorial runs
          const tut = game.s.tutorial.active && !game.s.tutorial.done;
          const h = Math.max(340, Math.min(680, vh - 120 - (tut ? 270 : 0)));
          const n = u.windows.length;
          const x = Math.max(106, Math.min(vw - w - 20, vw - w - 436)) + n * 28;
          const y = 76 + n * 28;
          const win = { id: `w${z}-${devId}`, devId, tab: tab ?? 'overview', x: Math.max(0, Math.min(x, vw - w)), y: Math.min(y, vh - 200), w, h, z };
          const windows = [...u.windows, win].slice(-3);
          return { ...u, selected: devId, focusedWin: win.id, windows };
        });
      },
      closeWindow: (id) => setUiState((u) => ({ ...u, windows: u.windows.filter((w) => w.id !== id), focusedWin: u.focusedWin === id ? null : u.focusedWin })),
      focusWindow: (id) => setUiState((u) => ({ ...u, focusedWin: id, windows: u.windows.map((w) => (w.id === id ? { ...w, z: zSeq.current++ } : w)) })),
      setDrawer: (d) => setUiState((u) => ({ ...u, drawer: d })),
      openManual: (a) => setUiState((u) => ({ ...u, drawer: 'manual', manualArticle: a })),
      select: (devId) => setUiState((u) => ({ ...u, selected: devId })),
      selectEmp: (id) => setUiState((u) => ({ ...u, selectedEmp: id })),
    }),
    [game, ui, setUi, flyTo, restart],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const cam = cameraRef.current;
      const k = e.key.toLowerCase();
      const pan = 70 / cam.zoom;
      if (k === ' ') {
        e.preventDefault();
        if (game.s.speed > 0) {
          lastSpeed.current = game.s.speed;
          game.setSpeed(0);
        } else game.setSpeed(lastSpeed.current || 1);
        return;
      }
      if (/^[1-5]$/.test(k)) {
        game.setSpeed(Number(k));
        return;
      }
      if (k === 'w' || k === 'arrowup') cam.y -= pan;
      else if (k === 's' || k === 'arrowdown') cam.y += pan;
      else if (k === 'a' || k === 'arrowleft') cam.x -= pan;
      else if (k === 'd' || k === 'arrowright') cam.x += pan;
      else if (k === '+' || k === '=') cam.zoom *= 1.2;
      else if (k === '-' || k === '_') cam.zoom /= 1.2;
      else if (k === '0') {
        cam.zoom = fitZoom(window.innerWidth, window.innerHeight - 60);
        Object.assign(cam, fitCenter(cam.zoom));
      } else if (k === 'c') setUiState((u) => ({ ...u, cables: u.cables === 'auto' ? 'all' : u.cables === 'all' ? 'off' : 'auto' }));
      else if (k === '?') setUiState((u) => ({ ...u, showShortcuts: true }));
      else if (DRAWER_KEYS[k]) {
        const d = DRAWER_KEYS[k];
        setUiState((u) => ({ ...u, drawer: u.drawer === d ? null : d }));
      } else if (k === 'escape') {
        setUiState((u) => {
          if (u.showShortcuts) return { ...u, showShortcuts: false };
          if (u.windows.length) {
            const top = [...u.windows].sort((a, b) => b.z - a.z)[0];
            return { ...u, windows: u.windows.filter((w) => w.id !== top.id) };
          }
          if (u.drawer) return { ...u, drawer: null };
          return { ...u, selected: null, selectedEmp: null };
        });
      } else return;
      // consume handled keys so they don't also type into a freshly focused input
      e.preventDefault();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) game.flag('panned');
      if (['+', '=', '-', '_'].includes(k)) game.flag('zoomed');
      clampCam(cam);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  // dev-only handle for debugging scenarios from the console: __game.spawnScenario(...)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  }, [game]);

  // autosave & day summaries
  useEffect(() => {
    const iv = setInterval(() => game.save(), AUTOSAVE_MS);
    const onHide = () => game.save();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    const off = game.onEvent((e) => {
      if (e.type === 'flag' && e.name === 'day-ended' && !game.skipping) {
        const last = game.s.days[game.s.days.length - 1];
        if (last) setUiState((u) => ({ ...u, daySummary: last.day }));
      }
      if (e.type === 'flag' && e.name === 'day-ended') {
        // allow the summary again for the next day
        delete game.s.tutorial.flags['day-ended'];
      }
    });
    return () => {
      clearInterval(iv);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
      off();
      game.save();
    };
  }, [game]);

  return (
    <Ctx.Provider value={api}>
      <div className="app">
        <TopBar />
        <div className="main">
          <OfficeView />
          <Dock />
          <MapControls />
          <IncidentPanel />
          <Drawer />
          {ui.windows.map((w) => (
            <DeviceWindow key={w.id} w={w} />
          ))}
          <EmployeeCard />
          <Toasts />
          <Tutorial />
        </div>
        <ShortcutsModal />
        <DayModal />
      </div>
    </Ctx.Provider>
  );
}
