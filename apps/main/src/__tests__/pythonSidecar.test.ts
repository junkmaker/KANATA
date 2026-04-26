import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { app } from 'electron';
import { resolveBackendDir, resolvePythonExecutable } from '../sidecar/pythonSidecar.js';

// vi.hoisted ensures this variable is available inside the vi.mock factory
const existsSyncFn = vi.hoisted(() => vi.fn<(p: unknown) => boolean>());

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>();
  return { ...mod, existsSync: existsSyncFn };
});

describe('resolveBackendDir', () => {
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  beforeEach(() => {
    existsSyncFn.mockReset();
    (app as typeof app & { isPackaged: boolean }).isPackaged = false;
  });

  afterEach(() => {
    delete process.env.KANATA_BACKEND_DIR;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
  });

  it('dev: KANATA_BACKEND_DIR 未設定 → appPath/backend を含む', () => {
    existsSyncFn.mockReturnValue(false);
    const result = resolveBackendDir();
    expect(result).toContain('backend');
    expect(result).toContain('mock');
  });

  it('dev: KANATA_BACKEND_DIR が存在するパス → それを返す', () => {
    process.env.KANATA_BACKEND_DIR = '/custom/backend';
    existsSyncFn.mockImplementation((p) => p === '/custom/backend');
    expect(resolveBackendDir()).toBe('/custom/backend');
  });

  it('packaged: resourcesPath/backend を返す', () => {
    (app as typeof app & { isPackaged: boolean }).isPackaged = true;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = '/app/resources';
    expect(resolveBackendDir()).toBe(join('/app/resources', 'backend'));
  });
});

describe('resolvePythonExecutable', () => {
  const originalPlatform = process.platform;
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  beforeEach(() => {
    existsSyncFn.mockReset();
    (app as typeof app & { isPackaged: boolean }).isPackaged = false;
  });

  afterEach(() => {
    delete process.env.KANATA_PYTHON;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
  });

  it('dev: KANATA_PYTHON 未設定 + win32 → "python" を返す', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    existsSyncFn.mockReturnValue(false);
    expect(resolvePythonExecutable()).toBe('python');
  });

  it('dev: KANATA_PYTHON が存在するパス → それを返す', () => {
    process.env.KANATA_PYTHON = '/usr/bin/python3.12';
    existsSyncFn.mockImplementation((p) => p === '/usr/bin/python3.12');
    expect(resolvePythonExecutable()).toBe('/usr/bin/python3.12');
  });

  it('packaged: embedded python.exe が存在する → そのパスを返す', () => {
    (app as typeof app & { isPackaged: boolean }).isPackaged = true;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = '/app/resources';
    existsSyncFn.mockReturnValue(true);
    expect(resolvePythonExecutable()).toBe(join('/app/resources', 'python', 'python.exe'));
  });
});
