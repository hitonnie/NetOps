/**
 * NetOps desktop shell (Electron).
 *
 * Serves the same production build the browser version uses (dist/) from a
 * private app://netops origin inside a locked-down window: no Node access in
 * the page, no navigation away from the game, no permission prompts.
 * Autosave writes a real file: %APPDATA%\NetOps\saves\autosave.json (plus a backup of the
 * previous save), through the small bridge in preload.cjs.
 *
 * Set NETOPS_DEV_URL=http://localhost:5173 to point the window at the Vite dev server instead.
 */
const { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://netops';
const DEV_URL = process.env.NETOPS_DEV_URL || '';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.hitonnie.netops');

/** @type {BrowserWindow | null} */
let win = null;

function serveGame() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'netops') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', CSP);
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Only the game page itself may use the save bridge. */
function trusted(e) {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(ORIGIN) || (DEV_URL !== '' && url.startsWith(DEV_URL));
}

function registerSaveFile() {
  const dir = path.join(app.getPath('userData'), 'saves');
  const file = path.join(dir, 'autosave.json');
  const backup = path.join(dir, 'autosave.backup.json');
  const readValid = (p) => {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      JSON.parse(raw);
      return raw;
    } catch {
      return null;
    }
  };
  ipcMain.on('netops:save-location', (e) => {
    e.returnValue = trusted(e) ? file : '';
  });
  ipcMain.on('netops:save-read', (e) => {
    // a damaged save falls back to the previous one
    e.returnValue = trusted(e) ? (readValid(file) ?? readValid(backup)) : null;
  });
  ipcMain.on('netops:save-write', (e, json) => {
    if (!trusted(e) || typeof json !== 'string' || json.length > 50_000_000) {
      e.returnValue = false;
      return;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, json);
      if (fs.existsSync(file)) fs.copyFileSync(file, backup);
      fs.renameSync(tmp, file); // atomic replace: a crash mid-save never leaves a half-written file
      e.returnValue = true;
    } catch {
      e.returnValue = false;
    }
  });
  ipcMain.on('netops:save-clear', (e) => {
    if (!trusted(e)) {
      e.returnValue = false;
      return;
    }
    for (const f of [file, backup]) fs.rmSync(f, { force: true });
    e.returnValue = true;
  });
  ipcMain.on('netops:save-open-folder', (e) => {
    if (!trusted(e)) return;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0e',
    title: 'NetOps: Office Network Engineer',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => {
    win?.maximize();
    win?.show();
  });

  const wc = win.webContents;
  // keep the player inside the game; real web links open in the default browser
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !win) return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === 'F12' && !app.isPackaged) {
      wc.toggleDevTools();
      e.preventDefault();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  win.loadURL(DEV_URL || `${ORIGIN}/index.html`);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  serveGame();
  registerSaveFile();
  createWindow();
});

// make sure the last autosave reaches disk before the process exits
app.on('before-quit', () => session.defaultSession.flushStorageData());
app.on('window-all-closed', () => app.quit());
