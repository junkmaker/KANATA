import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { ScreeningUniverse } from '../../types';

type Props = {
  universes: ScreeningUniverse[];
  selectedId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRegister: (file: File) => void;
  onRemove: (id: string) => void;
  actionError: string | null;
};

export function UniverseSelect({
  universes,
  selectedId,
  disabled,
  onSelect,
  onRegister,
  onRemove,
  actionError,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = universes.find((u) => u.id === selectedId);
  const canRemove = selected != null && !selected.builtin;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onRegister(file);
    // 同一ファイルの再選択でも onChange が発火するようにリセット
    e.target.value = '';
  };

  const handleRemove = () => {
    if (!selected || selected.builtin) return;
    if (window.confirm(`「${selected.name}」を削除しますか?`)) {
      onRemove(selected.id);
    }
  };

  return (
    <>
      <label className="screening-universe">
        ユニバース
        <select
          className="screening-universe-select"
          value={selectedId}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
        >
          {universes.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol_count})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="screening-universe-btn"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
      >
        CSV登録
      </button>
      <button
        type="button"
        className="screening-universe-btn"
        onClick={handleRemove}
        disabled={disabled || !canRemove}
      >
        削除
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="screening-universe-file"
        onChange={handleFileChange}
      />
      {actionError && <span className="screening-universe-error">{actionError}</span>}
    </>
  );
}
