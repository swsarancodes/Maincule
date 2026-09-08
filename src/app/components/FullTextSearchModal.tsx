import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { searchWorkspace, SearchSnippet } from '../../core/search/full-text-search';
import { searchVault, type VaultSearchHit } from '../../ipc/search';
import { isTauriEnvironment } from '../../ipc/client';
import { Search, FileText, X, CornerDownLeft, ArrowDown, ArrowUp } from 'lucide-react';

interface FlatItem {
  type: 'doc-header' | 'snippet';
  docId: string | null;
  filePath: string | null;
  docTitle: string;
  isVaultOnly?: boolean;
  snippet?: SearchSnippet;
}

/** Find highlight offsets for a vault snippet using the first query word. */
function vaultMatchOffsets(snippet: string, query: string): [number, number] {
  const anchor =
    query
      .toLowerCase()
      .split(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]+/i)
      .find((w) => w.length > 0) ?? query.trim().toLowerCase();
  if (!anchor) return [0, 0];
  const idx = snippet.toLowerCase().indexOf(anchor);
  if (idx === -1) return [0, 0];
  return [idx, idx + anchor.length];
}

export const FullTextSearchModal: React.FC = () => {
  const isOpen = useSettingsStore((s) => s.searchModalOpen);
  const setIsOpen = useSettingsStore((s) => s.setSearchModalOpen);
  const documents = useWorkspaceStore((s) => s.documents);
  const setActiveDoc = useWorkspaceStore((s) => s.setActiveDocument);
  const openVaultFile = useWorkspaceStore((s) => s.openVaultFile);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [vaultHits, setVaultHits] = useState<VaultSearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setVaultHits([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Global shortcut (⌘⇧F / Ctrl+Shift+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  // Debounce the query for both in-memory and disk search so fast typing
  // doesn't re-scan open docs on every keystroke. 120ms keeps it lively.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    if (!isOpen) {
      setDebouncedQuery('');
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(t);
  }, [isOpen, query]);

  // In-memory results cover open tabs (fresh, includes unsaved edits).
  const memResults = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return searchWorkspace(documents, debouncedQuery);
  }, [documents, debouncedQuery]);

  // Vault FTS covers closed files on disk (desktop only, debounced).
  useEffect(() => {
    if (!isOpen || !debouncedQuery.trim() || !isTauriEnvironment()) {
      setVaultHits([]);
      return;
    }
    const q = debouncedQuery;
    const t = setTimeout(() => {
      void searchVault(q, 30)
        .then((hits) => {
          // Only apply results for the query that issued them.
          setVaultHits((prev) => {
            void prev;
            return hits;
          });
        })
        .catch(() => {});
    }, 60);
    return () => clearTimeout(t);
  }, [isOpen, debouncedQuery]);

  // Merge: open-tab results win; vault-only hits append closed files.
  const flatItems: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    const openPaths = new Set(
      documents.map((d) => d.meta.filePath).filter((p): p is string => !!p)
    );
    for (const res of memResults) {
      const doc = documents.find((d) => d.id === res.docId);
      const filePath = doc?.meta.filePath ?? null;
      if (res.snippets.length === 0) {
        items.push({
          type: 'doc-header',
          docId: res.docId,
          filePath,
          docTitle: res.title,
        });
      } else {
        for (const snip of res.snippets) {
          items.push({
            type: 'snippet',
            docId: res.docId,
            filePath,
            docTitle: res.title,
            snippet: snip,
          });
        }
      }
    }
    for (const hit of vaultHits) {
      if (openPaths.has(hit.path)) continue; // prefer fresh in-memory text
      const [ms, me] = vaultMatchOffsets(hit.snippet, debouncedQuery);
      const snippet: SearchSnippet = {
        line: hit.line,
        pos: 0,
        snippet: hit.snippet,
        matchStartInSnippet: ms,
        matchEndInSnippet: me,
      };
      items.push({
        type: 'snippet',
        docId: null,
        filePath: hit.path,
        docTitle: hit.title,
        isVaultOnly: true,
        snippet,
      });
      // Cap the rendered list: 100 interactive rows keeps arrow-key nav
      // and DOM cost flat even when a common word matches hundreds of notes.
      if (items.length >= 100) break;
    }
    return items.slice(0, 100);
  }, [memResults, vaultHits, documents, debouncedQuery]);

  // Keep selected index within bounds
  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, selectedIndex]);

  const handleSelect = async (item: FlatItem) => {
    try {
      if (item.docId) {
        setActiveDoc(item.docId);
      } else if (item.filePath) {
        await openVaultFile(item.filePath);
      } else {
        return;
      }
      if (item.snippet) {
        // Let the new tab mount before scrolling.
        const line = item.snippet.line;
        const pos = item.snippet.pos;
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('as:scroll-to-line', {
              detail: { line, pos },
            })
          );
        }, item.docId ? 0 : 150);
      }
    } finally {
      setIsOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = flatItems[selectedIndex];
      if (current) void handleSelect(current);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-Text Search"
      className="as-search-modal"
      onClick={() => setIsOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '640px',
          maxWidth: '92vw',
          maxHeight: '75vh',
          backgroundColor: 'var(--as-bg-surface)',
          border: '1px solid var(--as-border)',
          borderRadius: 'var(--as-radius-md, 8px)',
          boxShadow: 'var(--as-shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.25))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--as-border)',
            gap: '10px',
          }}
        >
          <Search size={18} style={{ color: 'var(--as-accent)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search across all notes and text..."
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              fontFamily: 'inherit',
              color: 'var(--as-text)',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: '4px',
                cursor: 'pointer',
                color: 'var(--as-text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px',
            maxHeight: '50vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {!query.trim() ? (
            <div
              style={{
                padding: '36px 20px',
                textAlign: 'center',
                color: 'var(--as-text-muted)',
                fontSize: '13px',
              }}
            >
              Type keywords to search across all document contents and titles.
            </div>
          ) : flatItems.length === 0 ? (
            <div
              style={{
                padding: '36px 20px',
                textAlign: 'center',
                color: 'var(--as-text-muted)',
                fontSize: '13px',
              }}
            >
              No matches found for "{query}".
            </div>
          ) : (
            flatItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const snip = item.snippet;

              return (
                <div
                  key={`match-${item.docId ?? item.filePath}-${snip ? snip.pos : 'title'}-${idx}`}
                  onClick={() => void handleSelect(item)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--as-radius-sm, 6px)',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'var(--as-bg-hover)' : 'transparent',
                    borderLeft: isSelected ? '2.5px solid var(--as-accent)' : '2.5px solid transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                    transition: 'background-color var(--as-transition-fast)',
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileText size={13} style={{ color: 'var(--as-accent)', opacity: 0.8 }} />
                      <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--as-text)' }}>
                        {item.docTitle}
                      </span>
                      {item.isVaultOnly && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--as-text-muted)',
                            border: '1px solid var(--as-border)',
                            borderRadius: '4px',
                            padding: '0 4px',
                          }}
                        >
                          vault
                        </span>
                      )}
                    </div>
                    {snip && (
                      <span style={{ fontSize: '11px', color: 'var(--as-text-muted)' }}>
                        Line {snip.line}
                      </span>
                    )}
                  </div>

                  {snip && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--as-text-muted)',
                        fontFamily: 'var(--as-font-mono, monospace)',
                        whiteSpace: 'pre-wrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        paddingLeft: '19px',
                      }}
                    >
                      <span>{snip.snippet.slice(0, snip.matchStartInSnippet)}</span>
                      <span
                        style={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: 'var(--as-accent)',
                          fontWeight: 600,
                          borderRadius: '2px',
                          padding: '0 2px',
                        }}
                      >
                        {snip.snippet.slice(snip.matchStartInSnippet, snip.matchEndInSnippet)}
                      </span>
                      <span>{snip.snippet.slice(snip.matchEndInSnippet)}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info & keyboard hints */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--as-border)',
            backgroundColor: 'var(--as-bg-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--as-text-muted)',
          }}
        >
          <span>
            {flatItems.length} {flatItems.length === 1 ? 'match' : 'matches'} found
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <ArrowUp size={11} />
              <ArrowDown size={11} /> Navigate
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <CornerDownLeft size={11} /> Select
            </span>
            <span>Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
};
