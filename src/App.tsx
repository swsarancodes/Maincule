import React, { useEffect } from 'react';
import { useSettingsStore } from './app/stores/settings';
import { useWorkspaceStore } from './app/stores/workspace';
import { Sidebar } from './app/components/Sidebar';
import { TabBar } from './app/components/TabBar';
import { EditorPane } from './app/components/EditorPane';
import { DocumentOutline } from './app/components/DocumentOutline';
import { StatusBar } from './app/components/StatusBar';
import { CommandPalette } from './app/components/CommandPalette';
import { FullTextSearchModal } from './app/components/FullTextSearchModal';
import './editor/theme/base.css';

export const App: React.FC = () => {
  const theme = useSettingsStore((s) => s.theme);
  const mode = useSettingsStore((s) => s.mode);
  const zenMode = useSettingsStore((s) => s.zenMode);
  const setZenMode = useSettingsStore((s) => s.setZenMode);

  const [isMobile, setIsMobile] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync theme to root attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Zen mode: reflect in DOM for CSS hooks and allow Esc to exit when no
  // modal is open (palette/search handle their own Esc first).
  useEffect(() => {
    document.documentElement.setAttribute('data-zen', zenMode ? 'true' : 'false');
  }, [zenMode]);

  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useSettingsStore.getState();
      if (st.searchModalOpen) return; // search modal consumes Esc
      // CommandPalette consumes its own Esc when open; exit zen otherwise.
      st.setZenMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zenMode]);

  // A persisted vault root survives reloads; its entries don't — rescan once
  // the store has rehydrated so the sidebar tree comes back on launch.
  // startVaultSync also (re)arms the backend watcher for the restored root.
  // rehydrateVaultDocs then reconciles each reopened tab against disk:
  // clean tabs silently adopt external edits, dirty tabs raise the banner.
  useEffect(() => {
    const store = useWorkspaceStore.getState();
    store.startVaultSync();
    void (async () => {
      await store.refreshVault();
      await store.rehydrateVaultDocs();
    })();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'var(--as-bg)',
        color: 'var(--as-text)',
        overflow: 'hidden',
        fontFamily: 'var(--as-font-body)',
      }}
    >
      {/* Sidebar (hidden in zen) */}
      {!zenMode && <Sidebar />}

      {/* Main Workspace */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          // Zen: calm centered column with breathing room.
          alignItems: zenMode ? 'center' : undefined,
          paddingTop: zenMode ? '6vh' : undefined,
          backgroundColor: zenMode ? 'var(--as-bg)' : undefined,
        }}
      >
        {/* Tab & Mode Bar (hidden in zen) */}
        {!zenMode && <TabBar />}

        {/* Editor & Outline Area */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            width: zenMode ? 'min(78ch, 92vw)' : undefined,
            maxWidth: zenMode ? '100%' : undefined,
          }}
        >
          {mode === 'split' ? (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: isMobile ? '50%' : '100%',
                  borderRight: isMobile ? 'none' : '1px solid var(--as-border)',
                  borderBottom: isMobile ? '1px solid var(--as-border)' : 'none',
                  overflow: 'hidden',
                }}
              >
                <EditorPane modeOverride="hybrid" />
              </div>
              <div style={{ flex: 1, minWidth: 0, height: isMobile ? '50%' : '100%', overflow: 'hidden' }}>
                <EditorPane modeOverride="source" />
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
              <EditorPane />
            </div>
          )}

          {/* Document Outline Drawer (hidden in zen) */}
          {!zenMode && <DocumentOutline />}
        </div>

        {/* Status Bar (hidden in zen) */}
        {!zenMode && <StatusBar />}

        {/* Zen exit affordance */}
        {zenMode && (
          <button
            type="button"
            onClick={() => setZenMode(false)}
            title="Exit zen mode (Esc)"
            style={{
              position: 'fixed',
              bottom: '18px',
              right: '20px',
              background: 'var(--as-bg-surface)',
              border: '1px solid var(--as-border)',
              borderRadius: '999px',
              padding: '6px 12px',
              fontSize: '11px',
              color: 'var(--as-text-muted)',
              cursor: 'pointer',
              opacity: 0.7,
              zIndex: 5000,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
          >
            Exit zen · Esc
          </button>
        )}
      </div>

      {/* Command Palette (⌘K) */}
      <CommandPalette />

      {/* Full-Text Workspace Search (⌘⇧F) */}
      <FullTextSearchModal />
    </div>
  );
};

export default App;
