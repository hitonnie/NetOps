/**
 * Desktop-only bridge: gives the game a real autosave file on disk.
 * This is the only thing the page can reach outside the browser sandbox.
 * Calls are synchronous so the final save on close finishes before the window goes away.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('netopsDesktop', {
  saveLocation: ipcRenderer.sendSync('netops:save-location'),
  readSave: () => ipcRenderer.sendSync('netops:save-read'),
  writeSave: (json) => ipcRenderer.sendSync('netops:save-write', json),
  clearSave: () => ipcRenderer.sendSync('netops:save-clear'),
  openSaveFolder: () => ipcRenderer.send('netops:save-open-folder'),
});
