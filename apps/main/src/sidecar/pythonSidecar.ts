import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { app } from 'electron';
import { join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { reservePort } from '../lib/port.js';
import { sidecarLogger as log } from '../lib/logger.js';

const BACKEND_READY_TIMEOUT_MS = 20_000;
const MAX_BACKUPS = 7;

function backupDatabase(dbPath: string): void {
  if (!existsSync(dbPath)) return;

  const backupDir = join(app.getPath('userData'), 'backups');
  mkdirSync(backupDir, { recursive: true });

  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = join(backupDir, `kanata.db.${date}`);
  try {
    copyFileSync(dbPath, dest);
    log.info(`DB backed up to ${dest}`);
  } catch (err) {
    log.warn(`DB backup failed: ${String(err)}`);
    return;
  }

  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith('kanata.db.'))
    .map((f) => ({ name: f, mtime: statSync(join(backupDir, f)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  for (const file of files.slice(MAX_BACKUPS)) {
    try { unlinkSync(join(backupDir, file.name)); } catch { /* ignore */ }
  }
}
const MAX_RESTARTS = 2;
const HEALTH_CHECK_INTERVAL_MS = 500;

export type SidecarStatus = 'starting' | 'ready' | 'crashed' | 'offline';

type StatusChangeCallback = (status: SidecarStatus, url: string | null) => void;

interface SidecarState {
  process: ChildProcess | null;
  backendUrl: string | null;
  status: SidecarStatus;
  restartCount: number;
}

const state: SidecarState = {
  process: null,
  backendUrl: null,
  status: 'offline',
  restartCount: 0,
};

let onStatusChange: StatusChangeCallback | null = null;

export function setStatusChangeCallback(cb: StatusChangeCallback): void {
  onStatusChange = cb;
}

export function getSidecarStatus(): SidecarStatus {
  return state.status;
}

export function resolveBackendDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'backend');
  }
  const override = process.env.KANATA_BACKEND_DIR;
  if (override && existsSync(override)) return override;
  return join(app.getAppPath(), 'backend');
}

export function resolvePythonExecutable(): string {
  if (app.isPackaged) {
    const embedded = join(process.resourcesPath, 'python', 'python.exe');
    if (existsSync(embedded)) return embedded;
  }
  const override = process.env.KANATA_PYTHON;
  if (override && existsSync(override)) return override;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Health check timed out after ${timeoutMs}ms`));
        return;
      }
      const req = httpGet(`${url}/api/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(check, HEALTH_CHECK_INTERVAL_MS);
      });
      req.on('error', () => setTimeout(check, HEALTH_CHECK_INTERVAL_MS));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, HEALTH_CHECK_INTERVAL_MS);
      });
    };
    check();
  });
}

async function launchSidecar(): Promise<string> {
  const backendDir = resolveBackendDir();
  const python = resolvePythonExecutable();
  const port = await reservePort();

  const dbDir = join(app.getPath('userData'), 'kanata');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'kanata.db').replace(/\\/g, '/');

  backupDatabase(join(dbDir, 'kanata.db'));

  const pythonHome = app.isPackaged
    ? join(process.resourcesPath, 'python')
    : undefined;

  const args = [
    '-m', 'uvicorn', 'src.main:app',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--log-level', 'info',
  ];

  log.info(`Spawning ${python} ${args.join(' ')} (cwd=${backendDir})`);
  log.info(`DB path: sqlite:///${dbPath}`);

  const child = spawn(python, args, {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      DATABASE_URL: `sqlite:///${dbPath}`,
      KANATA_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
      ...(pythonHome ? { PYTHONHOME: pythonHome } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  state.process = child;
  state.status = 'starting';

  child.stdout?.on('data', (buf: Buffer) => {
    process.stdout.write(`[sidecar] ${buf.toString('utf8')}`);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    process.stdout.write(`[sidecar] ${buf.toString('utf8')}`);
  });

  const url = `http://127.0.0.1:${port}`;

  child.once('exit', (code, signal) => {
    log.warn(`exited code=${code} signal=${signal}`);
    state.process = null;
    state.backendUrl = null;

    if (state.status !== 'ready') return;

    state.status = 'crashed';

    if (state.restartCount < MAX_RESTARTS) {
      state.restartCount += 1;
      const delay = state.restartCount * 1000;
      log.info(`Restarting (attempt ${state.restartCount}/${MAX_RESTARTS}) in ${delay}ms`);
      setTimeout(() => {
        launchSidecar()
          .then((newUrl) => {
            state.backendUrl = newUrl;
            state.status = 'ready';
            onStatusChange?.('ready', newUrl);
          })
          .catch((err: unknown) => {
            log.error(`Restart failed: ${String(err)}`);
            state.status = 'crashed';
            onStatusChange?.('crashed', null);
          });
      }, delay);
    } else {
      log.error(`Max restarts (${MAX_RESTARTS}) exceeded`);
      onStatusChange?.('crashed', null);
    }
  });

  child.once('error', (err) => {
    log.error(`spawn error: ${String(err)}`);
    state.process = null;
    state.backendUrl = null;
  });

  await waitForHealth(url, BACKEND_READY_TIMEOUT_MS);
  log.info(`port=${port} — backend ready`);
  return url;
}

export async function startPythonSidecar(): Promise<string> {
  if (state.backendUrl) return state.backendUrl;
  state.restartCount = 0;
  try {
    const url = await launchSidecar();
    state.backendUrl = url;
    state.status = 'ready';
    onStatusChange?.('ready', url);
    return url;
  } catch (err) {
    state.status = 'crashed';
    onStatusChange?.('crashed', null);
    throw err;
  }
}

export function stopPythonSidecar(): void {
  const child = state.process;
  state.status = 'offline';
  if (!child) return;
  try {
    child.kill();
  } catch {
    if (process.platform === 'win32' && child.pid) {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } catch (e) {
        log.error(`taskkill failed: ${String(e)}`);
      }
    }
  }
  state.process = null;
  state.backendUrl = null;
}

export function getBackendUrl(): string | null {
  return state.backendUrl;
}
