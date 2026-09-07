import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';

/**
 * Shared block actions: Delete / Move up / Move down + dropdown menu.
 *
 * All block widgets (Callout, Mermaid diagram, Code block, Table, Image, HR)
 * use these helpers so behaviour and styling stay identical (Fumadocs-style
 * badge click -> `Move up / Move down / Delete` menu).
 */

export interface BlockMoveResult {
  newDoc: string;
  /** New anchor for the moved block's start. */
  anchor: number;
}

function frontmatterEnd(docText: string): number {
  const m = docText.match(/^---\n[\s\S]*?\n---(\n)?/);
  return m ? m[0].length : 0;
}

/** Pure, testable delete: removes [from,to] plus one adjacent newline. */
export function computeDelete(docText: string, from: number, to: number): { newDoc: string; anchor: number } {
  let f = Math.max(0, Math.min(from, docText.length));
  let t = Math.max(f, Math.min(to, docText.length));
  if (t < docText.length && docText[t] === '\n') {
    t++;
  } else if (f > 0 && docText[f - 1] === '\n') {
    f--;
  }
  return { newDoc: docText.slice(0, f) + docText.slice(t), anchor: f };
}

/**
 * Pure, testable move-up: swaps the block [from,to] with the previous
 * blank-line-separated paragraph. Returns null when already at top
 * (or directly after frontmatter).
 */
export function computeMoveUp(docText: string, from: number, to: number): BlockMoveResult | null {
  const len = docText.length;
  const f = Math.max(0, Math.min(from, len));
  const t = Math.max(f, Math.min(to, len));
  const fmEnd = frontmatterEnd(docText);
  if (f <= fmEnd) return null;

  let pEnd = f - 1;
  while (pEnd >= 0 && docText[pEnd] === '\n') pEnd--;
  if (pEnd < fmEnd) return null;

  const sep = docText.lastIndexOf('\n\n', pEnd);
  const pStart = sep === -1 ? 0 : sep + 2;
  if (pStart < fmEnd) return null;
  // Don't treat a position inside the same block as "previous".
  if (pStart >= f) return null;

  const before = docText.slice(0, pStart);
  const prevText = docText.slice(pStart, pEnd + 1);
  const middle = docText.slice(pEnd + 1, f);
  const curText = docText.slice(f, t);
  const after = docText.slice(t);
  return { newDoc: before + curText + middle + prevText + after, anchor: pStart };
}

/**
 * Pure, testable move-down: swaps the block [from,to] with the next
 * blank-line-separated paragraph. Returns null when already at bottom.
 */
export function computeMoveDown(docText: string, from: number, to: number): BlockMoveResult | null {
  const len = docText.length;
  const f = Math.max(0, Math.min(from, len));
  const t = Math.max(f, Math.min(to, len));

  let nStart = t;
  while (nStart < len && docText[nStart] === '\n') nStart++;
  if (nStart >= len) return null;

  const sep = docText.indexOf('\n\n', nStart);
  const nEnd = sep === -1 ? len : sep;
  if (nStart >= nEnd) return null;

  const before = docText.slice(0, f);
  const curText = docText.slice(f, t);
  const middle = docText.slice(t, nStart);
  const nextText = docText.slice(nStart, nEnd);
  const after = docText.slice(nEnd);
  const anchor = before.length + nextText.length + middle.length;
  return { newDoc: before + nextText + middle + curText + after, anchor };
}

/** View wrapper: delete the widget's current range. */
export function deleteBlock(view: EditorView, widget: MarkdownWidget, dom?: HTMLElement | null): void {
  const range = widget.resolveRange(view, dom);
  const doc = view.state.doc;
  let from = range.from;
  let to = range.to;
  if (to < doc.length && doc.sliceString(to, to + 1) === '\n') {
    to++;
  } else if (from > 0 && doc.sliceString(from - 1, from) === '\n') {
    from--;
  }
  view.dispatch({
    changes: { from, to, insert: '' },
    selection: { anchor: from },
  });
  view.focus();
}

/** View wrapper: move widget up one block. Returns false when not movable. */
export function moveBlockUp(view: EditorView, widget: MarkdownWidget, dom?: HTMLElement | null): boolean {
  const range = widget.resolveRange(view, dom);
  const docText = view.state.doc.toString();
  const res = computeMoveUp(docText, range.from, range.to);
  if (!res) return false;
  view.dispatch({
    changes: { from: 0, to: docText.length, insert: res.newDoc },
    selection: { anchor: res.anchor },
  });
  view.focus();
  return true;
}

