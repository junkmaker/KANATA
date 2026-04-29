import { useState } from 'react';
import type { Watchlist } from '../../types';

interface WatchlistSelectorProps {
  watchlists: Watchlist[];
  activeId: number | null;
  status: 'loading' | 'ready' | 'offline';
  editing: boolean;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onToggleEdit: () => void;
}

export function WatchlistSelector({
  watchlists,
  activeId,
  status,
  editing,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onToggleEdit,
}: WatchlistSelectorProps) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const active = watchlists.find(w => w.id === activeId) || null;

  const handleCreate = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    await onCreate(trimmed);
    setDraftName('');
    setCreating(false);
  };

  const handleRename = async () => {
    const trimmed = renameDraft.trim();
    if (renamingId !== null && trimmed) {
      await onRename(renamingId, trimmed);
    }
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleDelete = async (id: number) => {
    if (watchlists.length <= 1) return;
    const target = watchlists.find(w => w.id === id);
    if (!target) return;
    if (!confirm(`「${target.name}」を削除しますか？`)) return;
    await onDelete(id);
  };

  return (
    <div className="watchlist-selector">
      <div className="ws-row">
        <select
          className="ws-select"
          value={activeId ?? ''}
          onChange={e => onSelect(Number(e.target.value))}
          disabled={status !== 'ready' || watchlists.length === 0}
        >
          {status === 'loading' && <option value="">Loading…</option>}
          {status === 'offline' && <option value="">Offline</option>}
          {watchlists.map(w => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.items.length})
            </option>
          ))}
        </select>
        <button
          className={`ws-btn${editing ? ' active' : ''}`}
          onClick={onToggleEdit}
          disabled={status !== 'ready'}
          title="編集モード"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
        <button
          className="ws-btn"
          onClick={() => setCreating(true)}
          disabled={status !== 'ready'}
          title="新規リスト"
        >
          +
        </button>
      </div>

      {creating && (
        <div className="ws-row">
          <input
            className="ws-input"
            autoFocus
            placeholder="リスト名"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setCreating(false); setDraftName(''); }
            }}
          />
          <button className="ws-btn" onClick={handleCreate}>OK</button>
          <button className="ws-btn" onClick={() => { setCreating(false); setDraftName(''); }}>×</button>
        </div>
      )}

      {editing && active && (
        <div className="ws-row ws-edit-row">
          {renamingId === active.id ? (
            <>
              <input
                className="ws-input"
                autoFocus
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
              <button className="ws-btn" onClick={handleRename}>OK</button>
            </>
          ) : (
            <>
              <button
                className="ws-btn"
                onClick={() => { setRenamingId(active.id); setRenameDraft(active.name); }}
              >
                Rename
              </button>
              <button
                className="ws-btn ws-btn-danger"
                onClick={() => handleDelete(active.id)}
                disabled={watchlists.length <= 1}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
