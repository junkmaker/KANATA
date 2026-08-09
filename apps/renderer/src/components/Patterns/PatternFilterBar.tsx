import { PATTERN_FILTER_GROUPS } from '../../lib/patternView';
import type { PatternFilter } from '../../types';

type Props = {
  value: PatternFilter;
  onChange: (value: PatternFilter) => void;
};

/**
 * 方向（強気/弱気/中立）ごとに行を分けたフィルタチップ列。
 *
 * 13 種を 1 行に並べると探せなくなるため見出し付きの行に割る。**チップ自体には
 * 方向の配色を付けない** — 中立な観察ツールという方針で、色で強調すると
 * 「有望シグナル」と読まれるため（方向は見出し列だけで示す）。
 *
 * 選択状態は `.chip.on` の配色だけでなく `aria-pressed` でも伝える。14 個が
 * 4 行に散っており、色を知覚できないと「どれが選択中か」を得る手段が無くなるため。
 * グループの意味も見出し div の位置関係でしか表現されないので、チップ列を
 * `fieldset` + `aria-label` にして明示する（行は `display: contents` で
 * 支援技術に見えないことがあるため、実体のあるチップ列に付ける）。`legend` を
 * 使わないのは見出しが Grid の別セルにあるため — 名前は `aria-label` で与える。
 */
export function PatternFilterBar({ value, onChange }: Props) {
  return (
    <div className="pattern-filterbar">
      {PATTERN_FILTER_GROUPS.map((g) => (
        <div key={g.key} className="pattern-filter-row">
          {/* 見出しは aria-label と同じ情報。二重に読み上げさせない */}
          <div className="pattern-filter-label" aria-hidden="true">
            {g.heading}
          </div>
          <fieldset className="pattern-filter-chips" aria-label={g.ariaLabel}>
            {g.chips.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chip ${value === c.value ? 'on' : ''}`}
                aria-pressed={value === c.value}
                onClick={() => onChange(c.value)}
              >
                {c.label}
              </button>
            ))}
          </fieldset>
        </div>
      ))}
    </div>
  );
}
