import type { AppState } from '../types';

/** 描画の表示/非表示を切り替えるキー（修飾キーなしの単独押下） */
export const DRAWINGS_TOGGLE_KEY = 'h';

/** パン/選択ツールの識別子。これ以外は描画を生成するツール */
export const PAN_TOOL = 'pan';

/** この属性を持つ要素の配下から発生したキー操作はチャートのショートカットを発火させない */
export const SHORTCUT_OPT_OUT_SELECTOR = '[data-chart-shortcuts="off"]';

/** キーイベントのうち判定に使う最小の形（テスト用に KeyboardEvent 全体を要求しない） */
export interface ToggleKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

/** キーイベントのターゲットのうち判定に使う最小の形 */
export interface TypingTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * 描画表示トグルのショートカット押下かどうかを判定する（純関数）。
 * 修飾キーつき・IME 変換中は既存ショートカットや文字入力と衝突するため無視する。
 * キーリピートも無視する（押しっぱなしでレイヤーが点滅し、最終状態が回数の偶奇に依存するため）。
 */
export function isDrawingsToggleKey(e: ToggleKeyEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (e.isComposing) return false;
  if (e.repeat) return false;
  return e.key.toLowerCase() === DRAWINGS_TOGGLE_KEY;
}

/**
 * キー入力を吸うフォーム要素にフォーカスしているかを判定する（純関数）。
 * select を含めるのは、ブラウザの type-ahead（頭文字で選択）と単独キーのショートカットが衝突するため。
 */
export function isTypingTarget(target: TypingTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * 描画レイヤーの表示/非表示を切り替えた新しい state を返す（純関数・イミュータブル）。
 * 非表示にするときは選択中の描画も解除し、描画ツールをパンへ戻す
 * （見えない対象を選択したままにしない／見えない描画を新規作成させないため）。
 */
export function toggleDrawingsVisibility(state: AppState): AppState {
  const showDrawings = !state.showDrawings;
  if (showDrawings) return { ...state, showDrawings };
  return {
    ...state,
    showDrawings,
    selectedDrawingId: null,
    activeTool: PAN_TOOL,
  };
}

/**
 * 描画ツールボタン押下後の state を返す（純関数・イミュータブル）。
 * 同じツールを再度押すとパン/選択へ戻る（既存挙動）。
 * 描画ツールを選んだときは表示を強制 ON にする（非表示のまま描いて見えない事故を防ぐ）。
 */
export function applyToolSelection(state: AppState, toolId: string): AppState {
  const activeTool = state.activeTool === toolId ? PAN_TOOL : toolId;
  return {
    ...state,
    activeTool,
    showDrawings: activeTool === PAN_TOOL ? state.showDrawings : true,
  };
}
