import React, { useState, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Table,
  Workflow,
  Code,
  AlertCircle,
  Sparkles,
  AlertTriangle,
  Minus,
  Type,
  Link as LinkIcon,
  FilePlus,
  Bold,
  Italic,
  Strikethrough,
  Image as ImageIcon,
  Quote,
  Sigma,
  Highlighter,
} from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace';
import { formatDisplayName } from '../../core/document/file-meta';
import {
  setHeadingLevel,
  setBulletList,
  setNumberedList,
  setTaskList,
  setBlockquote,
  insertMathTemplate,
  insertTableTemplate,
  insertMermaidTemplate,
  insertSequenceTemplate,
  insertMindmapTemplate,
  insertERTemplate,
  insertCodeBlockTemplate,
  insertCalloutTemplate,
  insertDividerTemplate,
  insertLinkTemplate,
} from '../../editor/commands/formatting';

export interface SlashMenuProps {
  view: EditorView | null;
  isOpen: boolean;
  query: string;
  position: { top: number; left: number } | null;
  slashRange: { from: number; to: number } | null;
  onClose: () => void;
  onOpenImageModal?: (range: { from: number; to: number }) => void;
}

interface SlashItem {
  id: string;
  title: string;
  description: string;
  category: 'Basic' | 'Media & Widgets' | 'Callouts';
  icon: any;
  action: (view: EditorView, range: { from: number; to: number }) => void;
}

