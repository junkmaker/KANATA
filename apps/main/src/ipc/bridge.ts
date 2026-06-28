import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import {
  clearFredApiKey,
  isEncryptionAvailable,
  isFredKeyConfigured,
  setFredApiKey,
} from '../lib/secrets.js';
import { getBackendUrl, getSidecarStatus, restartSidecar } from '../sidecar/pythonSidecar.js';
import { IPC_CHANNELS } from './channels.js';

export { IPC_CHANNELS };

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BACKEND_URL, () => getBackendUrl());
  ipcMain.handle(IPC_CHANNELS.BACKEND_STATUS, () => ({
    status: getSidecarStatus(),
    url: getBackendUrl(),
  }));
  ipcMain.handle(IPC_CHANNELS.OPEN_LOGS, async () => {
    const logsDir = join(app.getPath('userData'), 'logs');
    await shell.openPath(logsDir);
  });
  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    BrowserWindow.getFocusedWindow()?.close();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.FRED_KEY_STATUS, () => ({
    configured: isFredKeyConfigured(),
    encryptionAvailable: isEncryptionAvailable(),
  }));
  ipcMain.handle(IPC_CHANNELS.FRED_KEY_SET, async (_event, key: unknown) => {
    const saved = typeof key === 'string' ? setFredApiKey(key) : false;
    if (saved) await restartSidecar();
    return {
      configured: isFredKeyConfigured(),
      encryptionAvailable: isEncryptionAvailable(),
    };
  });
  ipcMain.handle(IPC_CHANNELS.FRED_KEY_CLEAR, async () => {
    const cleared = clearFredApiKey();
    if (cleared) await restartSidecar();
    return {
      configured: isFredKeyConfigured(),
      encryptionAvailable: isEncryptionAvailable(),
    };
  });
}
