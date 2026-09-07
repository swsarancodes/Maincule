import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { createBlockMenu } from './block-actions';

let mermaidPromise: Promise<any> | null = null;
let mermaidInstance: any = null;
const svgCache = new Map<string, string>();

async function getMermaid() {
  if (mermaidInstance) return mermaidInstance;
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      mermaidInstance = m.default;
      initMermaidTheme(mermaidInstance);
      return mermaidInstance;
    });
  }
  return mermaidPromise;
}

function initMermaidTheme(m: any) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  m.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'neutral',
    securityLevel: 'loose',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
    themeVariables: isDark
      ? {
          primaryColor: '#2b6cb0',
          primaryTextColor: '#eeeeee',
          primaryBorderColor: '#3e3e48',
          lineColor: '#60a5fa',
          secondaryColor: '#1d1d20',
          tertiaryColor: '#26262b',
        }
      : {
          primaryColor: '#ebf5ff',
          primaryTextColor: '#212124',
          primaryBorderColor: '#cbd5e0',
          lineColor: '#2b6cb0',
          secondaryColor: '#f7f6f3',
          tertiaryColor: '#f3f1ec',
        },
  });
}

const DIAGRAM_TEMPLATES: Record<string, string> = {
  flowchart: `flowchart TD
    A[Start] --> B[Process Step]
    B --> C{Decision}
    C -->|Yes| D[Result 1]
    C -->|No| E[Result 2]`,
  sequence: `sequenceDiagram
    autonumber
    actor User
    participant Client
    participant Server
    User->>Client: Click Action
    Client->>Server: Request
    Server-->>Client: Response
    Client-->>User: Update View`,
  mindmap: `mindmap
  root((Topic))
    Origins
      Concept
      Vision
    Architecture
      Client
      Server
    Features
      Markdown
      Diagrams`,
  classDiagram: `classDiagram
    class Note {
      +String title
      +String content
      +save()
    }
    class Workspace {
      +List~Note~ notes
      +openNote()
    }
    Workspace o-- Note`,
  stateDiagram: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review: Submit
    Review --> Published: Approve
    Review --> Draft: Request Changes
    Published --> [*]`,
  erDiagram: `erDiagram
    USER ||--o{ DOCUMENT : owns
    DOCUMENT ||--|{ REVISION : contains
    USER {
        string id PK
        string email
    }`,
  pie: `pie title Distribution
    "Core Writing" : 55
    "Code & Technical" : 25
    "Diagrams & Visuals" : 20`,
  gitGraph: `gitGraph
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop
    commit`,
};

function extractCleanMermaidCode(src: string): string {
  return src
    .replace(/^```mermaid\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

interface MermaidWidgetState {
  widget: MermaidWidget;
  mode: 'preview' | 'split' | 'code';
  onDocUpdate: (newSource: string) => void;
}

export class MermaidWidget extends MarkdownWidget {
  override nodeName = 'FencedCode';

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const state = (dom as any).__mermaidState as MermaidWidgetState | undefined;
    if (state) {
      state.widget = this;
      state.onDocUpdate(this.source);
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'as-diagram-container';

    // Mode state: 'preview' | 'split' | 'code'
    let currentMode: 'preview' | 'split' | 'code' = 'preview';
    let cleanCode = extractCleanMermaidCode(this.source);

    // 1. Toolbar Header
    const toolbar = document.createElement('div');
    toolbar.className = 'as-diagram-toolbar';

    const left = document.createElement('div');
    left.className = 'as-diagram-badge';
    left.style.position = 'relative';

    // Block menu badge: "● Mermaid Diagram ▾" -> Move up / Move down / Delete
    const self = this;
    const blockMenu = createBlockMenu({
      view,
      getWidget: () => self,
      dom: container,
      label: 'Mermaid Diagram',
    });
    // Prepend dot indicator inside badge
    const dot = document.createElement('span');
    dot.className = 'as-diagram-dot';
    blockMenu.badgeBtn.prepend(dot);
    left.appendChild(blockMenu.badgeBtn);
    left.appendChild(blockMenu.menu);

    // Type Switcher Select
    const select = document.createElement('select');
    select.className = 'as-diagram-select';
    select.title = 'Switch Diagram Type Template';

    const options = [
      { key: '', label: 'Templates…' },
      { key: 'flowchart', label: 'Flowchart' },
      { key: 'sequence', label: 'Sequence' },
      { key: 'mindmap', label: 'Mindmap' },
      { key: 'classDiagram', label: 'Class Diagram' },
      { key: 'stateDiagram', label: 'State Diagram' },
      { key: 'erDiagram', label: 'ER Diagram' },
      { key: 'pie', label: 'Pie Chart' },
      { key: 'gitGraph', label: 'Git Graph' },
    ];

    for (const opt of options) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.key;
      optionEl.textContent = opt.label;
      select.appendChild(optionEl);
    }

    select.onchange = (e) => {
      e.stopPropagation();
      const chosen = select.value;
      if (chosen && DIAGRAM_TEMPLATES[chosen]) {
        const templateCode = DIAGRAM_TEMPLATES[chosen];
        textarea.value = templateCode;
        cleanCode = templateCode;
        renderDiagram(templateCode);
        const newBlockText = `\`\`\`mermaid\n${templateCode}\n\`\`\``;
        this.replace(view, newBlockText, container);
        if (currentMode === 'preview') {
          currentMode = 'split';
          stateObj.mode = 'split';
          updateModeUI();
        }
      }
      select.value = '';
    };

    left.appendChild(select);
    toolbar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'as-diagram-actions';

    // Mode Buttons: Preview | Split | Code
    const modeBtnGroup = document.createElement('div');
    modeBtnGroup.className = 'as-widget-btn-group';

    const previewBtn = document.createElement('button');
    previewBtn.className = 'as-widget-btn as-widget-btn-active';
    previewBtn.textContent = 'Preview';

    const splitBtn = document.createElement('button');
    splitBtn.className = 'as-widget-btn';
    splitBtn.textContent = 'Split';

    const codeBtn = document.createElement('button');
    codeBtn.className = 'as-widget-btn';
    codeBtn.textContent = 'Code';

    modeBtnGroup.appendChild(previewBtn);
    modeBtnGroup.appendChild(splitBtn);
    modeBtnGroup.appendChild(codeBtn);
    right.appendChild(modeBtnGroup);

    // Copy Code Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'as-widget-btn';
    copyBtn.title = 'Copy Mermaid Code';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(textarea.value || cleanCode);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    };
    right.appendChild(copyBtn);

    // Export SVG Button
    const exportBtn = document.createElement('button');
    exportBtn.className = 'as-widget-btn';
    exportBtn.title = 'Export Diagram as SVG';
    exportBtn.textContent = 'Export SVG';
    exportBtn.onclick = (e) => {
      e.stopPropagation();
      const svgEl = body.querySelector('svg');
      if (svgEl) {
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagram-${Date.now()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
      }
    };
    right.appendChild(exportBtn);

    toolbar.appendChild(right);
    container.appendChild(toolbar);

    // 2. Main Content Wrapper (Supports Split, Code, or Preview)
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'as-diagram-content-wrapper';

    // Editor Area (Code text area)
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'as-diagram-editor-wrapper';
    editorWrapper.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.className = 'as-diagram-textarea';
    textarea.value = cleanCode;
    textarea.spellcheck = false;
    textarea.placeholder = 'Type Mermaid diagram syntax here...';

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let renderTimer: ReturnType<typeof setTimeout> | null = null;

    textarea.addEventListener('input', (e) => {
      e.stopPropagation();
      const newDiagramCode = textarea.value;

      // Realtime SVG re-render (debounced 100ms for smooth typing)
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        renderDiagram(newDiagramCode);
      }, 100);

      // Debounced writeback to document text buffer (350ms)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        cleanCode = newDiagramCode;
        const newBlockText = `\`\`\`mermaid\n${newDiagramCode}\n\`\`\``;
        this.replace(view, newBlockText, container);
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
        currentMode = 'preview';
        stateObj.mode = 'preview';
        updateModeUI();
        view.focus();
      }
    });

    editorWrapper.appendChild(textarea);
    contentWrapper.appendChild(editorWrapper);

    // Diagram Body (SVG Render)
    const body = document.createElement('div');
    body.className = 'as-diagram-body';
    body.title = 'Double-click to edit diagram code';
    body.ondblclick = (e) => {
      e.stopPropagation();
      if (currentMode === 'preview') {
        currentMode = 'split';
        stateObj.mode = 'split';
        updateModeUI();
        textarea.focus();
      }
    };
    contentWrapper.appendChild(body);

    container.appendChild(contentWrapper);

    // Function to render diagram SVG with caching and lazy loading
    const renderDiagram = async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        body.innerHTML = `
          <div class="as-diagram-error">
            <span class="as-diagram-error-title">Empty Diagram</span>
            <span class="as-diagram-error-desc">Add Mermaid syntax in Code or Split mode to render.</span>
          </div>
        `;
        return;
      }

      const themeKey = document.documentElement.getAttribute('data-theme') || 'light';
      const cacheKey = `${themeKey}:${trimmed}`;
      const cached = svgCache.get(cacheKey);
      if (cached) {
        body.innerHTML = cached;
        const svgEl = body.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }
        return;
      }

      try {
        const m = await getMermaid();
        const renderId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await m.render(renderId, trimmed);
        svgCache.set(cacheKey, svg);
        body.innerHTML = svg;
        const svgEl = body.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }
      } catch (err: any) {
        body.innerHTML = `
          <div class="as-diagram-error">
            <span class="as-diagram-error-title">Mermaid Syntax Note</span>
            <span class="as-diagram-error-desc">${err?.message || 'Incomplete or invalid diagram syntax'}</span>
          </div>
        `;
      }
    };

    // Update Mode UI
    const updateModeUI = () => {
      container.dataset.mode = currentMode;
      previewBtn.className = currentMode === 'preview' ? 'as-widget-btn as-widget-btn-active' : 'as-widget-btn';
      splitBtn.className = currentMode === 'split' ? 'as-widget-btn as-widget-btn-active' : 'as-widget-btn';
      codeBtn.className = currentMode === 'code' ? 'as-widget-btn as-widget-btn-active' : 'as-widget-btn';

      if (currentMode === 'preview') {
        editorWrapper.style.display = 'none';
        body.style.display = 'flex';
        contentWrapper.className = 'as-diagram-content-wrapper';
      } else if (currentMode === 'code') {
        editorWrapper.style.display = 'flex';
        body.style.display = 'none';
        contentWrapper.className = 'as-diagram-content-wrapper';
        setTimeout(() => textarea.focus(), 50);
      } else if (currentMode === 'split') {
        editorWrapper.style.display = 'flex';
        body.style.display = 'flex';
        contentWrapper.className = 'as-diagram-content-wrapper as-diagram-split';
        setTimeout(() => textarea.focus(), 50);
      }
    };

    previewBtn.onclick = (e) => {
      e.stopPropagation();
      currentMode = 'preview';
      stateObj.mode = 'preview';
      updateModeUI();
    };

    splitBtn.onclick = (e) => {
      e.stopPropagation();
      currentMode = 'split';
      stateObj.mode = 'split';
      updateModeUI();
    };

    codeBtn.onclick = (e) => {
      e.stopPropagation();
      currentMode = 'code';
      stateObj.mode = 'code';
      updateModeUI();
    };

    // State object attached to container to support updateDOM without recreation
    const stateObj: MermaidWidgetState = {
      widget: this,
      mode: currentMode,
      onDocUpdate: (newSource: string) => {
        const nextCode = extractCleanMermaidCode(newSource);
        if (nextCode !== cleanCode) {
          cleanCode = nextCode;
          if (document.activeElement !== textarea && textarea.value !== cleanCode) {
            textarea.value = cleanCode;
            renderDiagram(cleanCode);
          }
        }
      },
    };
    (container as any).__mermaidState = stateObj;

    // Initial render
    renderDiagram(cleanCode);

    return container;
  }
}
