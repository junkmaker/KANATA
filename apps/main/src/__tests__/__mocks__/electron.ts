import { vi } from 'vitest';

export const app = {
  isPackaged: false as boolean,
  getAppPath: vi.fn((): string => '/mock/appPath'),
  getPath: vi.fn((_name: string): string => '/mock/userData'),
};
