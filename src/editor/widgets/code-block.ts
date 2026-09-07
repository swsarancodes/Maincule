import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { createBlockMenu } from './block-actions';

interface CodeBlockWidgetState {
  widget: CodeBlockWidget;
  isEditing: boolean;
  onDocUpdate: (newSource: string) => void;
}

export class CodeBlockWidget extends MarkdownWidget {
  override nodeName = 'FencedCode';

  constructor(
    source: string,
    from: number,
    to: number,
    public readonly language: string = 'text'
  ) {
    super(source, from, to);
  }

  eq(other: CodeBlockWidget): boolean {
    return super.eq(other) && other.language === this.language;
  }

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const state = (dom as any).__codeState as CodeBlockWidgetState | undefined;
    if (state) {
      state.widget = this;
      state.onDocUpdate(this.source);
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'as-codeblock-container';

    let isEditing = false;
    let currentSource = this.source;

    const extractCode = (src: string) =>
      src
        .replace(/^```[^\n]*\n?/, '')
        .replace(/\n?```\s*$/, '');

    let codeContent = extractCode(currentSource);

    // Header toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'as-codeblock-toolbar';

    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'as-codeblock-badge-wrap';
    badgeWrap.style.position = 'relative';
    badgeWrap.style.display = 'flex';
    badgeWrap.style.alignItems = 'center';

    // Block menu badge: "PYTHON ▾" -> Move up / Move down / Delete
    const self = this;
    const blockMenu = createBlockMenu({
      view,
      getWidget: () => self,
      dom: container,
      label: () => (this.language ? this.language.toUpperCase() : 'CODE'),
    });
    blockMenu.badgeBtn.classList.add('as-codeblock-badge');
    badgeWrap.appendChild(blockMenu.badgeBtn);
    badgeWrap.appendChild(blockMenu.menu);
    toolbar.appendChild(badgeWrap);

    const actions = document.createElement('div');
    actions.className = 'as-codeblock-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'as-widget-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code to clipboard';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(textarea.value || codeContent);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    };
    actions.appendChild(copyBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'as-widget-btn as-widget-btn-subtle';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Toggle code editing';
    actions.appendChild(editBtn);

    toolbar.appendChild(actions);
    container.appendChild(toolbar);

    // Code Preview element
    const pre = document.createElement('pre');
    pre.className = 'as-codeblock-body';
    const code = document.createElement('code');
    code.textContent = codeContent;
    pre.appendChild(code);
    container.appendChild(pre);

    // Editable Textarea element
    const textarea = document.createElement('textarea');
    textarea.className = 'as-codeblock-textarea';
    textarea.value = codeContent;
    textarea.spellcheck = false;
    textarea.style.display = 'none';

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    textarea.addEventListener('input', (e) => {
      e.stopPropagation();
      const newCode = textarea.value;
      codeContent = newCode;
      code.textContent = newCode;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const langStr = this.language && this.language !== 'text' ? this.language : '';
        const newBlock = `\`\`\`${langStr}\n${newCode}\n\`\`\``;
        currentSource = newBlock;
        this.replace(view, newBlock, container);
      }, 350);
    });

    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        textarea.dispatchEvent(new Event('input'));
      } else if (e.key === 'Escape') {
        isEditing = false;
        stateObj.isEditing = false;
        updateView();
        view.focus();
      }
    });

    container.appendChild(textarea);

    const updateView = () => {
      if (isEditing) {
        pre.style.display = 'none';
        textarea.style.display = 'block';
        editBtn.textContent = 'Done';
        editBtn.className = 'as-widget-btn as-widget-btn-active';
        setTimeout(() => textarea.focus(), 50);
      } else {
        pre.style.display = 'block';
        textarea.style.display = 'none';
        editBtn.textContent = 'Edit';
        editBtn.className = 'as-widget-btn as-widget-btn-subtle';
        code.textContent = codeContent;
      }
    };

    editBtn.onclick = (e) => {
      e.stopPropagation();
      isEditing = !isEditing;
      stateObj.isEditing = isEditing;
      updateView();
    };

    // Double-click preview body to toggle edit
    pre.ondblclick = (e) => {
      e.stopPropagation();
      isEditing = true;
      stateObj.isEditing = true;
      updateView();
    };

    const stateObj: CodeBlockWidgetState = {
      widget: this,
      isEditing,
      onDocUpdate: (newSource: string) => {
        if (newSource !== currentSource) {
          currentSource = newSource;
          const nextCode = extractCode(newSource);
          codeContent = nextCode;
          code.textContent = nextCode;
          if (document.activeElement !== textarea) {
            textarea.value = nextCode;
          }
        }
      },
    };
    (container as any).__codeState = stateObj;

    return container;
  }
}
