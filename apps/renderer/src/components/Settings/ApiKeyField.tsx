import { useEffect, useState } from 'react';
import type { FredKeyStatus } from '@kanata/shared-types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function ApiKeyField() {
  const [status, setStatus] = useState<FredKeyStatus | null>(null);
  const [input, setInput] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    let cancelled = false;
    window.kanata?.getFredKeyStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const encryptionUnavailable = status !== null && !status.encryptionAvailable;

  const handleSave = async () => {
    if (!window.kanata || input.trim().length === 0) return;
    setSaveState('saving');
    try {
      const next = await window.kanata.setFredKey(input.trim());
      setStatus(next);
      setInput('');
      setSaveState(next.configured ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
  };

  const handleClear = async () => {
    if (!window.kanata) return;
    setSaveState('saving');
    try {
      const next = await window.kanata.clearFredKey();
      setStatus(next);
      setSaveState('idle');
    } catch {
      setSaveState('error');
    }
  };

  return (
    <div className="tweaks-row">
      <div className="tweak-label">FRED API キー</div>

      <div className="apikey-status">
        {status?.configured ? (
          <span className="apikey-badge on">設定済み</span>
        ) : (
          <span className="apikey-badge">未設定</span>
        )}
        {saveState === 'saved' && <span className="apikey-hint">保存しました</span>}
        {saveState === 'error' && <span className="apikey-hint err">保存に失敗しました</span>}
        {saveState === 'saving' && <span className="apikey-hint">適用中…</span>}
      </div>

      {encryptionUnavailable ? (
        <div className="apikey-hint err">この環境では OS 暗号化が利用できないため保存できません</div>
      ) : (
        <>
          <input
            className="apikey-input"
            type="password"
            value={input}
            placeholder={status?.configured ? '新しいキーで上書き' : 'キーを入力'}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="apikey-actions">
            <button
              type="button"
              className="chip"
              onClick={handleSave}
              disabled={input.trim().length === 0 || saveState === 'saving'}
            >
              保存
            </button>
            {status?.configured && (
              <button
                type="button"
                className="chip"
                onClick={handleClear}
                disabled={saveState === 'saving'}
              >
                削除
              </button>
            )}
          </div>
          <a
            className="apikey-link"
            href="https://fredaccount.stlouisfed.org/apikeys"
            target="_blank"
            rel="noopener noreferrer"
          >
            無料キーを取得 →
          </a>
        </>
      )}
    </div>
  );
}
