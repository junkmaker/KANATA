#!/usr/bin/env node
/**
 * リリース作業スクリプト。
 *
 *   npm run release -- <x.y.z> [--notes "<本文>"] [--with-tests] [--dry-run] [--yes]
 *
 * package.json / package-lock.json の version を更新し、コミットして main へ push する。
 * push 後は CI が引き継ぐ:
 *   tag-on-version-change.yml が v<version> タグを生成 → release.yml が Release を作成。
 * コミット本文は release.yml がリリースノートとして使うため、前タグからのコミット一覧を入れる。
 */

const { execFileSync, spawnSync } = require('child_process');
const { readFileSync, unlinkSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { createInterface } = require('readline');

const {
  buildCommitMessage,
  compareVersions,
  parseArgs,
  parseCommitLog,
} = require('./lib/release-core.cjs');

const ROOT = join(__dirname, '..');
const RELEASE_BRANCH = 'main';
const REMOTE = 'origin';
const RECENT_COMMIT_LIMIT = 30;
const TOTAL_STEPS = 8;

const log = (message) => console.log(`[release] ${message}`);
const warn = (message) => console.warn(`[release] 警告: ${message}`);
const step = (n, title) => log(`${n}/${TOTAL_STEPS} ${title}`);

/** git をキャプチャ実行する。失敗時は Error を投げる。 */
function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** git を実行し、失敗時は null を返す（存在確認・ネットワーク依存の処理用）。 */
function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/** git を出力そのまま流して実行する。失敗時は Error を投げる。 */
function gitInherit(args) {
  const result = spawnSync('git', args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} が終了コード ${result.status} で失敗しました。`);
  }
}

/**
 * npm を実行する。失敗時は Error を投げる。
 * Windows では npm が .cmd のため shell 経由が必須。引数は
 * リテラルと検証済みバージョン文字列のみなので単一コマンド文字列で渡す。
 */
function npm(args) {
  const command = `npm ${args.join(' ')}`;
  const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} が終了コード ${result.status} で失敗しました。`);
  }
}

function readCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [y/N]: `, resolve));
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** origin の URL から GitHub の https URL を組み立てる。判定できなければ null。 */
function githubBaseUrl() {
  const remoteUrl = gitOrNull(['remote', 'get-url', REMOTE]);
  if (!remoteUrl) return null;

  const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? `https://github.com/${match[1]}` : null;
}

function checkVersion(version) {
  const current = readCurrentVersion();
  step(1, `バージョン検証: ${current} → ${version}`);

  if (compareVersions(version, current) <= 0) {
    throw new Error(
      `指定バージョン ${version} は現在の ${current} より新しくありません。\n` +
        'package.json の version より大きい x.y.z を指定してください。',
    );
  }
  return current;
}

function checkBranch() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  step(2, `ブランチ確認: ${branch}`);

  if (branch !== RELEASE_BRANCH) {
    throw new Error(
      `現在のブランチは ${branch} です。リリースは ${RELEASE_BRANCH} からのみ実行できます。\n` +
        `tag-on-version-change.yml が ${RELEASE_BRANCH} への push でしかタグを作らないためです。\n` +
        `git switch ${RELEASE_BRANCH} してから再実行してください。`,
    );
  }
}

function checkWorkingTree() {
  const status = git(['status', '--porcelain']);
  step(3, '作業ツリー確認');

  if (status.length > 0) {
    throw new Error(
      `作業ツリーに未コミットの変更があります。\n${status}\n` +
        'コミットまたは stash してから再実行してください（version 更新のみを含むコミットにするため）。',
    );
  }
}

/** リモートを取得し、ローカルが遅れていないか確認する。戻り値は fetch 成否。 */
function checkRemoteSync() {
  step(4, 'リモート同期確認');

  const fetched = gitOrNull(['fetch', '--tags', REMOTE, RELEASE_BRANCH]) !== null;
  if (!fetched) {
    warn(
      `${REMOTE} への fetch に失敗しました。ローカル情報のみで続行します（push 時に再確認されます）。`,
    );
    return false;
  }

  const upstream = `${REMOTE}/${RELEASE_BRANCH}`;
  if (gitOrNull(['rev-parse', '--verify', '--quiet', `refs/remotes/${upstream}`]) === null) {
    warn(`${upstream} が見つかりません。同期確認をスキップします。`);
    return true;
  }

  const behind = git(['rev-list', '--count', `HEAD..${upstream}`]);
  if (behind !== '0') {
    throw new Error(
      `ローカルの ${RELEASE_BRANCH} が ${upstream} より ${behind} コミット遅れています。\n` +
        `git pull ${REMOTE} ${RELEASE_BRANCH} してから再実行してください。`,
    );
  }
  return true;
}

