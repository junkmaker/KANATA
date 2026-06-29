export type SidecarStatus = 'starting' | 'ready' | 'crashed' | 'offline';

export interface BackendStatusPayload {
  status: SidecarStatus;
  url: string | null;
  error?: string;
}

export interface FredKeyStatus {
  configured: boolean;
  encryptionAvailable: boolean;
}

export interface PreloadApi {
  getBackendUrl: () => Promise<string | null>;
  getBackendStatus: () => Promise<BackendStatusPayload>;
  openLogs: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  onBackendStatus: (cb: (payload: BackendStatusPayload) => void) => () => void;
  platform: NodeJS.Platform;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void;
  getFredKeyStatus: () => Promise<FredKeyStatus>;
  setFredKey: (key: string) => Promise<FredKeyStatus>;
  clearFredKey: () => Promise<FredKeyStatus>;
}

declare global {
  interface Window {
    kanata?: PreloadApi;
  }
}
