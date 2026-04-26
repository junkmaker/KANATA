export const IPC_CHANNELS = {
  BACKEND_URL:    'kanata:backend-url',
  BACKEND_STATUS: 'kanata:backend-status',
  OPEN_LOGS:      'kanata:open-logs',
  APP_VERSION:    'kanata:app-version',
  WINDOW_MINIMIZE:         'kanata:window-minimize',
  WINDOW_MAXIMIZE:         'kanata:window-maximize',
  WINDOW_CLOSE:            'kanata:window-close',
  WINDOW_IS_MAXIMIZED:     'kanata:window-is-maximized',
  WINDOW_MAXIMIZE_CHANGED: 'kanata:window-maximize-changed',
} as const;
