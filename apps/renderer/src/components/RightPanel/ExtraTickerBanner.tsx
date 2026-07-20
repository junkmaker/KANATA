import { useState } from 'react';
import type { Ticker } from '../../types';

interface ExtraTickerBannerProps {
  ticker: Ticker;
  onAdd: () => Promise<void>;
}

export function ExtraTickerBanner({ ticker, onAdd }: ExtraTickerBannerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onAdd();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '追加に失敗しました';
      if (msg.includes('409') || msg.includes('already')) {
        setError(`${ticker.code} は既にリストにあります`);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="extra-ticker-banner">
      <div className="extra-ticker-meta">
        <span className="extra-ticker-code">
          {ticker.code}
          <span className="tick-mkt">{ticker.market}</span>
        </span>
        <span className="extra-ticker-name">{ticker.name}</span>
      </div>
      <button
        type="button"
        className="extra-ticker-add-btn"
        onClick={handleAdd}
        disabled={submitting}
      >
        {submitting ? '追加中…' : '＋リストに追加'}
      </button>
      {error && <div className="add-symbol-error">{error}</div>}
    </div>
  );
}
