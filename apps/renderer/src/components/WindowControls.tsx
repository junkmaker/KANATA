import { useEffect, useState } from 'react';

export function WindowControls() {
  const api = window.kanata;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    void api.isWindowMaximized().then(setMaximized);
    const unsub = api.onMaximizeChange(setMaximized);
    return unsub;
  }, []);

  if (!api) return null;

  return (
    <div className="win-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        type="button"
        className="win-btn win-btn-min"
        onClick={() => void api.minimizeWindow()}
        title="最小化"
        aria-label="最小化"
      >
        <svg aria-hidden="true" width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn win-btn-max"
        onClick={() => void api.maximizeWindow()}
        title={maximized ? '元に戻す' : '最大化'}
        aria-label={maximized ? '元に戻す' : '最大化'}
      >
        {maximized ? (
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="2"
              y="0"
              width="8"
              height="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <rect
              x="0"
              y="2"
              width="8"
              height="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-btn win-btn-close"
        onClick={() => void api.closeWindow()}
        title="閉じる"
        aria-label="閉じる"
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
