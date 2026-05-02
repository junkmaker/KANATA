import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { getBackendUrl, getSidecarStatus } from '../sidecar/pythonSidecar.js';
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
}
