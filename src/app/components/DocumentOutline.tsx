import React, { useMemo } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { frontmatterEnd } from '../../core/markdown/frontmatter';
import { ListTree, X, FileText, Clock, Hash } from 'lucide-react';

export interface DocumentHeading {
  id: string;
  level: number;
  text: string;
  line: number;
  pos: number;
}

export function extractDocumentHeadings(markdown: string): DocumentHeading[] {
  if (!markdown) return [];
  const headings: DocumentHeading[] = [];
  // Front matter (YAML ---, TOML +++, JSON {...}) occupies the first block
  // only — skip it by offset so body `---` fences are never swallowed.
  const fmEnd = frontmatterEnd(markdown);
  let inCodeBlock = false;
  let lineIndex = 0;
  let charOffset = 0;

  // Iterate lines WITH their exact separators so `pos` stays correct for
  // LF, CRLF, CR, and mixed line endings.
  const lineRe = /([^\r\n]*)(\r\n|[\n\r]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(markdown)) !== null) {
    if (match[0] === '') break;
    const lineText = match[1];
    const sep = match[2];

    // Skip the front-matter block by offset (first block only).
    if (charOffset < fmEnd) {
      charOffset += lineText.length + sep.length;
      lineIndex++;
      continue;
    }

    if (/^ {0,3}(`{3,}|~{3,})/.test(lineText)) {
      inCodeBlock = !inCodeBlock;
    } else if (!inCodeBlock) {
      // ATX headings allow at most 3 leading spaces; 4+ is indented code.
      const headingMatch = lineText.match(/^ {0,3}(#{1,6})\s+([^\r\n]+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const raw = headingMatch[2].trim();
        const clean = raw.replace(/[*_~`]/g, '').trim();
        if (clean) {
          headings.push({
            id: `heading-${lineIndex}-${charOffset}`,
            level,
            text: clean,
            line: lineIndex + 1,
            pos: charOffset,
          });
        }
      }
    }

    charOffset += lineText.length + sep.length;
    lineIndex++;
  }

  return headings;
}

export function findActiveHeading(headings: DocumentHeading[], targetLine: number): DocumentHeading | null {
  if (headings.length === 0) return null;
  let active: DocumentHeading | null = null;
  for (const h of headings) {
    if (h.line <= targetLine) {
      active = h;
    } else {
      break;
    }
  }
  return active || headings[0] || null;
}

