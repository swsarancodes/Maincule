import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { searchWorkspace, SearchSnippet } from '../../core/search/full-text-search';
import { Search, FileText, X, CornerDownLeft, ArrowDown, ArrowUp } from 'lucide-react';

interface FlatItem {
  type: 'doc-header' | 'snippet';
  docId: string;
  docTitle: string;
  snippet?: SearchSnippet;
}

export const FullTextSearchModal: React.FC = () => {
  const isOpen = useSettingsStore((s) => s.searchModalOpen);
  const setIsOpen = useSettingsStore((s) => s.setSearchModalOpen);
  const documents = useWorkspaceStore((s) => s.documents);
  const setActiveDoc = useWorkspaceStore((s) => s.setActiveDocument);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
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

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return searchWorkspace(documents, query);
  }, [documents, query]);

  // Flatten searchable interactive items for arrow key navigation
  const flatItems: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    for (const res of searchResults) {
      if (res.snippets.length === 0) {
        // Document matched by title only
        items.push({
          type: 'doc-header',
          docId: res.docId,
          docTitle: res.title,
        });
      } else {
        for (const snip of res.snippets) {
          items.push({
            type: 'snippet',
            docId: res.docId,
            docTitle: res.title,
            snippet: snip,
          });
        }
      }
    }
    return items;
  }, [searchResults]);

  // Keep selected index within bounds
  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, selectedIndex]);

  const handleSelect = (item: FlatItem) => {
    setActiveDoc(item.docId);
    if (item.snippet) {
      window.dispatchEvent(
        new CustomEvent('as:scroll-to-line', {
          detail: { line: item.snippet.line, pos: item.snippet.pos },
        })
      );
    }
    setIsOpen(false);
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
      if (current) handleSelect(current);
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
                  key={`match-${item.docId}-${snip ? snip.pos : 'title'}-${idx}`}
                  onClick={() => handleSelect(item)}
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