export const SlashCommandMenu: React.FC<SlashMenuProps> = ({
  view,
  isOpen,
  query,
  position,
  slashRange,
  onClose,
  onOpenImageModal,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items: SlashItem[] = [
    {
      id: 'text',
      title: 'Text',
      description: 'Plain body text without formatting',
      category: 'Basic',
      icon: Type,
      action: (v, r) => setHeadingLevel(v, 0, r),
    },
    {
      id: 'h1',
      title: 'Heading 1',
      description: 'Large section heading',
      category: 'Basic',
      icon: Heading1,
      action: (v, r) => setHeadingLevel(v, 1, r),
    },
    {
      id: 'h2',
      title: 'Heading 2',
      description: 'Medium section heading',
      category: 'Basic',
      icon: Heading2,
      action: (v, r) => setHeadingLevel(v, 2, r),
    },
    {
      id: 'h3',
      title: 'Heading 3',
      description: 'Small subsection heading',
      category: 'Basic',
      icon: Heading3,
      action: (v, r) => setHeadingLevel(v, 3, r),
    },
    {
      id: 'bullet-list',
      title: 'Bulleted List',
      description: 'Create a simple bulleted list',
      category: 'Basic',
      icon: List,
      action: (v, r) => setBulletList(v, r),
    },
    {
      id: 'numbered-list',
      title: 'Numbered List',
      description: 'Create a list with numbering',
      category: 'Basic',
      icon: ListOrdered,
      action: (v, r) => setNumberedList(v, r),
    },
    {
      id: 'todo-list',
      title: 'To-do List',
      description: 'Track tasks with interactive checkboxes',
      category: 'Basic',
      icon: CheckSquare,
      action: (v, r) => setTaskList(v, r),
    },
    {
      id: 'quote',
      title: 'Quote',
      description: 'Capture a quote or citation (> quote)',
      category: 'Basic',
      icon: Quote,
      action: (v, r) => setBlockquote(v, r),
    },
    {
      id: 'link',
      title: 'Link',
      description: 'Attach a web link or hyperlink',
      category: 'Basic',
      icon: LinkIcon,
      action: (v, r) => {
        insertLinkTemplate(v, r);
      },
    },
    {
      id: 'subpage',
      title: 'Subpage',
      description: 'Create a new subpage nested inside this note',
      category: 'Basic',
      icon: FilePlus,
      action: (v, r) => {
        const store = useWorkspaceStore.getState();
        const activeId = store.activeDocumentId;
        store.createEmptyDocument(undefined, activeId);
        const newDocId = useWorkspaceStore.getState().activeDocumentId;
        const newDoc = useWorkspaceStore.getState().documents.find((d) => d.id === newDocId);
        const title = newDoc ? formatDisplayName(newDoc.meta.fileName) : 'Subpage';
        // Wikilink format: the wikilink pill resolves it to the subpage by
        // title on click (a raw (#id) anchor matches nothing and would open
        // an external URL via the link handler).
        v.dispatch({
          changes: {
            from: r.from,
            to: r.to,
            insert: `[[${title}]]\n`,
          },
        });
      },
    },
    {
      id: 'divider',
      title: 'Divider',
      description: 'Visually divide blocks with a horizontal line',
      category: 'Basic',
      icon: Minus,
      action: (v, r) => insertDividerTemplate(v, r),
    },
    {
      id: 'bold',
      title: 'Bold',
      description: 'Make text bold (**bold text**)',
      category: 'Basic',
      icon: Bold,
      action: (v, r) => {
        const text = '**bold text**';
        v.dispatch({
          changes: { from: r.from, to: r.to, insert: text },
          selection: { anchor: r.from + 2, head: r.from + 11 },
        });
      },
    },
    {
      id: 'italic',
      title: 'Italic',
      description: 'Make text italic (*italic text*)',
      category: 'Basic',
      icon: Italic,
      action: (v, r) => {
        const text = '*italic text*';
        v.dispatch({
          changes: { from: r.from, to: r.to, insert: text },
          selection: { anchor: r.from + 1, head: r.from + 12 },
        });
      },
    },
    {
      id: 'strikethrough',
      title: 'Strikethrough',
      description: 'Cross out text (~~strikethrough text~~)',
      category: 'Basic',
      icon: Strikethrough,
      action: (v, r) => {
        const text = '~~strikethrough text~~';
        v.dispatch({
          changes: { from: r.from, to: r.to, insert: text },
          selection: { anchor: r.from + 2, head: r.from + 20 },
        });
      },
    },
    {
      id: 'highlight',
      title: 'Highlight',
      description: 'Highlight text (==highlighted text==)',
      category: 'Basic',
      icon: Highlighter,
      action: (v, r) => {
        const text = '==highlighted text==';
        v.dispatch({
          changes: { from: r.from, to: r.to, insert: text },
          selection: { anchor: r.from + 2, head: r.from + 18 },
        });
      },
    },
    {
      id: 'image',
      title: 'Image',
      description: 'Upload or embed an image from file or URL',
      category: 'Media & Widgets',
      icon: ImageIcon,
      action: (v, r) => {
        if (onOpenImageModal) {
          onOpenImageModal(r);
        } else {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e: any) => {
            const file = e.target?.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                const cleanName = file.name ? file.name.replace(/\.[^/.]+$/, '') : 'Image';
                const imageMd = `![${cleanName}](${dataUrl})\n`;
                v.dispatch({
                  changes: { from: r.from, to: r.to, insert: imageMd },
                  selection: { anchor: r.from + imageMd.length },
                });
              };
              reader.readAsDataURL(file);
            }
          };
          input.click();
        }
      },
    },
    {
      id: 'math-inline',
      title: 'Inline Formula',
      description: 'Inline LaTeX mathematical expression ($E = mc^2$)',
      category: 'Media & Widgets',
      icon: Sigma,
      action: (v, r) => insertMathTemplate(v, false, r),
    },
    {
      id: 'math-block',
      title: 'Math Equation',
      description: 'Display block LaTeX mathematical equation ($$...$$)',
      category: 'Media & Widgets',
      icon: Sigma,
      action: (v, r) => insertMathTemplate(v, true, r),
    },
    {
      id: 'table',
      title: 'Table',
      description: 'Interactive Notion-style table widget',
      category: 'Media & Widgets',
      icon: Table,
      action: (v, r) => insertTableTemplate(v, r),
    },
    {
      id: 'mermaid',
      title: 'Flowchart Diagram',
      description: 'Interactive flowchart with decision nodes',
      category: 'Media & Widgets',
      icon: Workflow,
      action: (v, r) => insertMermaidTemplate(v, r),
    },
    {
      id: 'sequence',
      title: 'Sequence Diagram',
      description: 'Actor to participant message sequence diagram',
      category: 'Media & Widgets',
      icon: Workflow,
      action: (v, r) => insertSequenceTemplate(v, r),
    },
    {
      id: 'mindmap',
      title: 'Mindmap',
      description: 'Hierarchical node mindmap visualization',
      category: 'Media & Widgets',
      icon: Workflow,
      action: (v, r) => insertMindmapTemplate(v, r),
    },
    {
      id: 'er',
      title: 'ER Diagram',
      description: 'Database entity relationship diagram',
      category: 'Media & Widgets',
      icon: Table,
      action: (v, r) => insertERTemplate(v, r),
    },
    {
      id: 'code',
      title: 'Code Block',
      description: 'Capture code snippet with language tag',
      category: 'Media & Widgets',
      icon: Code,
      action: (v, r) => insertCodeBlockTemplate(v, 'typescript', r),
    },
    {
      id: 'callout-note',
      title: 'Note Callout',
      description: 'Highlighted informational card',
      category: 'Callouts',
      icon: AlertCircle,
      action: (v, r) => insertCalloutTemplate(v, 'NOTE', r),
    },
    {
      id: 'callout-tip',
      title: 'Tip Callout',
      description: 'Helpful advice or tip card',
      category: 'Callouts',
      icon: Sparkles,
      action: (v, r) => insertCalloutTemplate(v, 'TIP', r),
    },
    {
      id: 'callout-warning',
      title: 'Warning Callout',
      description: 'Important warning or caution alert',
      category: 'Callouts',
      icon: AlertTriangle,
      action: (v, r) => insertCalloutTemplate(v, 'WARNING', r),
    },
  ];

  const filtered = items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.id.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard arrow navigation & selection inside editor
  useEffect(() => {
    if (!isOpen || !view) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
      } else if (e.key === 'Enter') {
        if (filtered.length > 0 && slashRange) {
          e.preventDefault();
          filtered[selectedIndex].action(view, slashRange);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, filtered, selectedIndex, slashRange, view, onClose]);

  if (!isOpen || !position || !view || !slashRange) return null;

  const menuLeft = typeof window !== 'undefined'
    ? Math.max(10, Math.min(position.left, window.innerWidth - 305))
    : position.left;
  const menuTop = typeof window !== 'undefined'
    ? Math.max(10, Math.min(position.top + 4, window.innerHeight - 350))
    : position.top + 4;

  return (
    <div
      ref={listRef}
      style={{
        position: 'fixed',
        top: `${menuTop}px`,
        left: `${menuLeft}px`,
        zIndex: 9500,
        width: '290px',
        maxWidth: 'calc(100vw - 20px)',
        maxHeight: '340px',
        backgroundColor: 'var(--as-bg-surface)',
        border: '1px solid var(--as-border)',
        borderRadius: 'var(--as-radius-md)',
        boxShadow: 'var(--as-shadow-lg)',
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        animation: 'popIn 0.15s cubic-bezier(0.16, 1, 0.3, 1) both',
        userSelect: 'none',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 650,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--as-text-dim)',
          padding: '4px 8px 6px 8px',
        }}
      >
        Blocks & Widgets
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: '12.5px', color: 'var(--as-text-dim)' }}>
          No matching blocks
        </div>
      ) : (
        filtered.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              onClick={() => {
                item.action(view, slashRange);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '7px 8px',
                borderRadius: 'var(--as-radius-sm)',
                backgroundColor: isSelected ? 'var(--as-bg-subtle)' : 'transparent',
                cursor: 'pointer',
                transition: 'background var(--as-transition-fast)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: 'var(--as-radius-sm)',
                  backgroundColor: isSelected ? 'var(--as-bg-surface)' : 'var(--as-bg-subtle)',
                  border: '1px solid var(--as-border)',
                  color: isSelected ? 'var(--as-accent)' : 'var(--as-text)',
                  flexShrink: 0,
                }}
              >
                <Icon size={15} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '13px', fontWeight: 550, color: 'var(--as-text)' }}>
                  {item.title}
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    color: 'var(--as-text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.description}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
