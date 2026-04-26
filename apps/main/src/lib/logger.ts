import { app } from 'electron';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';

type Level = 'info' | 'warn' | 'error';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATIONS = 3;

function rotateLog(logPath: string): void {
  if (!existsSync(logPath)) return;
  if (statSync(logPath).size < MAX_LOG_BYTES) return;

  for (let i = MAX_ROTATIONS; i >= 1; i--) {
    const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
    const to   = `${logPath}.${i}`;
    if (existsSync(from)) {
      try { renameSync(from, to); } catch { /* ignore */ }
    }
  }
}

function makeWriter(name: string): WriteStream {
  const logDir  = join(app.getPath('userData'), 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${name}.log`);
  rotateLog(logPath);
  return createWriteStream(logPath, { flags: 'a' });
}

const mainStream:    WriteStream | null = app.isPackaged ? makeWriter('main')    : null;
const sidecarStream: WriteStream | null = app.isPackaged ? makeWriter('sidecar') : null;

function write(stream: WriteStream | null, level: Level, tag: string, msg: string): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${tag}] ${msg}\n`;
  if (stream) stream.write(line);
  else process.stdout.write(line);
}

export const mainLogger = {
  info:  (msg: string) => write(mainStream,    'info',  'main',    msg),
  warn:  (msg: string) => write(mainStream,    'warn',  'main',    msg),
  error: (msg: string) => write(mainStream,    'error', 'main',    msg),
};

export const sidecarLogger = {
  info:  (msg: string) => write(sidecarStream, 'info',  'sidecar', msg),
  warn:  (msg: string) => write(sidecarStream, 'warn',  'sidecar', msg),
  error: (msg: string) => write(sidecarStream, 'error', 'sidecar', msg),
};