export const DocumentOutline: React.FC = () => {
  const activeId = useWorkspaceStore((s) => s.activeDocumentId);
  const documents = useWorkspaceStore((s) => s.documents);
  const wordCount = useWorkspaceStore((s) => s.wordCount);
  const readingTimeMin = useWorkspaceStore((s) => s.readingTimeMin);
  const cursorLine = useWorkspaceStore((s) => s.cursorLine);
  const outlineOpen = useSettingsStore((s) => s.outlineOpen);
  const toggleOutline = useSettingsStore((s) => s.toggleOutline);

  const currentDoc = documents.find((d) => d.id === activeId);
  const headings = useMemo(() => {
    return currentDoc ? extractDocumentHeadings(currentDoc.currentText) : [];
  }, [currentDoc?.currentText]);

  const [activeHeadingId, setActiveHeadingId] = React.useState<string | null>(null);

  const [isCompact, setIsCompact] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth < 960 : false
  );

  React.useEffect(() => {
    const handleResize = () => setIsCompact(window.innerWidth < 960);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Scroll spy & cursor tracking observer. Scoped to the active document's
  // editor pane so split view (two .cm-scroller elements) follows the right one.
  React.useEffect(() => {
    const scroller =
      typeof document !== 'undefined'
        ? (activeId &&
            document.querySelector(
              `.as-editor-container[data-doc-id="${activeId}"] .cm-scroller`
            )) ||
          document.querySelector('.cm-scroller')
        : null;
    if (!scroller) {
      const active = findActiveHeading(headings, cursorLine);
      setActiveHeadingId(active ? active.id : null);
      return;
    }

    const updateActive = () => {
      const editorView = (scroller.closest('.cm-editor') as any)?.__cmView?.view;
      if (editorView) {
        try {
          const topBlock = editorView.lineBlockAtHeight(scroller.scrollTop + 40);
          const currentScrollLine = editorView.state.doc.lineAt(topBlock.from).number;
          const active = findActiveHeading(headings, currentScrollLine);
          setActiveHeadingId(active ? active.id : null);
          return;
        } catch {
          // fallback
        }
      }
      const active = findActiveHeading(headings, cursorLine);
      setActiveHeadingId(active ? active.id : null);
    };

    updateActive();
    scroller.addEventListener('scroll', updateActive, { passive: true });
    return () => scroller.removeEventListener('scroll', updateActive);
  }, [headings, cursorLine, activeId]);

  if (!outlineOpen) return null;

  const handleHeadingClick = (heading: DocumentHeading) => {
    window.dispatchEvent(
      new CustomEvent('as:scroll-to-line', {
        detail: { line: heading.line, pos: heading.pos },
      })
    );
    if (isCompact) {
      toggleOutline();
    }
  };

  return (
    <>
      {/* Backdrop for compact viewports */}
      {isCompact && (
        <div
          className="as-outline-backdrop"
          onClick={toggleOutline}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="Document Outline"
        className="as-outline-drawer"
        style={{
          width: isCompact ? '280px' : '260px',
          maxWidth: '85vw',
          height: '100%',
          backgroundColor: 'var(--as-bg-surface)',
          borderLeft: '1px solid var(--as-border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          userSelect: 'none',
          zIndex: isCompact ? 40 : 10,
          position: isCompact ? 'absolute' : 'relative',
          right: 0,
          top: 0,
          bottom: 0,
          boxShadow: isCompact ? 'var(--as-shadow-lg, 0 8px 30px rgba(0,0,0,0.2))' : 'none',
          animation: 'fadeIn 0.15s ease',
        }}
      >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--as-border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ListTree size={16} style={{ color: 'var(--as-accent)' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--as-text)' }}>
            Outline
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '10px',
              backgroundColor: 'var(--as-bg-subtle)',
              color: 'var(--as-text-muted)',
            }}
          >
            {headings.length}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleOutline}
          title="Close Outline (⌘⇧O)"
          style={{
            background: 'none',
            border: 'none',
            padding: '4px',
            cursor: 'pointer',
            borderRadius: '4px',
            color: 'var(--as-text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
            e.currentTarget.style.color = 'var(--as-text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--as-text-muted)';
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Headings List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {headings.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '180px',
              textAlign: 'center',
              padding: '0 20px',
              color: 'var(--as-text-muted)',
              fontSize: '12px',
              lineHeight: 1.5,
            }}
          >
            <Hash size={24} style={{ opacity: 0.3, marginBottom: '8px' }} />
            <span>No headings detected</span>
            <span style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>
              Add #, ##, or ### to structure your document sections.
            </span>
          </div>
        ) : (
          headings.map((heading) => {
            const isActive = activeHeadingId === heading.id;
            const indent = (heading.level - 1) * 12;
            const fontWeight = isActive ? 600 : heading.level === 1 ? 600 : heading.level === 2 ? 500 : 400;
            const opacity = isActive ? 1 : heading.level === 1 ? 1 : heading.level === 2 ? 0.9 : 0.75;

            return (
              <div
                key={heading.id}
                onClick={() => handleHeadingClick(heading)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 8px',
                  paddingLeft: `${8 + indent}px`,
                  borderRadius: 'var(--as-radius-sm)',
                  fontSize: '12.5px',
                  fontWeight,
                  color: isActive ? 'var(--as-accent)' : 'var(--as-text)',
                  backgroundColor: isActive ? 'var(--as-bg-subtle)' : 'transparent',
                  borderLeft: isActive ? '2.5px solid var(--as-accent)' : '2.5px solid transparent',
                  opacity,
                  cursor: 'pointer',
                  transition: 'all var(--as-transition-fast)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title={`Line ${heading.line}: ${heading.text}`}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: heading.level === 1 ? '6px' : '4px',
                    height: heading.level === 1 ? '6px' : '4px',
                    borderRadius: '50%',
                    backgroundColor: isActive || heading.level === 1 ? 'var(--as-accent)' : 'var(--as-text-muted)',
                    flexShrink: 0,
                    opacity: isActive ? 1 : 0.8,
                  }}
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {heading.text}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Metrics */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--as-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--as-text-muted)',
          backgroundColor: 'var(--as-bg-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <FileText size={12} />
          <span>{wordCount} words</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Clock size={12} />
          <span>{readingTimeMin} min read</span>
        </div>
      </div>
    </aside>
    </>
  );
};
