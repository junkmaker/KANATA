import { ipcMain } from 'electron';
import { getBackendUrl } from '../sidecar/pythonSidecar.js';
import { IPC_CHANNELS } from './channels.js';

export { IPC_CHANNELS };

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BACKEND_URL, () => getBackendUrl());
}
