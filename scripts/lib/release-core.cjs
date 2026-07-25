/**
 * リリーススクリプトの純粋関数群。
 * git / npm / ファイル操作は release.cjs 側が担当し、ここには副作用を持たせない。
 */

// タグは release.yml が `v*.*.*` パターンでのみ反応するため prerelease / build は受け付けない
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// release.yml のフォールバック文言と揃える
const FALLBACK_CHANGELOG_LINE = '- その他の改善・修正';

const USAGE = [
  '使い方: npm run release -- <x.y.z> [オプション]',
  '',
  '  --notes "<本文>"   自動生成の代わりに指定文をリリースノート本文に使う',
  '  --with-tests       typecheck の後に npm test も実行する',
  '  --dry-run          チェックと生成結果の表示のみ（変更・commit・push なし）',
  '  --yes              最終確認プロンプトをスキップする',
].join('\n');

/**
 * @param {unknown} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  return typeof version === 'string' && VERSION_PATTERN.test(version);
}

/**
 * 2 つの x.y.z を数値順で比較する。
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }

  return 0;
}

/**
 * CLI 引数を解析する。不正な入力は使い方付きの Error を投げる。
 * @param {readonly string[]} argv process.argv.slice(2) 相当
 * @returns {{ version: string, notes: string | null, withTests: boolean, dryRun: boolean, yes: boolean }}
 */
function parseArgs(argv) {
  let version = null;
  let notes = null;
  let withTests = false;
  let dryRun = false;
  let yes = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--with-tests') {
      withTests = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg.startsWith('--notes=')) {
      notes = arg.slice('--notes='.length);
    } else if (arg === '--notes') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--notes に本文が指定されていません。\n\n${USAGE}`);
      }
      notes = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`未知のオプションです: ${arg}\n\n${USAGE}`);
    } else if (version === null) {
      if (!isValidVersion(arg)) {
        throw new Error(
          `バージョンの形式が不正です: ${arg}\n` +
            'x.y.z 形式（例: 1.1.0）で指定してください。v プレフィックスや prerelease は使えません。\n\n' +
            USAGE,
        );
      }
      version = arg;
    } else {
      throw new Error(`バージョンが複数指定されています: ${version} と ${arg}\n\n${USAGE}`);
    }
  }

  if (version === null) {
    throw new Error(`バージョンが指定されていません。\n\n${USAGE}`);
  }

  return { version, notes, withTests, dryRun, yes };
}

/**
 * `git log --pretty=format:- %s` の出力を行配列に変換する。
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
function parseCommitLog(raw) {
  if (!raw) return [];

  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

/**
 * コミットメッセージを組み立てる。本文は release.yml がリリースノートとして使う。
 * @param {{ version: string, commitLines: readonly string[], notes?: string | null }} params
 * @returns {string}
 */
function buildCommitMessage({ version, commitLines, notes }) {
  const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
  const body = trimmedNotes.length > 0 ? trimmedNotes : commitLines.join('\n').trim();
  const changelog = body.length > 0 ? body : FALLBACK_CHANGELOG_LINE;

  return `chore: v${version}\n\n${changelog}\n`;
}

module.exports = {
  FALLBACK_CHANGELOG_LINE,
  USAGE,
  VERSION_PATTERN,
  buildCommitMessage,
  compareVersions,
  isValidVersion,
  parseArgs,
  parseCommitLog,
};
