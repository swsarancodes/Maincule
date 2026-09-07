import React, { useState, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import {
  Search,
  Eye,
  Code,
  Columns,
  Moon,
  Sun,
  Plus,
  FileText,
  PanelLeft,
  ListTree,
  Printer,
  FileDown,
  Sliders,
  AlignLeft,
  History,
} from 'lucide-react';
import { formatDisplayName } from '../../core/document/file-meta';
import { exportToPdf, exportToMarkdown, exportToHtml } from '../../core/document/export';

interface CommandItem {
  id: string;
  title: string;
  category: string;
  icon: any;
  shortcut?: string;
  run: () => void;
}

export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setMode = useSettingsStore((s) => s.setMode);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const toggleOutline = useSettingsStore((s) => s.toggleOutline);
  const toggleSearchModal = useSettingsStore((s) => s.toggleSearchModal);
  const typewriterMode = useSettingsStore((s) => s.typewriterMode);
  const toggleTypewriter = useSettingsStore((s) => s.toggleTypewriter);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const setFocusMode = useSettingsStore((s) => s.setFocusMode);

  const createEmpty = useWorkspaceStore((s) => s.createEmptyDocument);
  const setActiveDoc = useWorkspaceStore((s) => s.setActiveDocument);
  const openRecentPath = useWorkspaceStore((s) => s.openRecentPath);

  // Global shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        setOpen((prev) => !prev);
        setSearch('');
        setSelectedIndex(0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        setMode('hybrid');
      } else if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault();
        setMode('source');
      } else if ((e.metaKey || e.ctrlKey) && e.key === '3') {
        e.preventDefault();
        setMode('split');
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        createEmpty();
      } else if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleTypewriter();
      } else if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const next = focusMode === 'off' ? 'paragraph' : focusMode === 'paragraph' ? 'sentence' : 'off';
        setFocusMode(next);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setMode, toggleSidebar, createEmpty, toggleTypewriter, focusMode, setFocusMode]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const commands: CommandItem[] = [
    {
      id: 'mode-hybrid',
      title: 'Switch to Hybrid View (Concealed Syntax)',
      category: 'View Mode',
      icon: Eye,
      shortcut: '⌘1',
      run: () => setMode('hybrid'),
    },
    {
      id: 'mode-source',
      title: 'Switch to Source View (Raw Markdown)',
      category: 'View Mode',
      icon: Code,
      shortcut: '⌘2',
      run: () => setMode('source'),
    },
    {
      id: 'mode-split',
      title: 'Switch to Split View (Side by Side)',
      category: 'View Mode',
      icon: Columns,
      shortcut: '⌘3',
      run: () => setMode('split'),
    },
    {
      id: 'toggle-sidebar',
      title: 'Toggle Sidebar',
      category: 'Layout',
      icon: PanelLeft,
      shortcut: '⌘\\',
      run: () => toggleSidebar(),
    },
    {
      id: 'toggle-outline',
      title: 'Toggle Document Outline',
      category: 'Layout',
      icon: ListTree,
      shortcut: '⌘⇧O',
      run: () => toggleOutline(),
    },
    {
      id: 'doc-find',
      title: 'Find in Document',
      category: 'Edit',
      icon: Search,
      shortcut: '⌘F',
      run: () => {
        window.dispatchEvent(new CustomEvent('as:open-find'));
      },
    },
    {
      id: 'doc-replace',
      title: 'Find and Replace in Document',
      category: 'Edit',
      icon: Search,
      shortcut: '⌥⌘F',
      run: () => {
        window.dispatchEvent(new CustomEvent('as:open-replace-request'));
      },
    },
    {
      id: 'workspace-search',
      title: 'Search All Notes in Workspace',
      category: 'Navigation',
      icon: Search,
      shortcut: '⌘⇧F',
      run: () => toggleSearchModal(),
    },
    {
      id: 'toggle-typewriter',
      title: `Toggle Typewriter Mode (${typewriterMode ? 'Active' : 'Disabled'})`,
      category: 'Writing Environment',
      icon: AlignLeft,
      shortcut: '⌥⌘T',
      run: () => toggleTypewriter(),
    },
    {
      id: 'toggle-focus',
      title: `Cycle Focus Mode (Currently ${focusMode.toUpperCase()})`,
      category: 'Writing Environment',
      icon: Sliders,
      shortcut: '⌥⌘F',
      run: () => {
        const next = focusMode === 'off' ? 'paragraph' : focusMode === 'paragraph' ? 'sentence' : 'off';
        setFocusMode(next);
      },
    },
    {
      id: 'new-doc',
      title: 'Create New Document',
      category: 'File',
      icon: Plus,
      shortcut: '⌘N',
      run: () => createEmpty(),
    },
    {
      id: 'export-pdf',
      title: 'Export Document to PDF',
      category: 'Export',
      icon: Printer,
      shortcut: '⌥⌘P',
      run: () => exportToPdf(),
    },
    {
      id: 'export-md',
      title: 'Save Document as Markdown (.md)',
      category: 'Export',
      icon: FileDown,
      run: () => {
        const doc = useWorkspaceStore.getState().documents.find(
          (d) => d.id === useWorkspaceStore.getState().activeDocumentId
        );
        if (doc) exportToMarkdown(doc.meta.fileName, doc.currentText);
      },
    },
    {
      id: 'export-html',
      title: 'Export Document to HTML (.html)',
      category: 'Export',
      icon: FileText,
      run: () => {
        const doc = useWorkspaceStore.getState().documents.find(
          (d) => d.id === useWorkspaceStore.getState().activeDocumentId
        );
        if (doc) exportToHtml(doc.meta.fileName, doc.currentText);
      },
    },
    {
      id: 'toggle-theme',
      title: `Toggle Theme (Currently ${theme})`,
      category: 'Appearance',
      icon: theme === 'light' ? Moon : Sun,
      run: () => setTheme(theme === 'light' ? 'dark' : 'light'),
    },
    ...(open
      ? useWorkspaceStore.getState().documents.map((doc) => ({
          id: `open-doc-${doc.id}`,
          title: `Jump to note: ${formatDisplayName(doc.meta.fileName)}`,
          category: 'Opened Notes',
          icon: FileText,
          run: () => setActiveDoc(doc.id),
        }))
      : []),
    ...(open
      ? (() => {
          const st = useWorkspaceStore.getState();
          const openPaths = new Set(
            st.documents.filter((d) => !d.deletedAt && d.meta.filePath).map((d) => d.meta.filePath as string)
          );
          return st.recentPaths
            .filter((p) => !openPaths.has(p))
            .slice(0, 8)
            .map((path) => ({
              id: `recent-${path}`,
              title: `Reopen: ${formatDisplayName(path.split(/[/\\]/).pop() || path)}`,
              category: 'Recent',
              icon: History,
              run: () => void openRecentPath(path),
            }));
        })()
      : []),
  ];

  const filtered = commands.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (cmd: CommandItem) => {
    cmd.run();
    setOpen(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="as-command-palette"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '560px',
          maxHeight: '440px',
          backgroundColor: 'var(--as-bg-surface)',
          borderRadius: 'var(--as-radius-md)',
          boxShadow: 'var(--as-shadow-lg)',
          border: '1px solid var(--as-border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            borderBottom: '1px solid var(--as-border)',
          }}
        >
          <Search size={16} style={{ color: 'var(--as-text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command or search notes…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              color: 'var(--as-text)',
              fontFamily: 'inherit',
            }}
          />
          <kbd
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: 'var(--as-bg-subtle)',
              border: '1px solid var(--as-border)',
              color: 'var(--as-text-muted)',
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--as-text-muted)',
                fontSize: '13px',
              }}
            >
              No matching commands or notes found
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;
              return (
                <div
                  key={cmd.id}
                  onClick={() => handleSelect(cmd)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--as-radius-sm)',
                    backgroundColor: isSelected ? 'var(--as-bg-subtle)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Icon size={15} style={{ color: 'var(--as-text-muted)' }} />
                    <span style={{ fontSize: '13px', color: 'var(--as-text)', fontWeight: 500 }}>
                      {cmd.title}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--as-text-dim)' }}>
                      {cmd.category}
                    </span>
                    {cmd.shortcut && (
                      <kbd
                        style={{
                          fontSize: '10px',
                          padding: '2px 5px',
                          borderRadius: '3px',
                          background: 'var(--as-bg-surface)',
                          border: '1px solid var(--as-border)',
                          color: 'var(--as-text-muted)',
                        }}
                      >
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
