import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { deleteBlock } from './block-actions';

export type CalloutType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION' | 'QUOTE';

export interface ParsedCallout {
  type: CalloutType;
  title: string;
  body: string;
}

export function parseCallout(source: string): ParsedCallout {
  const lines = source.split('\n');
  const cleanLines = lines.map((l) => l.replace(/^>\s?/, ''));
  const firstLine = cleanLines[0] || '';

  const match = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*(.*))?$/i);
  if (match) {
    const type = match[1].toUpperCase() as CalloutType;
    const title = match[2] || type;
    const body = cleanLines.slice(1).join('\n');
    return { type, title, body };
  }

  return {
    type: 'QUOTE',
    title: '',
    body: cleanLines.join('\n'),
  };
}

export function serializeCallout(type: CalloutType, title: string, body: string): string {
  if (type === 'QUOTE') {
    if (!body) return '> ';
    return body
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
  }
  const header = `> [!${type}]${title && title.toUpperCase() !== type ? ` ${title}` : ''}`;
  const bodyLines = body
    ? body
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    : '> ';
  return `${header}\n${bodyLines}`;
}

const calloutIcons: Record<CalloutType, string> = {
  QUOTE: '❝',
  NOTE: 'ℹ️',
  TIP: '💡',
  IMPORTANT: '📌',
  WARNING: '⚠️',
  CAUTION: '🚨',
};

