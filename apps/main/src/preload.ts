import { contextBridge, ipcRenderer } from 'electron';
import type { PreloadApi, BackendStatusPayload } from '@kanata/shared-types';
import { IPC_CHANNELS } from './ipc/channels.js';

const api: PreloadApi = {
  getBackendUrl:    () => ipcRenderer.invoke(IPC_CHANNELS.BACKEND_URL),
  getBackendStatus: () => ipcRenderer.invoke(IPC_CHANNELS.BACKEND_STATUS),
  openLogs:         () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOGS),
  getAppVersion:    () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
  onBackendStatus: (cb) => {
    const handler = (_event: unknown, payload: BackendStatusPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.BACKEND_STATUS, handler as Parameters<typeof ipcRenderer.on>[1]);
    return () => ipcRenderer.off(IPC_CHANNELS.BACKEND_STATUS, handler as Parameters<typeof ipcRenderer.off>[1]);
  },
  platform: process.platform,
};

try {
  contextBridge.exposeInMainWorld('kanata', api);
} catch (err) {
  console.error('[preload] Failed to expose kanata API:', err);
}
