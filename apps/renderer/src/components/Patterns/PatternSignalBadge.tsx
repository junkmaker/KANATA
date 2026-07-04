import type { PatternSignal } from '../../types';

const SIGNAL_COLOR: Record<PatternSignal, string> = {
  bullish: 'var(--bull)',
  bearish: 'var(--bear)',
  neutral: 'var(--amber)',
};

const SIGNAL_LABEL: Record<PatternSignal, string> = {
  bullish: '強気',
  bearish: '弱気',
  neutral: '中立',
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
      {label ?? SIGNAL_LABEL[signal]}
    </span>
  );
}
