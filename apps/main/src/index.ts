import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { startPythonSidecar, stopPythonSidecar, setStatusChangeCallback } from './sidecar/pythonSidecar.js';
import type { BackendStatusPayload } from '@kanata/shared-types';
import { registerIpcHandlers, IPC_CHANNELS } from './ipc/bridge.js';

const isDev = !app.isPackaged;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

function notifySidecarStatus(payload: BackendStatusPayload): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(IPC_CHANNELS.BACKEND_STATUS, payload);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0d12',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDev && rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function bootstrap(): Promise<void> {
  registerIpcHandlers();

  setStatusChangeCallback((status, url) => {
    notifySidecarStatus({ status, url });
  });

  try {
    const url = await startPythonSidecar();
    console.log(`[main] Python backend ready at ${url}`);
  } catch (err) {
    console.error('[main] Failed to start Python sidecar:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(bootstrap).catch((err) => {
  console.error('[main] bootstrap failed:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonSidecar();
});
