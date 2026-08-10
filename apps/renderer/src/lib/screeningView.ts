import type { ScreeningPattern, ScreeningResult, ScreeningScoreDetail } from '../types';

/**
 * スクリーニング表の並び替え・バッジ導出・鮮度フィルタ（純関数）。
 *
 * スコアを表に出さないのは、前方リターンの予測力が無いことがバックテストで
 * 確定したため（docs/n_pattern_backtest_spec.md §16.2）。順位付けにも絞り込みにも
 * スコアを使わず、**ブレイク日の鮮度**という作業上の軸だけで扱う。
 */

/** バッジ 1 個ぶん。`label` はそのまま表示する。 */
export type ScreeningBadge = {
  key: keyof ScreeningScoreDetail;
  label: string;
};

/**
 * バッジに出す要素と表示名。
 *
 * `trend` と `duration_penalty` を含めないのは実測に基づく判断:
 * 前者は `TREND_BONUS = 0` のため常に 0、後者は 3 年で発火 1 件の死にコード。
 * `TREND_BONUS` を将来戻すなら、ここにも `trend` を戻すこと。
 *
 * `pullback_penalty` は内部名が「penalty」だが、実測では**減点された群のほうが
 * 超過リターンが高い**（+1.63%、中央値 +1.77%）。UI では減点という含意を持ち込まず
 * 「浅い押し目」という事実だけを出す。
 */
export const BADGE_DEFS: ScreeningBadge[] = [
  { key: 'breakout', label: '強いブレイク' },
  { key: 'volume', label: '出来高急増' },
  { key: 'macd', label: 'MACD GC' },
  { key: 'pullback_penalty', label: '浅い押し目' },
];

/** 鮮度フィルタの選択肢（暦日）。`null` は全件。選択肢はパターン間で共有する。 */
export const AGE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '全件' },
  { value: 3, label: '3日以内' },
  { value: 7, label: '7日以内' },
];

/**
 * 鮮度フィルタのラベル語。選択肢（AGE_OPTIONS）は共有し、語だけ差し替える。
 *
 * `Record<ScreeningPattern, _>` にしてあるので、パターンを増やしたときに
 * 登録漏れを tsc が落とす。
 */
export const AGE_LABEL: Record<ScreeningPattern, string> = {
  'n-pattern': 'ブレイク',
  ppp: '成立',
};

/**
 * 鮮度の既定値（暦日）。`null` は全件。
 *
 * N字は「全件」— 絞って開くと見落とすため（docs/screening_ui_repositioning_plan.md §6）。
 * **PPP だけ 7 日**にするのは、成立イベントが 1 年窓で銘柄の 8 割超に出るため
 * （較正実測: ユニバース 563 銘柄中 464 が成立を持つ）。全件で開くと
 * 「上昇トレンド銘柄がほぼ全部並び、ユニバースの部分集合コピーになる」という、
 * 状態表示を却下したときの状態に逆戻りする（docs/ppp_screening_spec.md §5.2）。
 */
export const DEFAULT_MAX_AGE_DAYS: Record<ScreeningPattern, number | null> = {
  'n-pattern': null,
  ppp: 7,
};

/**
 * 日付の新しい順。同着は ticker 昇順（並びを決定的にするため）。
 *
 * 日付フィールド名がパターンで違う（`break_date` / `established_date`）ため
 * アクセサで受ける。**並び順の規約はパターン間で共通**。
 *
 * バックエンドも同じ順に並べるが、表示前に非破壊で並べ直して二重に担保する
 * （旧バージョンが書いた結果 JSON がスコア順のまま残っていても正しく出る）。
 */
export function sortByDateDesc<T extends { ticker: string }>(
  rows: T[],
  dateOf: (r: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const [da, db] = [dateOf(a), dateOf(b)];
    if (da !== db) return da < db ? 1 : -1;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  });
}

/** ブレイク日の新しい順（`sortByDateDesc` の N字向けラッパ）。 */
export function sortByBreakDate(results: ScreeningResult[]): ScreeningResult[] {
  return sortByDateDesc(results, (r) => r.break_date);
}

/**
 * 発火した要素のバッジを返す。
 *
 * **良し悪しの評価ではなく、パターンの事実**として並べる。数を数えて順位付けに
 * 使ってはいけない（各要素は個別に無情報だと実測済み）。
 */
export function toBadges(detail: ScreeningScoreDetail | undefined): ScreeningBadge[] {
  if (!detail) return [];
  return BADGE_DEFS.filter((b) => (detail[b.key] ?? 0) !== 0);
}

