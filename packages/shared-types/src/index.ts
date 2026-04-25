export type SidecarStatus = 'starting' | 'ready' | 'crashed' | 'offline';

export interface BackendStatusPayload {
  status: SidecarStatus;
  url: string | null;
  error?: string;
}

export interface PreloadApi {
  getBackendUrl:    () => Promise<string | null>;
  getBackendStatus: () => Promise<BackendStatusPayload>;
  openLogs:         () => Promise<void>;
  onBackendStatus:  (cb: (payload: BackendStatusPayload) => void) => () => void;
  platform:    NodeJS.Platform;
  appVersion:  string;
}

declare global {
  interface Window {
    kanata?: PreloadApi;
  }
}

export {};
