import type { MacroSignal } from '../../types';

const SIGNAL_COLOR: Record<MacroSignal, string> = {
  green: 'var(--bull)',
  yellow: 'var(--amber)',
  red: 'var(--bear)',
  gray: 'var(--muted)',
};

const SIGNAL_LABEL: Record<MacroSignal, string> = {
  green: '良好',
  yellow: '注意',
  red: '警戒',
  gray: '取得不可',
};

type Props = {
  signal: MacroSignal;
  label?: string;
};

export function SignalBadge({ signal, label }: Props) {
  const color = SIGNAL_COLOR[signal];
  return (
    <span className="macro-badge" style={{ color }}>
      <span className="macro-badge-dot" style={{ background: color }} />
      {label ?? SIGNAL_LABEL[signal]}
    </span>
  );
}