/** View wrapper: move widget down one block. Returns false when not movable. */
export function moveBlockDown(view: EditorView, widget: MarkdownWidget, dom?: HTMLElement | null): boolean {
  const range = widget.resolveRange(view, dom);
  const docText = view.state.doc.toString();
  const res = computeMoveDown(docText, range.from, range.to);
  if (!res) return false;
  view.dispatch({
    changes: { from: 0, to: docText.length, insert: res.newDoc },
    selection: { anchor: res.anchor },
  });
  view.focus();
  return true;
}

export interface BlockMenuOptions {
  view: EditorView;
  getWidget: () => MarkdownWidget;
  dom: HTMLElement;
  /** Static badge label, e.g. "Callout". Or a getter for dynamic labels. */
  label: string | (() => string);
  /** Optional extra menu item builders run before the standard items. */
  buildExtras?: (menu: HTMLElement, close: () => void) => void;
}

/**
 * Builds a Fumadocs-style badge button + dropdown menu containing
 * `Move up / Move down / Delete`. The badge shows `label ▾`.
 * Returns the badge button, menu element and a refresh function that
 * updates disabled states (call it when opening the menu).
 */
export function createBlockMenu(opts: BlockMenuOptions): {
  badgeBtn: HTMLButtonElement;
  menu: HTMLElement;
  close: () => void;
  refresh: () => void;
} {
  const { view, getWidget, dom, label } = opts;

  const badgeBtn = document.createElement('button');
  badgeBtn.type = 'button';
  badgeBtn.className = 'as-block-badge-btn';
  badgeBtn.title = 'Block actions: move or delete';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'as-block-badge-label';
  labelSpan.textContent = typeof label === 'function' ? label() : label;
  const caret = document.createElement('span');
  caret.className = 'as-block-badge-caret';
  caret.textContent = ' ▾';
  badgeBtn.appendChild(labelSpan);
  badgeBtn.appendChild(caret);

  const menu = document.createElement('div');
  menu.className = 'as-block-menu';
  menu.style.display = 'none';

  const makeItem = (text: string, title: string, danger: boolean, onClick: (e: MouseEvent) => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'as-block-menu-item' + (danger ? ' as-block-menu-item-danger' : '');
    btn.title = title;
    const arrow = document.createElement('span');
    arrow.className = 'as-block-menu-icon';
    arrow.textContent = text.startsWith('Move up') ? '↑' : text.startsWith('Move down') ? '↓' : '🗑';
    const txt = document.createElement('span');
    txt.textContent = text;
    btn.appendChild(arrow);
    btn.appendChild(txt);
    btn.onclick = (e) => {
      e.stopPropagation();
      onClick(e);
    };
    return btn;
  };

  const close = () => {
    menu.style.display = 'none';
  };

  const moveUpBtn = makeItem('Move up', 'Move this block up', false, () => {
    moveBlockUp(view, getWidget(), dom);
    close();
  });
  const moveDownBtn = makeItem('Move down', 'Move this block down', false, () => {
    moveBlockDown(view, getWidget(), dom);
    close();
  });
  const deleteBtn = makeItem('Delete', 'Delete this block', true, () => {
    deleteBlock(view, getWidget(), dom);
    close();
  });

  if (opts.buildExtras) opts.buildExtras(menu, close);
  menu.appendChild(moveUpBtn);
  menu.appendChild(moveDownBtn);
  menu.appendChild(deleteBtn);

  const refresh = () => {
    if (typeof label === 'function') labelSpan.textContent = label();
    try {
      const range = getWidget().resolveRange(view, dom);
      const docText = view.state.doc.toString();
      moveUpBtn.toggleAttribute('disabled', computeMoveUp(docText, range.from, range.to) === null);
      moveDownBtn.toggleAttribute('disabled', computeMoveDown(docText, range.from, range.to) === null);
    } catch {
      moveUpBtn.removeAttribute('disabled');
      moveDownBtn.removeAttribute('disabled');
    }
  };

  badgeBtn.onclick = (e) => {
    e.stopPropagation();
    const isVisible = menu.style.display !== 'none';
    if (isVisible) {
      close();
    } else {
      refresh();
      menu.style.display = 'flex';
    }
  };

  const handleDocClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== badgeBtn && !badgeBtn.contains(e.target as Node)) {
      close();
    }
  };
  document.addEventListener('click', handleDocClick);

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && menu.style.display !== 'none') close();
  };
  document.addEventListener('keydown', handleKey);

  return { badgeBtn, menu, close, refresh };
}
