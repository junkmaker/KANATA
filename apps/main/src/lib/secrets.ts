import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { mainLogger as log } from './logger.js';

/**
 * ユーザーの API キー等の秘匿値を OS 暗号化 (Windows: DPAPI) で保存する。
 *
 * 平文では一切ディスクに書かない。`safeStorage` が利用不可な環境では保存を拒否し、
 * 呼び出し側に false を返す（フォールバックで平文保存はしない）。
 */

const SECRETS_FILE = 'fred-api-key.bin';

function secretPath(): string {
  return join(app.getPath('userData'), SECRETS_FILE);
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function getFredApiKey(): string | null {
  const path = secretPath();
  if (!existsSync(path)) return null;
  if (!isEncryptionAvailable()) {
    log.warn('safeStorage unavailable; cannot decrypt FRED key');
    return null;
  }
  try {
    const encrypted = readFileSync(path);
    const decrypted = safeStorage.decryptString(encrypted).trim();
    return decrypted.length > 0 ? decrypted : null;
  } catch (err) {
    log.error(`Failed to read FRED key: ${String(err)}`);
    return null;
  }
}

export function isFredKeyConfigured(): boolean {
  return getFredApiKey() !== null;
}

/** キーを保存する。成功時 true、暗号化不可・保存失敗時 false。値はログに残さない。 */
export function setFredApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return clearFredApiKey();
  }
  if (!isEncryptionAvailable()) {
    log.warn('safeStorage unavailable; refusing to store FRED key in plaintext');
    return false;
  }
  try {
    const encrypted = safeStorage.encryptString(trimmed);
    writeFileSync(secretPath(), encrypted);
    log.info('FRED key saved');
    return true;
  } catch (err) {
    log.error(`Failed to save FRED key: ${String(err)}`);
    return false;
  }
}

export function clearFredApiKey(): boolean {
  const path = secretPath();
  try {
    if (existsSync(path)) unlinkSync(path);
    log.info('FRED key cleared');
    return true;
  } catch (err) {
    log.error(`Failed to clear FRED key: ${String(err)}`);
    return false;
  }
}
