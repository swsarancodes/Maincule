import React, { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { createEditorExtensions, reconfigureEditorMode } from '../../editor/setup';
import { dataUrlToAsset } from '../../ipc/vault';
import { ViewMode } from '../../editor/modes/view-mode';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { FloatingToolbar } from './FloatingToolbar';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ImageModal } from './ImageModal';
import { SyncBanner } from './SyncBanner';
import { toggleInlineFormat, setHeadingLevel } from '../../editor/commands/formatting';
import { openSearchPanel } from '@codemirror/search';
import { Folder, FileText, Plus } from 'lucide-react';
import { formatDisplayName } from '../../core/document/file-meta';

interface EditorPaneProps {
  modeOverride?: ViewMode;
}

export const EditorPane: React.FC<EditorPaneProps> = ({ modeOverride }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const activeDocId = useWorkspaceStore((s) => s.activeDocumentId);
  const documents = useWorkspaceStore((s) => s.documents);
  const folders = useWorkspaceStore((s) => s.folders);
  const setActiveDoc = useWorkspaceStore((s) => s.setActiveDocument);
  const updateContent = useWorkspaceStore((s) => s.updateDocumentContent);
  const updateCursorStats = useWorkspaceStore((s) => s.updateCursorStats);

  const globalMode = useSettingsStore((s) => s.mode);
  const typewriterMode = useSettingsStore((s) => s.typewriterMode);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const effectiveMode = modeOverride || globalMode;

  // Refs mirror the latest values for long-lived CodeMirror callbacks, so the
  // view never needs to be recreated to pick up a mode/setting change.
  const effectiveModeRef = useRef(effectiveMode);
  effectiveModeRef.current = effectiveMode;
  const activeDocIdRef = useRef(activeDocId);
  activeDocIdRef.current = activeDocId;

  // Floating toolbar state (on text selection)
  const [floatingPos, setFloatingPos] = useState<{ top: number; left: number } | null>(null);
  const [linkRequested, setLinkRequested] = useState(false);

  // Slash command menu state (on typing / or clicking +)
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [slashRange, setSlashRange] = useState<{ from: number; to: number } | null>(null);

  // Image Modal state (for inserting and editing images)
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageTargetRange, setImageTargetRange] = useState<{ from: number; to: number } | null>(null);
  const [editingImageData, setEditingImageData] = useState<{ alt: string; url: string; title?: string } | null>(null);

  // Notion-style Empty Line '+' button state
  const [emptyLinePlus, setEmptyLinePlus] = useState<{
    top: number;
    height: number;
    plusLeft: number;
    cursorX: number;
    lineFrom: number;
    lineTo: number;
  } | null>(null);

  // Global keydown handler to ensure Cmd+B, Cmd+I, Cmd+E, Cmd+K work reliably
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (!viewRef.current || !viewRef.current.hasFocus) return;
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();
      if (key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleInlineFormat(viewRef.current, '**');
      } else if (key === 'i' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleInlineFormat(viewRef.current, '*');
      } else if (key === 'e' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleInlineFormat(viewRef.current, '`');
      } else if (key === 'k' && !e.shiftKey && !e.altKey) {
        const view = viewRef.current;
        const sel = view.state.selection.main;
        if (!sel.empty && effectiveModeRef.current !== 'source') {
          e.preventDefault();
          e.stopPropagation();
          setLinkRequested(true);
        }
      } else if ((key === 'x' || key === 's') && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleInlineFormat(viewRef.current, '~~');
      } else if (key === '1' && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        setHeadingLevel(viewRef.current, 1);
      } else if (key === '2' && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        setHeadingLevel(viewRef.current, 2);
      } else if (key === '3' && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        setHeadingLevel(viewRef.current, 3);
      } else if (key === 'f' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        openSearchPanel(viewRef.current);
        if (e.altKey) {
          window.dispatchEvent(new CustomEvent('as:open-replace'));
        }
      }
    };

    const handleFindEvent = () => {
      if (viewRef.current) {
        openSearchPanel(viewRef.current);
      }
    };

    const handleReplaceEvent = () => {
      if (viewRef.current) {
        openSearchPanel(viewRef.current);
        window.dispatchEvent(new CustomEvent('as:open-replace'));
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts, true);
    window.addEventListener('as:open-find', handleFindEvent);
    window.addEventListener('as:open-replace-request', handleReplaceEvent);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts, true);
      window.removeEventListener('as:open-find', handleFindEvent);
      window.removeEventListener('as:open-replace-request', handleReplaceEvent);
    };
  }, []);

  // Initialize the CodeMirror EditorView. Re-created ONLY when the active
  // document changes. Mode / typewriter / focus changes are applied live via
  // compartments (see the reconfigure effect below) so undo history,
  // selection, scroll position, and folds survive the toggle.
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous view before creating new one
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const currentDoc = useWorkspaceStore.getState().documents.find((d) => d.id === activeDocId);
    const initialText = currentDoc ? currentDoc.currentText : '';

    const extensions = createEditorExtensions({
      initialDoc: initialText,
      mode: effectiveMode,
      typewriterMode,
      focusMode,
      onDocChange: (newDoc) => {
        const id = activeDocIdRef.current;
        if (id) {
          updateContent(id, newDoc);
        }
      },
      onCursorChange: (line, col) => {
        const view = viewRef.current;
        if (!view) return;

        updateCursorStats(line, col);

        const sel = view.state.selection.main;

        // 1. Handle Floating Selection Toolbar
        if (!sel.empty && sel.to > sel.from && effectiveModeRef.current !== 'source') {
          const coords = view.coordsAtPos(sel.from);
          if (coords) {
            setFloatingPos({
              top: Math.max(10, coords.top - 46),
              left: Math.max(10, coords.left),
            });
          }
        } else {
          setFloatingPos(null);
        }

        // 2. Handle Live Slash Command (/) & Notion-style '+' button on empty line
        if (sel.empty && effectiveModeRef.current !== 'source') {
          const pos = sel.from;
          const lineObj = view.state.doc.lineAt(pos);
          const textBefore = lineObj.text.slice(0, pos - lineObj.from);

          // Trigger slash menu if cursor is preceded by / (start of line or after whitespace)
          const slashMatch = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
          if (slashMatch) {
            const slashIndexInLine = textBefore.lastIndexOf('/');
            const slashFrom = lineObj.from + slashIndexInLine;
            const query = slashMatch[1];
            const coords = view.coordsAtPos(pos);
            if (coords) {
              setSlashPos({
                top: coords.bottom,
                left: Math.max(10, coords.left),
              });
              setSlashQuery(query);
              setSlashRange({ from: slashFrom, to: pos });
              setSlashOpen(true);
              setEmptyLinePlus(null);
            }
          } else {
            setSlashOpen(false);
            if (lineObj.text.trim() === '') {
              requestAnimationFrame(() => updateEmptyPlusState());
            } else {
              setEmptyLinePlus(null);
            }
          }
        } else {
          setEmptyLinePlus(null);
          setSlashOpen(false);
        }
      },
    });

    const state = EditorState.create({
      doc: initialText,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Helper to calculate exact physical line position from target DOM element
    const updateEmptyPlusState = () => {
      const v = viewRef.current;
      if (!v || !containerRef.current) return;
      const sel = v.state.selection.main;
      if (!sel.empty) {
        setEmptyLinePlus(null);
        return;
      }
      const pos = sel.from;
      const lineObj = v.state.doc.lineAt(pos);
      if (effectiveModeRef.current === 'source' || lineObj.text.trim() !== '') {
        setEmptyLinePlus(null);
        return;
      }

      try {
        const domRes = v.domAtPos(pos);
        const lineEl = (domRes.node.nodeType === 1 ? domRes.node : domRes.node.parentElement) as HTMLElement | null;
        const targetLine = lineEl?.classList.contains('cm-line') ? lineEl : lineEl?.closest('.cm-line');

        if (targetLine) {
          const lineRect = targetLine.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();

          if (lineRect.height > 0 && lineRect.bottom >= containerRect.top && lineRect.top <= containerRect.bottom) {
            const lineX = lineRect.left - containerRect.left;
            const lineY = lineRect.top - containerRect.top;
            const height = lineRect.height;
            const plusLeft = lineX - 32;

            setEmptyLinePlus({
              top: lineY,
              height,
              plusLeft,
              cursorX: lineX,
              lineFrom: lineObj.from,
              lineTo: lineObj.to,
            });
            return;
          }
        }
      } catch {
        // ignore
      }

      setEmptyLinePlus(null);
    };

    // Recompute the floating toolbar anchor from the live selection, so it
    // tracks the selected text while the editor scrolls underneath it.
    const updateFloatingPos = () => {
      const v = viewRef.current;
      if (!v) return;
      const sel = v.state.selection.main;
      if (!sel.empty && sel.to > sel.from && effectiveModeRef.current !== 'source') {
        const coords = v.coordsAtPos(sel.from);
        if (coords) {
          const top = Math.max(10, coords.top - 46);
          const left = Math.max(10, coords.left);
          setFloatingPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
        }
      }
    };

    // Keep emptyLinePlus correctly positioned during scroll or resize,
    // and keep the floating toolbar glued to the selection while scrolling.
    const handleScroll = () => {
      requestAnimationFrame(() => {
        updateEmptyPlusState();
        updateFloatingPos();
      });
    };

    const handleResize = () => {
      requestAnimationFrame(updateEmptyPlusState);
    };

    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    // Initial check on mount
    requestAnimationFrame(updateEmptyPlusState);

    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      view.destroy();
      viewRef.current = null;
    };
  }, [activeDocId]);

  // Live-apply mode / typewriter / focus changes without destroying the view.
  // Dispatching compartment reconfigurations preserves the document, undo
  // history, selection, scroll position, and folds.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    reconfigureEditorMode(view, {
      mode: effectiveMode,
      typewriterMode,
      focusMode,
    });
  }, [effectiveMode, typewriterMode, focusMode]);

  // Compute Notion-style breadcrumb hierarchy
  const currentDoc = documents.find((d) => d.id === activeDocId);

  // Sync external document content updates (e.g. from renameDocument setting the heading) into CodeMirror
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !currentDoc) return;
    const currentEditorText = view.state.doc.toString();
    if (currentEditorText !== currentDoc.currentText) {
      const mainSel = view.state.selection.main;
      view.dispatch({
        changes: {
          from: 0,
          to: currentEditorText.length,
          insert: currentDoc.currentText,
        },
        selection: {
          anchor: Math.min(mainSel.anchor, currentDoc.currentText.length),
          head: Math.min(mainSel.head, currentDoc.currentText.length),
        },
      });
    }
  }, [currentDoc?.currentText]);

  // Handle click-to-scroll navigation from Document Outline
  useEffect(() => {
    const handleScrollToHeading = (e: Event) => {
      const customEvent = e as CustomEvent<{ line: number; pos: number }>;
      const view = viewRef.current;
      if (!view || !customEvent.detail) return;
      const { pos } = customEvent.detail;
      const targetPos = Math.min(pos, view.state.doc.length);

      view.dispatch({
        selection: { anchor: targetPos, head: targetPos },
        scrollIntoView: true,
      });
      view.focus();
    };

    window.addEventListener('as:scroll-to-line', handleScrollToHeading);
    return () => window.removeEventListener('as:scroll-to-line', handleScrollToHeading);
  }, []);

  // Handle edit image event from ImageWidget
  useEffect(() => {
    const handleEditImage = (e: Event) => {
      const customEvent = e as CustomEvent<{
        from: number;
        to: number;
        alt: string;
        url: string;
        title?: string;
      }>;
      if (!customEvent.detail) return;
      setImageTargetRange({ from: customEvent.detail.from, to: customEvent.detail.to });
      setEditingImageData({
        alt: customEvent.detail.alt,
        url: customEvent.detail.url,
        title: customEvent.detail.title,
      });
      setImageModalOpen(true);
    };

    window.addEventListener('as:edit-image', handleEditImage);
    return () => window.removeEventListener('as:edit-image', handleEditImage);
  }, []);

  const handleImageConfirm = (alt: string, url: string, title?: string) => {
    const view = viewRef.current;
    if (!view) return;
    const target = imageTargetRange || {
      from: view.state.selection.main.from,
      to: view.state.selection.main.to,
    };
    const insert = (finalUrl: string) => {
      const imageMd = title ? `![${alt}](${finalUrl} "${title}")\n` : `![${alt}](${finalUrl})\n`;
      // Clamp: the asset write is async, the doc may have moved meanwhile.
      const liveFrom = Math.min(target.from, view.state.doc.length);
      const liveTo = Math.min(target.to, view.state.doc.length);
      view.dispatch({
        changes: { from: liveFrom, to: liveTo, insert: imageMd },
        selection: { anchor: liveFrom + imageMd.length },
      });
      view.focus();
    };
    // Inline data URLs become vault assets when a vault is open (desktop);
    // remote URLs and browser sessions keep the URL as-is.
    const store = useWorkspaceStore.getState();
    const activeDoc = store.documents.find((d) => d.id === store.activeDocumentId);
    if (url.startsWith('data:image/') && activeDoc?.meta.filePath && store.vaultRoot) {
      void dataUrlToAsset(url, activeDoc.meta.fileName, store.vaultRoot)
        .then((rel) => insert(rel ?? url))
        .catch(() => insert(url));
    } else {
      insert(url);
    }
    setImageModalOpen(false);
    setImageTargetRange(null);
    setEditingImageData(null);
  };

  interface BreadcrumbItem {
    id: string;
    title: string;
    type: 'folder' | 'doc';
  }

  const breadcrumbs: BreadcrumbItem[] = [];
  if (currentDoc) {
    let parentId = currentDoc.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parentDoc = documents.find((d) => d.id === parentId);
      if (parentDoc) {
        breadcrumbs.unshift({
          id: parentDoc.id,
          title: formatDisplayName(parentDoc.meta.fileName),
          type: 'doc',
        });
        parentId = parentDoc.parentId ?? null;
        continue;
      }
      const parentFolder = folders.find((f) => f.id === parentId);
      if (parentFolder) {
        breadcrumbs.unshift({
          id: parentFolder.id,
          title: parentFolder.name,
          type: 'folder',
        });
        parentId = parentFolder.parentId;
        continue;
      }
      break;
    }
    breadcrumbs.push({
      id: currentDoc.id,
      title: formatDisplayName(currentDoc.meta.fileName),
      type: 'doc',
    });
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Notion-style Breadcrumb Trail */}
      {breadcrumbs.length > 1 && (
        <nav aria-label="Breadcrumbs" className="as-breadcrumbs">
          {breadcrumbs.map((item, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={`crumb-${item.id}-${idx}`}>
                {idx > 0 && <span className="as-breadcrumb-separator">/</span>}
                <span
                  className={isLast ? '' : 'as-breadcrumb-item'}
                  onClick={() => {
                    if (!isLast && item.type === 'doc') {
                      setActiveDoc(item.id);
                    }
                  }}
                  style={{
                    fontWeight: isLast ? 600 : 400,
                    color: isLast ? 'var(--as-text)' : 'inherit',
                    cursor: isLast || item.type === 'folder' ? 'default' : 'pointer',
                  }}
                >
                  {item.type === 'folder' ? (
                    <Folder size={12} style={{ color: 'var(--as-accent)', marginRight: '3px' }} />
                  ) : (
                    <FileText size={12} style={{ opacity: 0.7, marginRight: '3px' }} />
                  )}
                  {item.title}
                </span>
              </React.Fragment>
            );
          })}
        </nav>
      )}

      {/* External-change reconciliation banner (vault conflicts / deletions) */}
      <SyncBanner docId={activeDocId} />

      {/* Editor Container */}
      <div
        ref={containerRef}
        data-doc-id={activeDocId}
        className="as-editor-container"
        style={{
          flex: 1,
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Floating Selection Toolbar (Bubble Menu) */}
        <FloatingToolbar
          view={viewRef.current}
          position={floatingPos}
          openLinkRequested={linkRequested}
          onLinkHandled={() => setLinkRequested(false)}
        />

        {/* Notion-style Gutter '+' Button */}
        {emptyLinePlus && !slashOpen && (
          <button
            type="button"
            title="Add a block"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!viewRef.current) return;
              viewRef.current.dispatch({
                selection: { anchor: emptyLinePlus.lineFrom, head: emptyLinePlus.lineFrom },
              });
              viewRef.current.focus();
              setSlashPos({
                top: emptyLinePlus.top + (emptyLinePlus.height || 24) + 4,
                left: emptyLinePlus.cursorX,
              });
              setSlashQuery('');
              setSlashRange({ from: emptyLinePlus.lineFrom, to: emptyLinePlus.lineTo });
              setSlashOpen(true);
            }}
            style={{
              position: 'absolute',
              top: `${emptyLinePlus.top + ((emptyLinePlus.height || 24) - 22) / 2}px`,
              left: `${emptyLinePlus.plusLeft}px`,
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--as-text-dim, #999)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              zIndex: 15,
              transition: 'all var(--as-transition-fast, 0.15s ease)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--as-bg-hover, rgba(128,128,128,0.12))';
              e.currentTarget.style.color = 'var(--as-text, #333)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--as-text-dim, #999)';
            }}
          >
            <Plus size={14} />
          </button>
        )}

        {/* Notion-style Slash Command Menu (/) */}
        <SlashCommandMenu
          view={viewRef.current}
          isOpen={slashOpen}
          query={slashQuery}
          position={slashPos}
          slashRange={slashRange}
          onClose={() => setSlashOpen(false)}
          onOpenImageModal={(range) => {
            setSlashOpen(false);
            setImageTargetRange(range);
            setEditingImageData(null);
            setImageModalOpen(true);
          }}
        />

        {/* Image Insert & Edit Modal */}
        <ImageModal
          isOpen={imageModalOpen}
          initialAlt={editingImageData?.alt || ''}
          initialUrl={editingImageData?.url || ''}
          initialTitle={editingImageData?.title || ''}
          onClose={() => {
            setImageModalOpen(false);
            setImageTargetRange(null);
            setEditingImageData(null);
          }}
          onConfirm={handleImageConfirm}
        />
      </div>
    </div>
  );
};