const calloutLabels: Record<CalloutType, string> = {
  QUOTE: 'Quote',
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

interface CalloutWidgetState {
  widget: CalloutWidget;
  onDocUpdate: (newSource: string) => void;
}

export class CalloutWidget extends MarkdownWidget {
  override nodeName = 'Blockquote';

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const state = (dom as any).__calloutState as CalloutWidgetState | undefined;
    if (state) {
      state.widget = this;
      state.onDocUpdate(this.source);
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    let currentSource = this.source;
    let parsed = parseCallout(currentSource);

    const container = document.createElement('div');
    container.className = `as-callout as-callout-${parsed.type.toLowerCase()}`;
    container.style.position = 'relative';

    // 1. Icon Element (clickable to change type)
    const iconSpan = document.createElement('span');
    iconSpan.className = 'as-callout-icon';
    iconSpan.textContent = calloutIcons[parsed.type] || '❝';
    iconSpan.title = 'Click to change type';
    iconSpan.style.cursor = 'pointer';
    container.appendChild(iconSpan);

    // 2. Content Container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'as-callout-content';

    // Title (only displayed for callouts with headers, hidden for plain quotes)
    const titleEl = document.createElement('div');
    titleEl.className = 'as-callout-title';
    titleEl.textContent = parsed.title;
    titleEl.contentEditable = 'true';
    titleEl.spellcheck = false;
    titleEl.title = 'Click to edit title';
    titleEl.setAttribute('data-placeholder', 'Callout title...');
    if (parsed.type === 'QUOTE') {
      titleEl.style.display = 'none';
    }

    // Body Text
    const bodyEl = document.createElement('div');
    bodyEl.className = 'as-callout-body';
    bodyEl.textContent = parsed.body;
    bodyEl.contentEditable = 'true';
    bodyEl.spellcheck = false;
    bodyEl.title = 'Click to edit text';
    bodyEl.setAttribute(
      'data-placeholder',
      parsed.type === 'QUOTE' ? 'Quote text... (Backspace to remove)' : 'Write callout text...'
    );

    contentDiv.appendChild(titleEl);
    contentDiv.appendChild(bodyEl);
    container.appendChild(contentDiv);

    // 3. Hover Floating Action Bar
    const actionBar = document.createElement('div');
    actionBar.className = 'as-callout-actions';

    // Helper to safely delete the entire blockquote/callout from CodeMirror
    const deleteBlockquote = (e?: Event) => {
      if (e) e.stopPropagation();
      deleteBlock(view, this, container);
    };

    // Helper to unquote/turn into plain text
    const unquoteBlockquote = (e?: Event) => {
      if (e) e.stopPropagation();
      const range = this.resolveRange(view, container);
      const unquoted =
        parsed.title && parsed.type !== 'QUOTE'
          ? `${parsed.title}\n${parsed.body}`
          : (parsed.body || '');
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: unquoted },
        selection: { anchor: range.from, head: range.from + unquoted.length },
      });
      view.focus();
    };

    // Helper to change callout type
    const changeCalloutType = (newType: CalloutType) => {
      parsed.type = newType;
      if (newType === 'QUOTE') {
        titleEl.style.display = 'none';
        parsed.title = '';
      } else {
        titleEl.style.display = 'block';
        if (!parsed.title || parsed.title === 'Quote') {
          parsed.title = newType.charAt(0) + newType.slice(1).toLowerCase();
          titleEl.textContent = parsed.title;
        }
      }
      iconSpan.textContent = calloutIcons[newType] || '❝';
      container.className = `as-callout as-callout-${newType.toLowerCase()}`;
      bodyEl.setAttribute(
        'data-placeholder',
        newType === 'QUOTE' ? 'Quote text... (Backspace to remove)' : 'Write callout text...'
      );
      const serialized = serializeCallout(newType, parsed.title, parsed.body);
      currentSource = serialized;
      this.replace(view, serialized, container);
      closeTypeMenu();
    };

    // Type Switcher Dropdown Menu (opens via icon click)
    const typeMenu = document.createElement('div');
    typeMenu.className = 'as-callout-type-menu';
    typeMenu.style.display = 'none';

    const calloutOptions: CalloutType[] = ['QUOTE', 'NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    calloutOptions.forEach((opt) => {
      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = 'as-callout-menu-item';
      optBtn.innerHTML = `<span>${calloutIcons[opt]}</span> <span>${calloutLabels[opt]}</span>`;
      optBtn.onclick = (e) => {
        e.stopPropagation();
        changeCalloutType(opt);
      };
      typeMenu.appendChild(optBtn);
    });

    const toggleTypeMenu = (e: MouseEvent) => {
      e.stopPropagation();
      const isVisible = typeMenu.style.display === 'flex';
      typeMenu.style.display = isVisible ? 'none' : 'flex';
    };

    const closeTypeMenu = () => {
      typeMenu.style.display = 'none';
    };

    iconSpan.onclick = toggleTypeMenu;

    // Unquote / Turn into Text Button
    const unquoteBtn = document.createElement('button');
    unquoteBtn.type = 'button';
    unquoteBtn.className = 'as-callout-btn';
    unquoteBtn.textContent = 'Turn to Text';
    unquoteBtn.title = 'Convert quote into normal text';
    unquoteBtn.onclick = unquoteBlockquote;

    // Direct Delete button (no dropdown)
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'as-callout-btn as-callout-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.title = 'Delete this quote/callout block';
    deleteBtn.onclick = deleteBlockquote;

    actionBar.appendChild(typeMenu);
    actionBar.appendChild(unquoteBtn);
    actionBar.appendChild(deleteBtn);
    container.appendChild(actionBar);

    // Close type menu when clicking anywhere else
    const handleDocClick = (e: MouseEvent) => {
      if (!typeMenu.contains(e.target as Node) && e.target !== iconSpan) {
        closeTypeMenu();
      }
    };
    document.addEventListener('click', handleDocClick);

    // 4. Save Changes on Blur
    titleEl.onblur = () => {
      const newTitle = titleEl.textContent || '';
      if (newTitle !== parsed.title) {
        parsed.title = newTitle;
        const serialized = serializeCallout(parsed.type, parsed.title, parsed.body);
        currentSource = serialized;
        this.replace(view, serialized, container);
      }
    };

    bodyEl.onblur = () => {
      const newBody = bodyEl.textContent || '';
      if (newBody !== parsed.body) {
        parsed.body = newBody;
        const serialized = serializeCallout(parsed.type, parsed.title, parsed.body);
        currentSource = serialized;
        this.replace(view, serialized, container);
      }
    };

    // 5. Title Keyboard Shortcuts
    titleEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        bodyEl.focus();
      } else if (e.key === 'Backspace' && (titleEl.textContent || '').trim() === '') {
        e.preventDefault();
        changeCalloutType('QUOTE');
        bodyEl.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const range = this.resolveRange(view, container);
        view.dispatch({ selection: { anchor: range.to } });
        view.focus();
      }
    };

    // 6. Body Keyboard Shortcuts (Backspace to delete/unquote, Enter to exit)
    bodyEl.onkeydown = (e) => {
      const text = bodyEl.textContent || '';

      // Backspace handler
      if (e.key === 'Backspace') {
        // A. If body is completely empty (or whitespace only)
        if (text.trim() === '') {
          e.preventDefault();
          deleteBlockquote();
          return;
        }

        // B. If cursor is at the very beginning of the body text (offset 0)
        const sel = window.getSelection();
        if (sel && sel.isCollapsed && sel.anchorOffset === 0 && (sel.anchorNode === bodyEl || sel.anchorNode === bodyEl.firstChild)) {
          e.preventDefault();
          unquoteBlockquote();
          return;
        }
      }

      // Enter handler
      if (e.key === 'Enter' && !e.shiftKey) {
        if (text.trim() === '') {
          // Empty body + Enter -> delete quote and leave clean line in editor
          e.preventDefault();
          deleteBlockquote();
          return;
        }

        // Check if cursor is at the end of the text
        const sel = window.getSelection();
        if (sel && sel.isCollapsed) {
          try {
            const range = sel.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(bodyEl);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            const textBefore = preCaretRange.toString();

            // If user is at end of text and previous char is newline (double Enter)
            if (textBefore.endsWith('\n') || (textBefore.length === text.length && text.endsWith('\n'))) {
              e.preventDefault();
              const docRange = this.resolveRange(view, container);
              const cleanBody = text.replace(/\n+$/, '');
              const serialized = serializeCallout(parsed.type, parsed.title, cleanBody);
              view.dispatch({
                changes: [
                  { from: docRange.from, to: docRange.to, insert: serialized },
                  { from: docRange.to, insert: '\n' },
                ],
                selection: { anchor: docRange.from + serialized.length + 1 },
              });
              view.focus();
              return;
            }
          } catch {}
        }
      }

      // Escape handler -> return focus to CodeMirror
      if (e.key === 'Escape') {
        e.preventDefault();
        const docRange = this.resolveRange(view, container);
        view.dispatch({ selection: { anchor: docRange.to } });
        view.focus();
      }
    };

    // 7. Synchronize external document updates
    const stateObj: CalloutWidgetState = {
      widget: this,
      onDocUpdate: (newSource: string) => {
        if (newSource !== currentSource) {
          currentSource = newSource;
          parsed = parseCallout(newSource);
          iconSpan.textContent = calloutIcons[parsed.type] || '❝';
          container.className = `as-callout as-callout-${parsed.type.toLowerCase()}`;
          titleEl.style.display = parsed.type === 'QUOTE' ? 'none' : 'block';
          if (document.activeElement !== titleEl) {
            titleEl.textContent = parsed.title;
          }
          if (document.activeElement !== bodyEl) {
            bodyEl.textContent = parsed.body;
          }
        }
      },
    };
    (container as any).__calloutState = stateObj;

    return container;
  }
}
