import { SIGNAL_LABELS } from '../../lib/patternView';
import type { PatternSignal } from '../../types';

// 色は CSS 変数を返す表示専用の定義。文言（SIGNAL_LABELS）と違い共有先が無いのでここに置く。
const SIGNAL_COLOR: Record<PatternSignal, string> = {
  bullish: 'var(--bull)',
  bearish: 'var(--bear)',
  neutral: 'var(--amber)',
};

type Props = {
  signal: PatternSignal;
  label?: string;
};

export function PatternSignalBadge({ signal, label }: Props) {
  const color = SIGNAL_COLOR[signal];
  return (
    <span className="macro-badge" style={{ color }}>
      <span className="macro-badge-dot" style={{ background: color }} />
      {label ?? SIGNAL_LABELS[signal]}
    </span>
  );
}
