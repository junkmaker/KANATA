import type { AlertObject } from '../types';

const STORAGE_KEY = 'kanata.alerts';

export function loadAlerts(): AlertObject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: AlertObject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    /* noop */
  }
}

export function addAlert(alert: AlertObject): void {
  saveAlerts([...loadAlerts(), alert]);
}

export function markAlertTriggered(id: string): void {
  saveAlerts(loadAlerts().map((a) => (a.id === id ? { ...a, triggered: true } : a)));
}

export function removeAlert(id: string): void {
  saveAlerts(loadAlerts().filter((a) => a.id !== id));
}
