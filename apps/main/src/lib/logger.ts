import { app } from 'electron';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';

type Level = 'info' | 'warn' | 'error';

function makeWriter(name: string): WriteStream {
  const logDir = join(app.getPath('userData'), 'logs');
  mkdirSync(logDir, { recursive: true });
  return createWriteStream(join(logDir, `${name}.log`), { flags: 'a' });
}

const mainStream: WriteStream | null = app.isPackaged ? makeWriter('main') : null;
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
