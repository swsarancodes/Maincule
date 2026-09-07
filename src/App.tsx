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
      {/* Sidebar */}
      <Sidebar />

      {/* Main Workspace */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Tab & Mode Bar */}
        <TabBar />

        {/* Editor & Outline Area */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', display: 'flex' }}>
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

          {/* Document Outline Drawer */}
          <DocumentOutline />
        </div>

        {/* Status Bar */}
        <StatusBar />
      </div>

      {/* Command Palette (⌘K) */}
      <CommandPalette />

      {/* Full-Text Workspace Search (⌘⇧F) */}
      <FullTextSearchModal />
    </div>
  );
};

export default App;
