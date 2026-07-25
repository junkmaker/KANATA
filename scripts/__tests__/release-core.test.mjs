import { describe, expect, it } from 'vitest';
import {
  buildCommitMessage,
  compareVersions,
  FALLBACK_CHANGELOG_LINE,
  isValidVersion,
  parseArgs,
  parseCommitLog,
} from '../lib/release-core.cjs';

describe('isValidVersion', () => {
  it('x.y.z 形式を受理する', () => {
    expect(isValidVersion('1.1.0')).toBe(true);
    expect(isValidVersion('0.11.0')).toBe(true);
    expect(isValidVersion('10.0.123')).toBe(true);
  });

  it('パッチまで揃っていない形式を拒否する', () => {
    expect(isValidVersion('1.1')).toBe(false);
    expect(isValidVersion('1')).toBe(false);
    expect(isValidVersion('1.1.0.1')).toBe(false);
  });

  it('v プレフィックスを拒否する', () => {
    expect(isValidVersion('v1.1.0')).toBe(false);
  });

  it('prerelease / build メタデータを拒否する（タグは v*.*.* のみ）', () => {
    expect(isValidVersion('1.1.0-beta.1')).toBe(false);
    expect(isValidVersion('1.1.0+build.5')).toBe(false);
  });

  it('先頭ゼロを拒否する', () => {
    expect(isValidVersion('01.1.0')).toBe(false);
    expect(isValidVersion('1.01.0')).toBe(false);
  });

  it('空文字や非文字列を拒否する', () => {
    expect(isValidVersion('')).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
    expect(isValidVersion(null)).toBe(false);
  });
});

describe('compareVersions', () => {
  it('新しいバージョンで 1 を返す', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('同一バージョンで 0 を返す', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('古いバージョンで -1 を返す', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
  });

  it('辞書順ではなく数値順で比較する', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.11.0')).toBe(-1);
  });
});

describe('parseArgs', () => {
  it('バージョンのみの場合はフラグが全て false', () => {
    expect(parseArgs(['1.1.0'])).toEqual({
      version: '1.1.0',
      notes: null,
      withTests: false,
      dryRun: false,
      yes: false,
    });
  });

  it('--notes の値を受け取る', () => {
    const parsed = parseArgs(['1.1.0', '--notes', '- 手動で書いたノート']);
    expect(parsed.notes).toBe('- 手動で書いたノート');
  });

  it('--notes=値 形式も受け取る', () => {
    const parsed = parseArgs(['1.1.0', '--notes=- 手動ノート']);
    expect(parsed.notes).toBe('- 手動ノート');
  });

  it('--with-tests / --dry-run / --yes を受け取る', () => {
    const parsed = parseArgs(['1.1.0', '--with-tests', '--dry-run', '--yes']);
    expect(parsed.withTests).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.yes).toBe(true);
  });

  it('フラグとバージョンの順序が逆でも受け取る', () => {
    const parsed = parseArgs(['--dry-run', '1.2.3']);
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.dryRun).toBe(true);
  });

  it('バージョン未指定でエラーになる', () => {
    expect(() => parseArgs([])).toThrow(/バージョン/);
    expect(() => parseArgs(['--dry-run'])).toThrow(/バージョン/);
  });

  it('不正なバージョン形式でエラーになる', () => {
    expect(() => parseArgs(['1.1'])).toThrow(/1\.1/);
    expect(() => parseArgs(['v1.1.0'])).toThrow(/v1\.1\.0/);
  });

  it('バージョンを 2 つ渡すとエラーになる', () => {
    expect(() => parseArgs(['1.1.0', '1.2.0'])).toThrow(/1\.2\.0/);
  });

  it('未知のフラグでエラーになる', () => {
    expect(() => parseArgs(['1.1.0', '--force'])).toThrow(/--force/);
  });

  it('--notes の値が欠けているとエラーになる', () => {
    expect(() => parseArgs(['1.1.0', '--notes'])).toThrow(/--notes/);
    expect(() => parseArgs(['1.1.0', '--notes', '--yes'])).toThrow(/--notes/);
  });
});

describe('parseCommitLog', () => {
  it('行に分割し空行を除去する', () => {
    const raw = '- feat: A を追加\n\n- fix: B を修正\n';
    expect(parseCommitLog(raw)).toEqual(['- feat: A を追加', '- fix: B を修正']);
  });

  it('CRLF を除去する', () => {
    expect(parseCommitLog('- feat: A\r\n- fix: B\r\n')).toEqual(['- feat: A', '- fix: B']);
  });

  it('空入力で空配列を返す', () => {
    expect(parseCommitLog('')).toEqual([]);
    expect(parseCommitLog('   \n  \n')).toEqual([]);
    expect(parseCommitLog(null)).toEqual([]);
  });
});

describe('buildCommitMessage', () => {
  it('件名 + 空行 + コミット一覧を組み立てる', () => {
    const message = buildCommitMessage({
      version: '1.1.0',
      commitLines: ['- feat: A を追加', '- fix: B を修正'],
    });
    expect(message).toBe('chore: v1.1.0\n\n- feat: A を追加\n- fix: B を修正\n');
  });

  it('コミットが 0 件ならフォールバック文言を使う', () => {
    const message = buildCommitMessage({ version: '1.1.0', commitLines: [] });
    expect(message).toBe(`chore: v1.1.0\n\n${FALLBACK_CHANGELOG_LINE}\n`);
  });

  it('notes 指定時はコミット一覧より優先する', () => {
    const message = buildCommitMessage({
      version: '1.1.0',
      commitLines: ['- feat: 無視される'],
      notes: '- 手動ノート1\n- 手動ノート2',
    });
    expect(message).toBe('chore: v1.1.0\n\n- 手動ノート1\n- 手動ノート2\n');
  });

  it('notes の余分な前後空白を落として末尾は改行 1 つにする', () => {
    const message = buildCommitMessage({
      version: '1.1.0',
      commitLines: [],
      notes: '\n\n- 手動ノート\n\n\n',
    });
    expect(message).toBe('chore: v1.1.0\n\n- 手動ノート\n');
  });

  it('notes が空白のみならフォールバック文言を使う', () => {
    const message = buildCommitMessage({ version: '1.1.0', commitLines: [], notes: '   ' });
    expect(message).toBe(`chore: v1.1.0\n\n${FALLBACK_CHANGELOG_LINE}\n`);
  });
});
