import { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_MAX_W = 320;
const OFFSET_Y = 6;
const EDGE_MARGIN = 8;

type Coords = { top: number; left: number };

type Props = {
  content: ReactNode;
  // aria-label（既定「解説」）。
  label?: string;
};

// trigger の矩形からツールチップの表示座標を求める。右端はみ出しはクランプ。
function computeCoords(rect: DOMRect): Coords {
  const maxLeft = window.innerWidth - TOOLTIP_MAX_W - EDGE_MARGIN;
  return {
    top: rect.bottom + OFFSET_Y,
    left: Math.max(EDGE_MARGIN, Math.min(rect.left, maxLeft)),
  };
}

export function InfoTooltip({ content, label = '解説' }: Props) {
  const [coords, setCoords] = useState<Coords | null>(null);

  // ref を render 中に読まず、イベント発火時に currentTarget から矩形を取得する。
  const open = (target: HTMLElement) => setCoords(computeCoords(target.getBoundingClientRect()));
  const close = () => setCoords(null);

  return (
    <button
      type="button"
      className="macro-info-trigger"
      aria-label={label}
      onMouseEnter={(e) => open(e.currentTarget)}
      onMouseLeave={close}
      onFocus={(e) => open(e.currentTarget)}
      onBlur={close}
    >
      i
      {coords &&
        createPortal(
          <div
            className="macro-tooltip"
            role="tooltip"
            style={{ top: coords.top, left: coords.left, maxWidth: TOOLTIP_MAX_W }}
          >
            {content}
          </div>,
          document.body,
        )}
    </button>
  );
}
