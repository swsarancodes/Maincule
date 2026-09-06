import { EditorState, Extension, Prec, RangeSetBuilder, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxTree, codeFolding, foldGutter, foldKeymap } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { createMarkdownExtension } from '../core/markdown/grammar';
import { getModeExtensions, ViewMode } from './modes/view-mode';
import { markdownFormattingKeymap } from './commands/formatting';
import { delimiterGuard } from './decorations/delimiter-guard';
import { lineSelectionExtension } from './decorations/line-selection';
import { wikilinkAutocompleteExtension } from './completions/wikilink-completion';
import { AsterismSearchPanel } from './search-panel';

export interface EditorSetupOptions {
  initialDoc?: string;
  mode?: ViewMode;
  typewriterMode?: boolean;
  focusMode?: 'off' | 'sentence' | 'paragraph';
  onDocChange?: (newDoc: string) => void;
  onCursorChange?: (line: number, col: number, selectionCount: number) => void;
}

export function openLinkUrl(url: string) {
  const raw = url.trim();
  if (!raw) return;

  // Normalize URL with https:// if no scheme is specified
  const targetUrl = /^https?:\/\/|^mailto:|^tel:|^file:/i.test(raw)
    ? raw
    : `https://${raw}`;

  // 1. If in Tauri desktop app, use Tauri opener plugin
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    import('@tauri-apps/plugin-opener')
      .then((m) => m.openUrl(targetUrl))
      .catch((err) => {
        console.warn('Tauri openUrl failed, falling back to browser navigation:', err);
        fallbackOpen(targetUrl);
      });
    return;
  }

  // 2. If in web browser, synchronously trigger anchor click
  fallbackOpen(targetUrl);
}

function fallbackOpen(targetUrl: string) {
  try {
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Finds the link URL at a given document position or target element.
 */
export function findLinkUrlAt(view: EditorView, pos: number, _targetEl?: HTMLElement | null): string | null {
  const doc = view.state.doc;
  const safePos = Math.max(0, Math.min(pos, doc.length));
  const line = doc.lineAt(safePos);
  const lineText = line.text;
  const col = safePos - line.from;

  // 1. Check syntax tree for Link node
  const tree = syntaxTree(view.state);
  for (const side of [1, -1, 0]) {
    let node: any = tree.resolveInner(safePos, side as any);
    while (node && node.name !== 'Link' && node.parent) {
      node = node.parent;
    }
    if (node && node.name === 'Link') {
      const nodeText = doc.sliceString(node.from, node.to);
      const m = nodeText.match(/\]\(([^)]+)\)/);
      if (m && m[1]) return m[1].trim();
    }
  }

  // 2. Check line regex for [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (col >= start - 1 && col <= end + 1) {
      return match[2].trim();
    }
  }

  return null;
}

/**
 * Image Paste & Drop Handler:
 * When user pastes an image from clipboard (Cmd+V, screenshot, copied image file)
 * or drops an image file onto the editor, converts to base64 Data URL and inserts ![Image](dataUrl).
 */
export function imagePasteDropExtension(): Extension {
  const insertImageAt = (view: EditorView, pos: number, alt: string, url: string) => {
    const doc = view.state.doc;
    const line = doc.lineAt(pos);
    const needLeadingNewline = pos > line.from && !doc.sliceString(pos - 1, pos).endsWith('\n');
    const imageMarkdown = `${needLeadingNewline ? '\n' : ''}![${alt}](${url})\n`;
    view.dispatch({
      changes: { from: pos, insert: imageMarkdown },
      selection: { anchor: pos + imageMarkdown.length },
    });
  };

  const handleImageFile = (file: File, view: EditorView, pos: number) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const cleanName = file.name ? file.name.replace(/\.[^/.]+$/, '') : 'Image';
      insertImageAt(view, pos, cleanName, dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return EditorView.domEventHandlers({
    paste(e, view) {
      // 1. Check for image items in clipboard (e.g. screenshot, copied image in browser)
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              e.stopPropagation();
              const pos = view.state.selection.main.from;
              handleImageFile(file, view, pos);
              return true;
            }
          }
        }
      }

      // 2. Check for image files in clipboard
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            e.stopPropagation();
            const pos = view.state.selection.main.from;
            handleImageFile(file, view, pos);
            return true;
          }
        }
      }

      // 3. Check if clipboard text is an image URL (e.g. https://.../picture.png or data:image/...)
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (text) {
        const isImageUrl =
          /^https?:\/\/[^\s]+?\.(png|jpg|jpeg|gif|webp|svg)(\?[^\s]*)?$/i.test(text) ||
          /^data:image\/[a-zA-Z+]+;base64,/i.test(text);
        const sel = view.state.selection.main;
        if (isImageUrl && sel.empty) {
          const line = view.state.doc.lineAt(sel.from);
          if (line.text.trim() === '') {
            e.preventDefault();
            e.stopPropagation();
            insertImageAt(view, sel.from, 'Image', text);
            return true;
          }
        }
      }

      return false;
    },

    drop(e, view) {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            e.stopPropagation();
            const dropPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            const pos = dropPos !== null ? dropPos : view.state.selection.main.from;
            handleImageFile(file, view, pos);
            return true;
          }
        }
      }
      return false;
    },
  });
}

