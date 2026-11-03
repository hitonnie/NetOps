/** Bridge exposed by the desktop app's preload script (electron/preload.cjs). */
export interface DesktopBridge {
  /** Full path of the autosave file, for display. */
  saveLocation: string;
  readSave(): string | null;
  writeSave(json: string): boolean;
  clearSave(): boolean;
  openSaveFolder(): void;
}

/** Set when running as the installed desktop app; null in the browser and in tests. */
export const desktop: DesktopBridge | null = (typeof window !== 'undefined' && (window as Window & { netopsDesktop?: DesktopBridge }).netopsDesktop) || null;

/** How often the game autosaves while playing (it also saves when the window closes). */
export const AUTOSAVE_MS = 20_000;
