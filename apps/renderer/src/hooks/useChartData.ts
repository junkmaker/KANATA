import { useEffect, useRef, useState } from 'react';
import { fetchQuotes } from '../lib/api';
import type { OHLCBar } from '../types';

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseChartDataResult {
  realData: Record<string, OHLCBar[]>;
  status: DataStatus;
  errors: Record<string, string>;
}

export function useChartData(symbols: string[], timeframe: string): UseChartDataResult {
  const [realData, setRealData] = useState<Record<string, OHLCBar[]>>({});
  const [status, setStatus] = useState<DataStatus>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (!symbols.length) {
      setStatus('idle');
      return;
    }
    let cancelled = false;

    setStatus('loading');

    const fetchAll = async () => {
      const results: Record<string, OHLCBar[]> = {};
      const errs: Record<string, string> = {};

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const bars = await fetchQuotes(symbol, timeframe);
            if (!cancelled && bars.length > 0) results[symbol] = bars;
          } catch (e) {
            if (!cancelled) errs[symbol] = e instanceof Error ? e.message : 'fetch error';
          }
        }),
      );

      if (cancelled) return;

      setRealData((prev) => ({ ...prev, ...results }));
      setErrors(errs);

      const allFailed = symbols.every((s) => errs[s]);
      if (!allFailed) {
        setStatus(Object.keys(results).length > 0 ? 'ready' : 'error');
      } else if (symbols.every((s) => errs[s]?.startsWith('404'))) {
        setStatus('idle');
      } else {
        setStatus('error');
      }
    };

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [symbolsKey, timeframe]);

  return { realData, status, errors };
}
