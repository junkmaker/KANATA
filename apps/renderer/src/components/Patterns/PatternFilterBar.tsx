import type { CandlePatternType } from '../../types';

type PatternFilter = CandlePatternType | 'all';

const FILTERS: Array<{ value: PatternFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'bullish_engulfing', label: '陽線包み' },
  { value: 'doji', label: '同時線' },
  { value: 'evening_star', label: '宵の明星' },
  { value: 'hammer', label: 'ハンマー' },
];

type Props = {
  value: PatternFilter;
  onChange: (value: PatternFilter) => void;
};

export function PatternFilterBar({ value, onChange }: Props) {
  return (
    <div className="pattern-filterbar">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          className={`chip ${value === f.value ? 'on' : ''}`}
          onClick={() => onChange(f.value)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
