import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const BACKEND_READY_TIMEOUT_MS = 20_000;
const PORT_REGEX = /Uvicorn running on http:\/\/127\.0\.0\.1:(\d+)/;

interface SidecarState {
  process: ChildProcess | null;
  backendUrl: string | null;
}

const state: SidecarState = {
  process: null,
  backendUrl: null,
};

function resolveBackendDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'backend');
  }
  const override = process.env.KANATA_BACKEND_DIR;
  if (override && existsSync(override)) return override;
  return join(app.getAppPath(), 'backend');
}

function resolvePythonExecutable(): string {
  if (app.isPackaged) {
    const embedded = join(process.resourcesPath, 'python', 'python.exe');
    if (existsSync(embedded)) return embedded;
  }
  const override = process.env.KANATA_PYTHON;
  if (override && existsSync(override)) return override;
  return process.platform === 'win32' ? 'python' : 'python3';
}

export function startPythonSidecar(): Promise<string> {
  if (state.backendUrl) return Promise.resolve(state.backendUrl);

  const backendDir = resolveBackendDir();
  const python = resolvePythonExecutable();

  const args = [
    '-m',
    'uvicorn',
    'src.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--log-level',
    'info',
  ];

  console.log(`[sidecar] Spawning ${python} ${args.join(' ')} (cwd=${backendDir})`);

  const dbPath = join(app.getPath('userData'), 'kanata.db').replace(/\\/g, '/');

  const child = spawn(python, args, {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      DATABASE_URL: `sqlite:///${dbPath}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  state.process = child;

  return new Promise<string>((fulfil, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Python sidecar did not report a listening port within timeout'));
    }, BACKEND_READY_TIMEOUT_MS);

    const scanForPort = (buf: Buffer): void => {
      const text = buf.toString('utf8');
      process.stdout.write(`[sidecar] ${text}`);
      const match = PORT_REGEX.exec(text);
      if (match && !state.backendUrl) {
        const port = Number(match[1]);
        const url = `http://127.0.0.1:${port}`;
        state.backendUrl = url;
        clearTimeout(timer);
        fulfil(url);
      }
    };

    child.stdout?.on('data', scanForPort);
    child.stderr?.on('data', scanForPort);

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      state.process = null;
      state.backendUrl = null;
      console.warn(`[sidecar] exited code=${code} signal=${signal}`);
    });
  });
}

export function stopPythonSidecar(): void {
  const child = state.process;
  if (!child) return;
  try {
    child.kill();
  } catch (err) {
    console.error('[sidecar] Failed to kill subprocess:', err);
  }
  state.process = null;
  state.backendUrl = null;
}

export function getBackendUrl(): string | null {
  return state.backendUrl;
}
