import { useCallback, useRef, useState } from 'react';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';
import type { SearchResult } from '../../types';

const JP_CODE_RE = /^\d{4}$/;

function inferMarket(sym: string): 'JP' | 'US' {
  return JP_CODE_RE.test(sym.trim()) ? 'JP' : 'US';
}

interface AddSymbolFormProps {
  activeListId: number | null;
  existingSymbols: Set<string>;
  onAdd: (symbol: string, market: string, displayName?: string) => Promise<void>;
  disabled?: boolean;
}

export function AddSymbolForm({ activeListId, existingSymbols, onAdd, disabled }: AddSymbolFormProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, loading } = useDebouncedSearch(query);

  const candidates = results.filter(r => !existingSymbols.has(r.code));

  const resetForm = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    setLocalError(null);
  }, []);

  const submit = useCallback(async (target: SearchResult | null) => {
    const trimmed = query.trim().toUpperCase();
    if (!trimmed || submitting || !activeListId) return;

    const sym = target?.code ?? trimmed;
    const market = target?.market ?? inferMarket(trimmed);
    const displayName = target?.name;

    if (existingSymbols.has(sym)) {
      setLocalError(`${sym} は既にリストにあります`);
      return;
    }

    setSubmitting(true);
    setLocalError(null);
    try {
      await onAdd(sym, market, displayName);
      resetForm();
      inputRef.current?.focus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '追加に失敗しました';
      if (msg.includes('409') || msg.includes('already')) {
        setLocalError(`${sym} は既にリストにあります`);
      } else {
        setLocalError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [query, submitting, activeListId, existingSymbols, onAdd, resetForm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const candidate = candidates[selectedIndex] ?? null;
      submit(candidate);
    } else if (e.key === 'Escape') {
      resetForm();
      inputRef.current?.blur();
    }
  }, [candidates, selectedIndex, submit, resetForm]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(0);
    setLocalError(null);
  };

  const isDisabled = disabled || submitting || !activeListId;

  return (
    <div className="add-symbol-form">
      <div className="add-symbol-row">
        <input
          ref={inputRef}
          className="search-input add-symbol-input"
          placeholder="銘柄コード・ティッカーで追加…"
          value={query}
          disabled={isDisabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <span className="add-symbol-spinner">…</span>}
      </div>

      {localError && (
        <div className="add-symbol-error">{localError}</div>
      )}

      {candidates.length > 0 && query.trim() && (
        <ul className="suggest-list">
          {candidates.map((r, i) => (
            <li
              key={r.code}
              className={`suggest-item${i === selectedIndex ? ' active' : ''}`}
              onMouseDown={e => { e.preventDefault(); submit(r); }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="suggest-code">{r.code}</span>
              <span className="suggest-mkt">{r.market}</span>
              <span className="suggest-name">{r.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