/**
 * Smart Auto-Linking:
 * When user selects text and pastes a URL, automatically wraps the text into [selected text](url).
 */
export function smartPasteLinkExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return false;
      const isUrl = /^https?:\/\/[^\s]+$/i.test(text) || /^mailto:[^\s]+$/i.test(text);
      const sel = view.state.selection.main;
      if (isUrl && !sel.empty) {
        e.preventDefault();
        const selectedText = view.state.doc.sliceString(sel.from, sel.to);
        const linkMarkdown = `[${selectedText}](${text})`;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: linkMarkdown },
          selection: { anchor: sel.from + linkMarkdown.length },
        });
        return true;
      }
      return false;
    },
  });
}

/**
 * Clickable Links:
 * Clicking on a link in the editor redirects / opens the URL in the browser.
 */
export function clickLinkExtension(): Extension {
  return EditorView.domEventHandlers({
    click(e, view) {
      // If user was making a text drag selection, do not open link
      const sel = view.state.selection.main;
      if (!sel.empty && Math.abs(sel.to - sel.from) > 1) {
        return false;
      }

      const targetEl = e.target as HTMLElement | null;
      const isLinkElement = targetEl?.classList.contains('as-link') || targetEl?.closest('.as-link');

      // Resolve document position
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });

      if (isLinkElement || pos !== null) {
        const checkPos = pos !== null ? pos : (targetEl ? view.posAtDOM(targetEl) : null);
        if (checkPos !== null && checkPos >= 0) {
          const linkUrl = findLinkUrlAt(view, checkPos, targetEl);
          if (linkUrl) {
            e.preventDefault();
            e.stopPropagation();
            openLinkUrl(linkUrl);
            return true;
          }
        }
      }

      return false;
    },
  });
}

/**
 * Typewriter Mode Extension:
 * Keeps the caret vertically centered at ~42% of the editor viewport during typing.
 */
export function typewriterExtension(enabled: boolean = false): Extension {
  if (!enabled) return [];
  return EditorView.updateListener.of((update) => {
    if (
      (update.docChanged || update.selectionSet) &&
      update.view.hasFocus &&
      update.state.selection.main.empty
    ) {
      requestAnimationFrame(() => {
        const view = update.view;
        if (!view || !view.dom.isConnected) return;
        const head = view.state.selection.main.head;
        const coords = view.coordsAtPos(head);
        if (!coords) return;
        const scrollDOM = view.scrollDOM;
        const rect = scrollDOM.getBoundingClientRect();
        const targetY = rect.top + rect.height * 0.42;
        const diff = coords.top - targetY;
        if (Math.abs(diff) > 8) {
          scrollDOM.scrollTop += diff;
        }
      });
    }
  });
}

/**
 * Focus Mode Extension:
 * Dims inactive lines/paragraphs with smooth transition so the author can focus.
 */
