import { useEffect, useRef } from 'react';
import { checkAlertCondition } from '../lib/alertChecker';
import { loadAlerts, markAlertTriggered } from '../lib/alertStorage';
import { fetchQuotes } from '../lib/api';
import type { DrawingObject, OHLCBar } from '../types';
import type { DataStatus } from './useChartData';

/**
 * アラートは起動時のチャートのタイムフレームに関係なく日足で判定する。
 * 分足で起動すると取得範囲が数十日しかなく、日足で引いたトレンドラインの端点が範囲外へ外挿されて
 * 線の値が大きく狂う（時刻を持たない旧データはバー番号が分足として読まれる）ため。
 */
const ALERT_TIMEFRAME = '1D';

export function useAlertCheck(
  drawings: DrawingObject[],
  data: Record<string, OHLCBar[]>,
  status: DataStatus,
  timeframe: string,
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

      // チャートが日足のときだけ取得済みデータを使い回し、それ以外は日足を取り直す
      const dailyData = timeframe === ALERT_TIMEFRAME ? data : {};
      const missingSymbols = [
        ...new Set(pending.map((a) => a.symbol).filter((s) => !dailyData[s])),
      ];
      const extraData: Record<string, OHLCBar[]> = {};
      await Promise.all(
        missingSymbols.map(async (symbol) => {
          try {
            const bars = await fetchQuotes(symbol, ALERT_TIMEFRAME);
            if (bars.length > 0) extraData[symbol] = bars;
          } catch {
            /* skip symbols that fail to fetch */
          }
        }),
      );
      const allData = { ...extraData, ...dailyData };

      for (const alert of pending) {
        if (!checkAlertCondition(alert, drawings, allData, ALERT_TIMEFRAME)) continue;
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
  }, [status, drawings, data, timeframe]);
}