/** 先頭の `YYYY-MM-DD`。以降の時刻・オフセットは意図的に見ない。 */
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * 日付文字列の**暦日部分だけ**を UTC 0 時のミリ秒に写す。解釈できなければ `null`。
 *
 * `break_date` は市場の営業日（`2026-07-05`）、`generated_at` はオフセット付きの
 * 絶対時刻（`2026-07-08T20:00:00-05:00`）と型が違う。後者を `Date.parse` で
 * 瞬間として扱うと、両者の差にマシンの UTC オフセットとスキャン時刻が混入し、
 * 暦日差が 1 日ずれる（実測: 上の 2 例は 3 日なのに 4 と出て「3日以内」から落ちる）。
 * **両辺とも暦日へ落としてから引く**ことでずれを断つ。文字列のオフセットを
 * そのまま暦日として読むので、実行環境のタイムゾーンにも依存しない。
 */
function calendarDayMs(value: string): number | null {
  const m = CALENDAR_DATE_RE.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Date.UTC は 2026-13-45 のような値を繰り上げて受理するため往復で弾く。
  const valid =
    back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return valid ? ms : null;
}

/**
 * ブレイク日から基準日までの経過日数（暦日）。
 *
 * 営業日ではなく暦日で近似するのは、レンダラーに祝日表が無いため。
 * **並び順には影響しない**ので、絞り込みの粒度としてはこれで足りる。
 * `asOf` が null なら実行環境のローカル暦日を基準にする。
 * 不正な日付は `null`（＝フィルタで落とさない）。
 */
export function ageInDays(breakDate: string, asOf: string | null): number | null {
  const b = calendarDayMs(breakDate);
  if (b === null) return null;
  const now = new Date();
  const base =
    asOf === null
      ? Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      : calendarDayMs(asOf);
  if (base === null) return null;
  // 両辺とも UTC 0 時なので差は必ず 86400000 の倍数（round は桁落ち保険）。
  const days = Math.round((base - b) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * 鮮度で絞る。`maxAgeDays` が null なら全件。
 *
 * 経過日数を判定できない行は**落とさず残す**。日付の解釈に失敗しただけの行を
 * 黙って消すと、件数が合わない理由が読み手に分からなくなる。
 *
 * `dateOf` を省略可にしないのは、既定を `break_date` にすると PPP で
 * `undefined` を渡して黙って全件通ってしまうため（型では捕まらない）。
 */
export function filterByAge<T>(
  rows: T[],
  maxAgeDays: number | null,
  asOf: string | null,
  dateOf: (r: T) => string,
): T[] {
  if (maxAgeDays === null) return rows;
  return rows.filter((r) => {
    const age = ageInDays(dateOf(r), asOf);
    return age === null || age <= maxAgeDays;
  });
}

/** 時価総額セルの表示に必要な情報。`source` はどちらの値を採ったか。 */
export type MarketCapView = {
  text: string;
  /** `asof` = 実施日の実測値 / `universe` = CSV 登録値 / `none` = 値なし */
  source: 'asof' | 'universe' | 'none';
  /** hover 表示用の説明。値の出所と基準日を伝える。 */
  title: string;
};

/**
 * 時価総額を `4.6兆` / `230億` の形に整形する。
 *
 * 兆・億の 2 段階だけにするのは、日本株の時価総額がこの 2 桁帯にほぼ収まるため。
 * 億未満は生の数字を出す（丸めると 0 億になって値の有無が読めなくなる）。
 */
export function formatMarketCap(cap: number | null): string {
  if (cap === null) return '—';
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(1)}兆`;
  if (cap >= 1e8) return `${Math.round(cap / 1e8)}億`;
  return String(cap);
}

/** 時価総額の解決に必要なフィールドだけを要求する（パターン非依存にするため）。 */
export type MarketCapSource = Pick<
  ScreeningResult,
  'market_cap' | 'market_cap_asof' | 'market_cap_date'
>;

/**
 * 表示に使う時価総額を決める。**実施日の実測値を優先**し、無ければ CSV 値へ落とす。
 *
 * フォールバックした値に `*` を付けて `source` を返すのは、両者を無印で混ぜると
 * 「実施日の時価総額」という表示の意味が壊れるため。CSV の値は登録した日の値で、
 * 何ヶ月前かは誰にも分からない。色だけで区別しないのは、テーマによっては
 * muted 色の差が読み取れないから（記号と色の二重化）。
 */
export function resolveMarketCap(r: MarketCapSource): MarketCapView {
  const asof = r.market_cap_asof ?? null;
  if (asof !== null) {
    const date = r.market_cap_date ?? null;
    return {
      text: formatMarketCap(asof),
      source: 'asof',
      title: date ? `${date} 時点` : '実施日時点',
    };
  }
  const csv = r.market_cap ?? null;
  if (csv !== null) {
    return {
      text: `${formatMarketCap(csv)}*`,
      source: 'universe',
      // 「取得できず」と言い切らないのは、実施日の値を**取りに行っていない**場合が
      // あるため。バックエンドは表示されうる行（鮮度の新しい行）でのみ実測値を
      // 解決する（screening_provider._needs_asof_cap）。取得失敗と未取得を
      // UI から区別する手段は無く、どちらも「実施日の値が無い」で正しい。
      title: 'ユニバース CSV の登録値（実施日の値は未取得）',
    };
  }
  return { text: '—', source: 'none', title: '時価総額データなし' };
}
