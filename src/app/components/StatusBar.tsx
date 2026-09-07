import React from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { Moon, Sun } from 'lucide-react';

export const StatusBar: React.FC = () => {
  const line = useWorkspaceStore((s) => s.cursorLine);
  const col = useWorkspaceStore((s) => s.cursorCol);
  const wordCount = useWorkspaceStore((s) => s.wordCount);
  const charCount = useWorkspaceStore((s) => s.charCount);
  const readingTime = useWorkspaceStore((s) => s.readingTimeMin);
  const lineEnding = useWorkspaceStore((s) => {
    const doc = s.documents.find((d) => d.id === s.activeDocumentId);
    return doc?.meta.lineEnding || 'lf';
  });

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const typewriterMode = useSettingsStore((s) => s.typewriterMode);
  const toggleTypewriter = useSettingsStore((s) => s.toggleTypewriter);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const setFocusMode = useSettingsStore((s) => s.setFocusMode);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <div
      className="as-statusbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '28px',
        backgroundColor: 'var(--as-bg-surface)',
        borderTop: '1px solid var(--as-border)',
        padding: '0 12px',
        fontSize: '11.5px',
        color: 'var(--as-text-dim)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Left side: word statistics */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minWidth: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <span>
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
        <span className="as-status-extra">•</span>
        <span className="as-status-extra">{charCount} chars</span>
        <span className="as-status-extra">•</span>
        <span className="as-status-extra">{readingTime} min read</span>
      </div>

      {/* Right side: cursor coordinates, typewriter/focus mode, encoding, theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* Typewriter mode toggle */}
        <button
          type="button"
          onClick={toggleTypewriter}
          title={`Typewriter Mode: ${typewriterMode ? 'Active (Centered)' : 'Off'}`}
          style={{
            background: typewriterMode ? 'var(--as-accent-subtle)' : 'none',
            border: typewriterMode ? '1px solid var(--as-accent)' : 'none',
            borderRadius: 'var(--as-radius-sm)',
            color: typewriterMode ? 'var(--as-accent)' : 'var(--as-text-muted)',
            cursor: 'pointer',
            padding: '1px 5px',
            fontSize: '11px',
            fontWeight: typewriterMode ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Typewriter
        </button>

        {/* Focus mode toggle */}
        <button
          type="button"
          onClick={() => {
            const next = focusMode === 'off' ? 'paragraph' : focusMode === 'paragraph' ? 'sentence' : 'off';
            setFocusMode(next);
          }}
          title={`Focus Mode: ${focusMode.toUpperCase()} (Click to cycle)`}
          style={{
            background: focusMode !== 'off' ? 'var(--as-accent-subtle)' : 'none',
            border: focusMode !== 'off' ? '1px solid var(--as-accent)' : 'none',
            borderRadius: 'var(--as-radius-sm)',
            color: focusMode !== 'off' ? 'var(--as-accent)' : 'var(--as-text-muted)',
            cursor: 'pointer',
            padding: '1px 5px',
            fontSize: '11px',
            fontWeight: focusMode !== 'off' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Focus{focusMode !== 'off' ? `: ${focusMode}` : ''}
        </button>

        <span className="as-status-extra">•</span>

        <span>
          Ln {line}, Col {col}
        </span>
        <span className="as-status-extra">•</span>
        <span className="as-status-extra">
          {lineEnding === 'crlf' ? 'CRLF' : 'LF'} • UTF-8
        </span>

        <button
          type="button"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Theme`}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--as-text-muted)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {theme === 'light' ? <Moon size={13} /> : <Sun size={13} />}
        </button>
      </div>
    </div>
  );
};
