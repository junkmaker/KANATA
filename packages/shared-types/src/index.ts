/**
 * Shared types between Electron main and renderer processes.
 *
 * Phase 1: Only contains types for Electron-specific surface (preload bridge).
 * Existing business types live in apps/renderer/src/types.ts until Phase 2
 * migrates them here alongside the Node/TS port of the backend.
 */

export interface PreloadApi {
  getBackendUrl: () => Promise<string | null>;
  platform: NodeJS.Platform;
  appVersion: string;
}

declare global {
  interface Window {
    kanata?: PreloadApi;
  }
}

export {};