function checkTagAbsence(version, fetched) {
  const tag = `v${version}`;
  step(5, `タグ重複確認: ${tag}`);

  if (gitOrNull(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null) {
    throw new Error(
      `タグ ${tag} が既に存在します（fetch 済みのリモートタグを含む）。\n` +
        'このバージョンはリリース済みです。別のバージョンを指定するか、誤って作られたタグを削除してください。',
    );
  }

  if (!fetched) return;

  const remoteTag = gitOrNull(['ls-remote', '--tags', REMOTE, `refs/tags/${tag}`]);
  if (remoteTag) {
    throw new Error(
      `タグ ${tag} が ${REMOTE} に既に存在します（このバージョンはリリース済みです）。\n` +
        '別のバージョンを指定してください。',
    );
  }
}

function runChecks(withTests) {
  step(6, withTests ? '事前チェック: typecheck + テスト' : '事前チェック: typecheck');
  npm(['run', 'typecheck']);
  if (withTests) {
    npm(['test']);
  }
}

function buildNotes(version, notes) {
  step(7, 'リリースノート生成');

  const prevTag = gitOrNull(['describe', '--tags', '--abbrev=0']);
  const logArgs = ['log', '--no-merges', '--pretty=format:- %s'];
  if (prevTag) {
    log(`前回のタグ: ${prevTag}`);
    logArgs.push(`${prevTag}..HEAD`);
  } else {
    warn(`タグが見つかりません。直近 ${RECENT_COMMIT_LIMIT} 件のコミットから生成します。`);
    logArgs.push(`-${RECENT_COMMIT_LIMIT}`);
  }

  const commitLines = parseCommitLog(gitOrNull(logArgs));
  return buildCommitMessage({ version, commitLines, notes });
}

/** version を更新し、コミットして push する。 */
function commitAndPush(version, message) {
  step(8, 'バージョン更新・コミット・push');

  npm(['version', version, '--no-git-tag-version']);

  const messageFile = join(tmpdir(), `kanata-release-${version}-${process.pid}.txt`);
  try {
    git(['add', '--', 'package.json', 'package-lock.json']);
    writeFileSync(messageFile, message, 'utf8');
    gitInherit(['commit', '-F', messageFile]);
  } catch (error) {
    warn('コミットに失敗したため version の変更を巻き戻します。');
    gitOrNull(['reset', '--', 'package.json', 'package-lock.json']);
    gitOrNull(['checkout', '--', 'package.json', 'package-lock.json']);
    throw error;
  } finally {
    try {
      unlinkSync(messageFile);
    } catch {
      // 一時ファイルの削除失敗は無視する
    }
  }

  try {
    gitInherit(['push', REMOTE, RELEASE_BRANCH]);
  } catch (error) {
    throw new Error(
      `push に失敗しました: ${error.message}\n` +
        `version 更新のコミットはローカルに残っています。\n` +
        `  再試行: git push ${REMOTE} ${RELEASE_BRANCH}\n` +
        '  取り消し: git reset --soft HEAD~1 && git checkout -- package.json package-lock.json',
    );
  }
}

function printNextSteps(version) {
  const base = githubBaseUrl();
  log(`v${version} を push しました。以降は CI が処理します。`);
  log(`  1. tag-on-version-change.yml が v${version} タグを生成`);
  log('  2. release.yml が NSIS インストーラをビルドし GitHub Release を作成');
  if (base) {
    log(`  進捗: ${base}/actions`);
    log(`  Release: ${base}/releases/tag/v${version}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { version, notes, withTests, dryRun, yes } = options;

  if (dryRun) log('dry-run モード: ファイル変更・コミット・push は行いません。');

  checkVersion(version);
  checkBranch();
  checkWorkingTree();
  const fetched = checkRemoteSync();
  checkTagAbsence(version, fetched);
  runChecks(withTests);

  const message = buildNotes(version, notes);
  console.log('\n----- コミットメッセージ -----');
  console.log(message.trimEnd());
  console.log('-----------------------------\n');

  if (dryRun) {
    log('dry-run のため終了します。');
    return;
  }

  if (!yes) {
    const approved = await confirm(
      `上記メッセージで v${version} をリリースし ${REMOTE}/${RELEASE_BRANCH} へ push しますか？`,
    );
    if (!approved) {
      log('中止しました。変更は行っていません。');
      return;
    }
  }

  commitAndPush(version, message);
  printNextSteps(version);
}

main().catch((error) => {
  console.error(`[release] エラー: ${error.message}`);
  process.exitCode = 1;
});
