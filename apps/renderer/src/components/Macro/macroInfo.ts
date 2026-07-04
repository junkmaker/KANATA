// マクロ指標の解説コンテンツ（内容・読み方・判断基準）の静的データ。
//
// 判断基準テキストの正典は backend/src/services/macro_provider.py の
// evaluate_signal / _overall_signal と config/macro_thresholds.json。
// 閾値の数値を変更する場合は macro_thresholds.json と本ファイルを両方更新すること。
//
// キー集合は MacroCard.tsx の TITLE/SUBTITLE と同一（6 指標）。

export interface MacroInfoCriteria {
  green: string;
  yellow: string;
  red: string;
}

export interface MacroInfo {
  what: string;
  read: string;
  criteria: MacroInfoCriteria;
  // 総合シグナルに寄与しない表示専用指標は true。
  displayOnly?: boolean;
}

export const MACRO_INFO: Record<string, MacroInfo> = {
  hy_oas: {
    what: '米ハイイールド債と国債の利回り差（信用スプレッド）。市場の信用不安を示す土台指標。',
    read: '低い=信用良好、拡大=警戒。株価より先行して悪化しやすい。',
    criteria: {
      green: '20営業日で+50bp未満かつ直近60営業日の高値未満',
      yellow: '20営業日参照点から+50bp以上拡大',
      red: '直近60営業日の高値を更新（急拡大）',
    },
  },
  net_liquidity: {
    what: 'Fed資産（WALCL）から RRP と TGA を差し引いた純流動性。市場に供給される資金量の土台。',
    read: '増加=リスク資産に追い風、減少=逆風。トレンドの向きを重視する。',
    criteria: {
      green: '8営業日参照点以上を維持',
      yellow: '8営業日参照点を下回る（下降トレンド入り）',
      red: '直近26営業日の安値を割り込む',
    },
  },
  rsp_spy: {
    what: '等加重S&P500(RSP)を時価加重S&P500(SPY)で割った比率。市場の広がり（ブレッドス）を測る。',
    read: '上昇=幅広い銘柄が上昇、下落=一部大型株に集中。安値割れは地合い悪化。',
    criteria: {
      green: '直近安値から+2%超を維持',
      yellow: '直近60営業日の安値まで+2%以内に接近',
      red: '直近60営業日の安値を割り込む',
    },
  },
  nikkei_sp: {
    what: '日経225をS&P500で割った相対強弱。日本株の対米相対パフォーマンス。',
    read: '上昇=日本株優位、下落=米株優位。総合シグナルには寄与しない表示専用指標。',
    criteria: {
      green: '8営業日参照点以上を維持',
      yellow: '8営業日参照点を下回る（中期下降トレンド）',
      red: '直近26営業日の安値を割り込む',
    },
    displayOnly: true,
  },
  nikkei_topix: {
    what: '日経225をTOPIX(1306)で割った相対強弱。大型グロース vs バリューの傾き。',
    read: '上昇=日経寄与の大型株優位、下落=TOPIX優位。総合シグナルには寄与しない表示専用指標。',
    criteria: {
      green: '8営業日参照点以上を維持',
      yellow: '8営業日参照点を下回る（中期下降トレンド）',
      red: '直近26営業日の安値を割り込む',
    },
    displayOnly: true,
  },
  brent_wti: {
    what: 'ブレント原油とWTI原油の価格差（$/バレル）。地政学リスクと供給逼迫の傾き。',
    read: '正常帯($1.5〜$7)が平時。帯外は歪み、逆転や極端拡大は異常。総合シグナルには寄与しない表示専用指標。',
    criteria: {
      green: '正常帯（$1.5〜$7）内',
      yellow: '正常帯（$1.5〜$7）外',
      red: '$0以下（逆転）または$10以上（極端拡大）',
    },
    displayOnly: true,
  },
};

export const OVERALL_INFO: MacroInfo = {
  what: '中核3指標（HY OAS・Fed純流動性・RSP/SPY）のみで算出する総合シグナル。日本株/原油の表示専用3指標は寄与しない。',
  read: '土台（信用・流動性）と幅（ブレッドス）を合成した地合い判定。',
  criteria: {
    green: '中核3指標に警戒がなく、注意も1つ以下',
    yellow: '中核3指標に警戒はないが、注意が2つ以上',
    red: '中核3指標のいずれかが警戒',
  },
};
