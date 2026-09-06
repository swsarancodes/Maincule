import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { useWorkspaceStore } from '../../app/stores/workspace';
import { resolveImageSrc } from '../../ipc/vault';

export interface ParsedImage {
  alt: string;
  url: string;
  title?: string;
}

export function parseImageMarkdown(source: string): ParsedImage | null {
  const match = source.match(/^!\[(.*?)\]\((.*?)(?:\s+"(.*?)")?\)$/);
  if (!match) return null;
  return {
    alt: match[1] || '',
    url: match[2]?.trim() || '',
    title: match[3] || undefined,
  };
}

export function serializeImageMarkdown(alt: string, url: string, title?: string): string {
  if (title) {
    return `![${alt}](${url} "${title}")`;
  }
  return `![${alt}](${url})`;
}

export class ImageWidget extends MarkdownWidget {
  override nodeName = 'Image';
  private parsed: ParsedImage;

  constructor(
    source: string,
    from: number,
    to: number,
    parsed?: ParsedImage
  ) {
    super(source, from, to);
    this.parsed = parsed || parseImageMarkdown(source) || { alt: 'Image', url: '' };
  }

  eq(other: ImageWidget): boolean {
    return (
      other.source === this.source &&
      other.from === this.from &&
      other.to === this.to &&
      other.parsed.url === this.parsed.url &&
      other.parsed.alt === this.parsed.alt
    );
  }

  ignoreEvent(_event: Event): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'as-image-widget';
    container.style.cssText = `
      position: relative;
      display: inline-block;
      max-width: 100%;
      margin: 12px 0;
      user-select: none;
      vertical-align: middle;
    `;

    const innerWrapper = document.createElement('div');
    innerWrapper.style.cssText = `
      position: relative;
      display: inline-block;
      max-width: 100%;
      border-radius: var(--as-radius-md, 6px);
      overflow: hidden;
      border: 1px solid var(--as-border-subtle, rgba(128,128,128,0.15));
      background-color: var(--as-bg-surface, #fff);
      transition: box-shadow var(--as-transition-fast, 0.15s ease);
    `;

    // 1. Image Element
    const img = document.createElement('img');
    // Vault-relative URLs resolve to streamable asset URLs in the desktop
    // shell; the markdown source keeps the portable relative path.
    const store = useWorkspaceStore.getState();
    const activeDoc = store.documents.find((d) => d.id === store.activeDocumentId);
    img.src = resolveImageSrc(this.parsed.url, activeDoc?.meta.filePath ?? null, store.vaultRoot);
    img.alt = this.parsed.alt || 'Markdown Image';
    img.loading = 'lazy';
    img.style.cssText = `
      display: block;
      max-width: 100%;
      max-height: 520px;
      height: auto;
      object-fit: contain;
      border-radius: var(--as-radius-md, 6px);
      cursor: pointer;
    `;

    // 2. Error Fallback Element
    const errorFallback = document.createElement('div');
    errorFallback.style.cssText = `
      display: none;
      padding: 18px 24px;
      background: var(--as-bg-subtle, rgba(128,128,128,0.08));
      border-radius: var(--as-radius-md, 6px);
      border: 1px dashed var(--as-border, rgba(128,128,128,0.3));
      color: var(--as-text-muted, #888);
      font-size: 13px;
      align-items: center;
      gap: 8px;
    `;
    errorFallback.innerHTML = `
      <span style="font-size: 16px;">🖼</span>
      <span>Unable to load image (<em>${this.parsed.alt || 'No alt text'}</em>)</span>
    `;

    img.onerror = () => {
      img.style.display = 'none';
      errorFallback.style.display = 'flex';
    };

    innerWrapper.appendChild(img);
    innerWrapper.appendChild(errorFallback);

    // 3. Hover Floating Action Bar
    const actionBar = document.createElement('div');
    actionBar.className = 'as-image-actions';
    actionBar.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 6px;
      background: rgba(30, 30, 30, 0.75);
      backdrop-filter: blur(8px);
      border-radius: var(--as-radius-sm, 4px);
      opacity: 0;
      transition: opacity var(--as-transition-fast, 0.15s ease);
      z-index: 10;
    `;

    const makeBtn = (text: string, title: string, onClick: (e: MouseEvent) => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.title = title;
      btn.style.cssText = `
        background: transparent;
        border: none;
        color: #fff;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 3px;
        cursor: pointer;
        font-family: inherit;
        opacity: 0.85;
      `;
      btn.onmouseenter = () => (btn.style.opacity = '1');
      btn.onmouseleave = () => (btn.style.opacity = '0.85');
      btn.onclick = onClick;
      return btn;
    };

    // Copy URL Action
    const copyBtn = makeBtn('Copy URL', 'Copy image URL to clipboard', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(this.parsed.url);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy URL'), 1500);
    });

    // Edit Markdown / Alt Action
    const editBtn = makeBtn('Edit', 'Edit image details', (e) => {
      e.stopPropagation();
      const range = this.resolveRange(view, container);
      window.dispatchEvent(
        new CustomEvent('as:edit-image', {
          detail: {
            from: range.from,
            to: range.to,
            alt: this.parsed.alt,
            url: this.parsed.url,
            title: this.parsed.title,
          },
        })
      );
      view.dispatch({
        selection: { anchor: range.from, head: range.to },
      });
      view.focus();
    });

    // Delete Image Action
    const deleteBtn = makeBtn('Delete', 'Delete image', (e) => {
      e.stopPropagation();
      const range = this.resolveRange(view, container);
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: '' },
      });
      view.focus();
    });

    actionBar.appendChild(copyBtn);
    actionBar.appendChild(editBtn);
    actionBar.appendChild(deleteBtn);
    innerWrapper.appendChild(actionBar);

    innerWrapper.onmouseenter = () => {
      actionBar.style.opacity = '1';
      innerWrapper.style.boxShadow = '0 4px 14px rgba(0,0,0,0.1)';
    };
    innerWrapper.onmouseleave = () => {
      actionBar.style.opacity = '0';
      innerWrapper.style.boxShadow = 'none';
    };

    container.appendChild(innerWrapper);

    // 4. Caption (if alt text exists)
    if (this.parsed.alt && this.parsed.alt !== 'Image') {
      const caption = document.createElement('div');
      caption.className = 'as-image-caption';
      caption.textContent = this.parsed.alt;
      caption.style.cssText = `
        text-align: center;
        font-size: 12px;
        color: var(--as-text-muted, #777);
        margin-top: 4px;
        user-select: text;
      `;
      container.appendChild(caption);
    }

    return container;
  }

  updateDOM(dom: HTMLElement): boolean {
    const img = dom.querySelector('img');
    if (img && img.src === this.parsed.url && img.alt === this.parsed.alt) {
      return true;
    }
    return false;
  }
}