export function focusModeExtension(mode: 'off' | 'sentence' | 'paragraph' = 'off'): Extension {
  if (mode === 'off') return [];
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.compute(view);
      }
      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
          this.decorations = this.compute(update.view);
        }
      }
      compute(view: EditorView): DecorationSet {
        const head = view.state.selection.main.head;
        const activeLine = view.state.doc.lineAt(head);
        const builder = new RangeSetBuilder<Decoration>();
        const dimmedDeco = Decoration.line({ class: 'as-dimmed-line' });

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            let isFocused = false;
            if (mode === 'paragraph') {
              if (line.number === activeLine.number) {
                isFocused = true;
              } else if (line.text.trim() !== '' && activeLine.text.trim() !== '') {
                const minL = Math.min(line.number, activeLine.number);
                const maxL = Math.max(line.number, activeLine.number);
                let contiguous = true;
                for (let l = minL; l <= maxL; l++) {
                  if (view.state.doc.line(l).text.trim() === '') {
                    contiguous = false;
                    break;
                  }
                }
                isFocused = contiguous;
              }
            } else {
              isFocused = line.number === activeLine.number;
            }

            if (!isFocused && line.text.trim().length > 0) {
              builder.add(line.from, line.from, dimmedDeco);
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * Reconfigurable compartments.
 *
 * Mode / typewriter / focus changes must NOT destroy the EditorView (that wipes
 * undo history, selection, scroll, and folds). These compartments let callers
 * swap those extensions live via `reconfigureEditorMode(view, ...)`.
 *
 * Compartment instances are shared across views on purpose: reconfiguration is
 * dispatched per-view, so split-view panes stay independent.
 */
export const modeCompartment = new Compartment();
export const typewriterCompartment = new Compartment();
export const focusCompartment = new Compartment();

export interface ModeConfig {
  mode?: ViewMode;
  typewriterMode?: boolean;
  focusMode?: 'off' | 'sentence' | 'paragraph';
}

function modeExtensionsFor(mode: ViewMode): Extension[] {
  return [...(mode === 'source' ? [foldGutter()] : []), ...getModeExtensions(mode)];
}

/**
 * Live-swap mode/typewriter/focus extensions on an existing view.
 * Preserves document, undo history, selection, scroll position, and folds.
 */
export function reconfigureEditorMode(view: EditorView, config: ModeConfig): void {
  view.dispatch({
    effects: [
      modeCompartment.reconfigure(modeExtensionsFor(config.mode || 'hybrid')),
      typewriterCompartment.reconfigure(typewriterExtension(config.typewriterMode)),
      focusCompartment.reconfigure(focusModeExtension(config.focusMode)),
    ],
  });
}

export function createEditorExtensions(options: EditorSetupOptions = {}): Extension[] {
  const mode = options.mode || 'hybrid';

  const updateListener = EditorView.updateListener.of((update) => {    if (update.docChanged && options.onDocChange) {
      options.onDocChange(update.state.doc.toString());
    }

    if (options.onCursorChange && (update.selectionSet || update.docChanged)) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      const col = head - line.from + 1;
      const selCount = update.state.selection.ranges.length;
      options.onCursorChange(line.number, col, selCount);
    }
  });

  return [
    codeFolding(),
    history(),
    drawSelection(),
    lineSelectionExtension(),
    dropCursor(),
    createMarkdownExtension(),
    modeCompartment.of(modeExtensionsFor(mode)),
    delimiterGuard(),
    imagePasteDropExtension(),
    smartPasteLinkExtension(),
    clickLinkExtension(),
    wikilinkAutocompleteExtension,
    search({
      top: true,
      createPanel: (view) => new AsterismSearchPanel(view),
    }),
    highlightSelectionMatches(),
    closeBrackets(),
    typewriterCompartment.of(typewriterExtension(options.typewriterMode)),
    focusCompartment.of(focusModeExtension(options.focusMode)),
    updateListener,
    Prec.highest(keymap.of(markdownFormattingKeymap)),
    keymap.of([
      {
        key: 'Mod-Alt-f',
        run: (view) => {
          openSearchPanel(view);
          window.dispatchEvent(new CustomEvent('as:open-replace'));
          return true;
        },
        scope: 'editor',
      },
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
    EditorView.lineWrapping,
  ];
}

export function createEditorState(options: EditorSetupOptions = {}): EditorState {
  return EditorState.create({
    doc: options.initialDoc || '',
    extensions: createEditorExtensions(options),
  });
}
