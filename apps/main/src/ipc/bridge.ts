import { ipcMain, shell, app } from 'electron';
import { join } from 'node:path';
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
}
