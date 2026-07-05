/** 比較モードで同時選択できる最大銘柄数（変化率モード時） */
export const MAX_COMPARE_SELECTION = 6;

/** 比較を非表示のモード識別子 */
export const COMPARE_MODE_NONE = 'none';

/**
 * ウォッチリスト行クリック時の次の選択状態を返す（純関数・イミュータブル）。
 * - 比較を非表示（'none'）: 常に単一選択。クリックした銘柄のみへ切り替える
 * - それ以外（'percent' など）: トグル追加/削除。最大 MAX_COMPARE_SELECTION 件、
 *   超過時は先頭（主銘柄側）を 1 件落とす
 * 選択が空になる操作（唯一の選択を外す）は現在の選択をそのまま返す。
 */
export function toggleSelection(current: string[], code: string, compareMode: string): string[] {
  if (compareMode === COMPARE_MODE_NONE) {
    return [code];
  }
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  if (next.length === 0) return current;
  if (next.length > MAX_COMPARE_SELECTION) return next.slice(1);
  return next;
}

/**
 * 比較モードに合わせて選択件数を正規化する（純関数・イミュータブル）。
 * 比較を非表示のときは主銘柄（先頭）1 件のみを残す。
 */
export function clampSelectionForMode(current: string[], compareMode: string): string[] {
  if (compareMode === COMPARE_MODE_NONE && current.length > 1) {
    return current.slice(0, 1);
  }
  return current;
}
