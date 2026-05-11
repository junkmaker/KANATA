import { useEffect, useRef } from 'react';
import type { DrawingObject, OHLCBar } from '../types';
import type { DataStatus } from './useChartData';
import { loadAlerts, markAlertTriggered } from '../lib/alertStorage';
import { checkAlertCondition } from '../lib/alertChecker';

export function useAlertCheck(
  drawings: DrawingObject[],
  data: Record<string, OHLCBar[]>,
  status: DataStatus,
): void {
  const checkedRef = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || checkedRef.current) return;
    checkedRef.current = true;

    const pending = loadAlerts().filter((a) => !a.triggered);
    if (pending.length === 0) return;

    const notify = async () => {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission !== 'granted') return;

      for (const alert of pending) {
        if (!checkAlertCondition(alert, drawings, data)) continue;
        const drawing = drawings.find((d) => d.id === alert.drawingId);
        const lineLabel = drawing?.type === 'hline' ? '水平線' : 'トレンドライン';
        const dirLabel = alert.direction === 'below' ? '下抜け' : '上抜け';
        new Notification('KANATA アラート', {
          body: `${alert.symbol}: ${lineLabel}を${dirLabel}しました`,
        });
        markAlertTriggered(alert.id);
      }
    };

    notify();
  }, [status, drawings, data]);
}
