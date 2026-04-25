import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels.js';

type PreloadApi = {
  getBackendUrl: () => Promise<string | null>;
  platform: NodeJS.Platform;
  appVersion: string;
};

const api: PreloadApi = {
  getBackendUrl: () => ipcRenderer.invoke(IPC_CHANNELS.BACKEND_URL),
  platform: process.platform,
  appVersion: process.env.npm_package_version ?? '0.0.0',
};

try {
  contextBridge.exposeInMainWorld('kanata', api);
} catch (err) {
  console.error('[preload] Failed to expose kanata API:', err);
}
