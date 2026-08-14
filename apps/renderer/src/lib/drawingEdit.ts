import type { DrawingObject, DrawingType } from '../types';

/**
 * ハンドルの当たり判定半径（px）。描画されるハンドルの見た目（6px 角 / 半径 5 の円）より
 * わずかに広く取り、掴み損ねを減らす。
 */
export const HANDLE_HIT_TOL = 6;

/**
 * ハンドルの識別子。`DrawingObject` の 2 点 (i1,v1)/(i2,v2) の**成分の組み合わせ**で表す。
 * - `p1` = (i1, v1) / `p2` = (i2, v2)（トレンドラインの始点・終点そのもの）
 * - `i1v2` = (i1, v2) / `i2v1` = (i2, v1)（外接矩形の残り 2 隅）
 * 成分名で持つことで「対角を固定してリサイズ」が min/max 判定なしに書ける。
 */
export type DrawingHandleId = 'p1' | 'p2' | 'i1v2' | 'i2v1';

/** 画面座標の点（テスト時に DOM 型を要求しないための最小形） */
export interface ScreenPoint {
  x: number;
  y: number;
}

const TWO_POINT_HANDLES: DrawingHandleId[] = ['p1', 'p2', 'i1v2', 'i2v1'];
const LINE_HANDLES: DrawingHandleId[] = ['p1', 'p2'];

/**
 * その描画型が持つハンドル一覧を返す（純関数）。
 * hline / vline は自由度が 1 つで「全体移動＝リサイズ」になるためハンドルを持たない。
 * text は位置のみを持つのでハンドルを持たない（本文編集は updateDrawingText が担当）。
 */
export function handleIdsFor(type: DrawingType): DrawingHandleId[] {
  if (type === 'trend') return LINE_HANDLES;
  if (type === 'rect' || type === 'ellipse') return TWO_POINT_HANDLES;
  return [];
}

/**
 * ハンドルのデータ座標 (idx, v) を返す（純関数）。
 * 2 点が揃っていない描画（作成途中・壊れたデータ）では null を返す。
 */
export function handlePoint(
  d: DrawingObject,
  id: DrawingHandleId,
): { idx: number; v: number } | null {
  const { i1, v1, i2, v2 } = d;
  if (i1 == null || v1 == null || i2 == null || v2 == null) return null;
  if (id === 'p1') return { idx: i1, v: v1 };
  if (id === 'p2') return { idx: i2, v: v2 };
  if (id === 'i1v2') return { idx: i1, v: v2 };
  return { idx: i2, v: v1 };
}

/**
 * 画面座標に最も近いハンドルを返す（純関数）。tol 内に無ければ null。
 * 座標変換は呼び出し側から関数で注入する（この層はペインもスケールも知らない）。
 * **最も近いものを返す**のは、図形が小さく潰れてハンドル同士が重なったときに
 * 掴む対象が列挙順で決まってしまう（＝反対側の隅しか掴めない）のを避けるため。
 * 距離が完全に同じときは列挙順（p1 → p2 → i1v2 → i2v1）で先のものを採る。
 *
 * `isVisible` を渡すと false を返した位置のハンドルを候補から外す。
 * 呼び出し側のクリップ矩形（ペイン外にはみ出した隅は描画されない）を反映させるためのもので、
 * 「見えていないハンドルは掴ませない」を判定側だけで完結させないための注入点。
 */
export function findHandleAt(
  d: DrawingObject,
  sx: number,
  sy: number,
  toScreen: (idx: number, v: number) => ScreenPoint,
  isVisible?: (p: ScreenPoint) => boolean,
  tol: number = HANDLE_HIT_TOL,
): DrawingHandleId | null {
  let best: DrawingHandleId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of handleIdsFor(d.type)) {
    const pt = handlePoint(d, id);
    if (!pt) continue;
    const sp = toScreen(pt.idx, pt.v);
    if (isVisible && !isVisible(sp)) continue;
    const dist = Math.hypot(sx - sp.x, sy - sp.y);
    if (dist <= tol && dist < bestDist) {
      best = id;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * ハンドルを (idx, v) へ動かした新しい描画を返す（純関数・イミュータブル）。
 * 掴んだ成分だけを差し替えるので、対角のハンドルは自動的に固定される。
 * ハンドルを持たない型・座標が欠けた描画は元の参照をそのまま返す（no-op）。
 */
export function applyHandleDrag(
  d: DrawingObject,
  id: DrawingHandleId,
  idx: number,
  v: number,
): DrawingObject {
  if (!handleIdsFor(d.type).includes(id)) return d;
  if (handlePoint(d, id) == null) return d;
  if (id === 'p1') return { ...d, i1: idx, v1: v };
  if (id === 'p2') return { ...d, i2: idx, v2: v };
  if (id === 'i1v2') return { ...d, i1: idx, v2: v };
  return { ...d, i2: idx, v1: v };
}

/**
 * テキスト描画の本文を差し替えた新しい配列を返す（純関数・イミュータブル）。
 * 空文字・空白のみは「編集を破棄」として元の配列をそのまま返す
 * （削除は Delete キーと右クリックメニューに任せ、消し方を 3 通りに増やさない）。
 * 対象が text 型でない場合も no-op にする。
 */
export function updateDrawingText(
  drawings: readonly DrawingObject[],
  id: number,
  text: string,
): DrawingObject[] {
  const trimmed = text.trim();
  if (!trimmed) return drawings as DrawingObject[];
  return drawings.map((d) => (d.id === id && d.type === 'text' ? { ...d, text: trimmed } : d));
}
