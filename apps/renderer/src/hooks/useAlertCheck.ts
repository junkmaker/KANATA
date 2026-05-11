import { useEffect, useRef } from 'react';
import { checkAlertCondition } from '../lib/alertChecker';
import { loadAlerts, markAlertTriggered } from '../lib/alertStorage';
import { fetchQuotes } from '../lib/api';
import type { DrawingObject, OHLCBar } from '../types';
import type { DataStatus } from './useChartData';

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

      // Fetch price data for alert symbols not in the active watchlist
      const missingSymbols = [
        ...new Set(pending.map((a) => a.symbol).filter((s) => !data[s])),
      ];
      const extraData: Record<string, OHLCBar[]> = {};
      await Promise.all(
        missingSymbols.map(async (symbol) => {
          try {
            const bars = await fetchQuotes(symbol, '1D');
            if (bars.length > 0) extraData[symbol] = bars;
          } catch {
            /* skip symbols that fail to fetch */
          }
        }),
      );
      const allData = { ...extraData, ...data };

      for (const alert of pending) {
        if (!checkAlertCondition(alert, drawings, allData)) continue;
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
