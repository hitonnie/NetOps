import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Camera } from '../render/renderer';
import type { Game } from '../sim/game';

export type DrawerId = 'inbox' | 'tasks' | 'shop' | 'manager' | 'manual' | 'network' | 'feed' | 'settings';

export interface DevWindow {
  id: string;
  devId: string;
  tab: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface UiState {
  drawer: DrawerId | null;
  windows: DevWindow[];
  focusedWin: string | null;
  selected: string | null;
  selectedEmp: string | null;
  cables: 'auto' | 'all' | 'off';
  overlay: 'none' | 'wifi' | 'health';
  expandedIncident: string | null;
  manualArticle: string | null;
  inboxSel: string | null;
  showShortcuts: boolean;
  daySummary: number | null;
}

export interface UiApi {
  game: Game;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  openDevice: (devId: string, tab?: string) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  setDrawer: (d: DrawerId | null) => void;
  openManual: (article: string) => void;
  select: (devId: string | null) => void;
  selectEmp: (id: string | null) => void;
  flyTo: (x: number, y: number, zoom?: number) => void;
  cameraRef: { current: Camera };
  /** go to the title screen, or switch to a freshly created game */
  restart: (g?: Game) => void;
}

export const Ctx = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('no ui context');
  return c;
}

/** Re-render when the game notifies (throttled to ~4 Hz plus discrete events). */
export function useGameTick(game: Game): number {
  return useSyncExternalStore(game.subscribe, game.getVersion);
}
