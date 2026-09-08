import { Extension } from '@codemirror/state';
import { ViewPlugin, ViewUpdate, EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
// CSS stays static (small, needed for correct layout once upgraded);
// the heavy KaTeX JS + fonts are lazy-loaded below.
import 'katex/dist/katex.min.css';

// KaTeX is lazy-loaded: static import pulled ~200KB + fonts into the startup
// chunk even for docs without formulas. Widgets render a plain-text
// placeholder synchronously, then upgrade in place once the chunk arrives.
// Rendered output is cached per formula so re-decorations skip re-render.
type KatexLike = { renderToString: (tex: string, opts: any) => string };
let katexPromise: Promise<KatexLike | null> | null = null;
const renderCache = new Map<string, string>();
const MAX_CACHE = 200;

function loadKatex(): Promise<KatexLike | null> {
  if (!katexPromise) {
    katexPromise = import('katex').then(
      (m: any) => (m?.default ?? m ?? null) as KatexLike | null,
      () => null
    );
  }
  return katexPromise;
}

function cachedRender(katex: KatexLike, latex: string, displayMode: boolean): string {
  const key = `${displayMode ? 'b' : 'i'}:${latex}`;
  const hit = renderCache.get(key);
  if (hit !== undefined) return hit;
  const html = katex.renderToString(latex.trim(), { displayMode, throwOnError: false });
  if (renderCache.size >= MAX_CACHE) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
  renderCache.set(key, html);
  return html;
}

export class MathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly displayMode: boolean
  ) {
    super();
  }

  eq(other: MathWidget) {
    return this.latex === other.latex && this.displayMode === other.displayMode;
  }

  toDOM(view: EditorView) {
    const isBlock = this.displayMode;
    const container = document.createElement(isBlock ? 'div' : 'span');
    container.className = isBlock ? 'as-math-block' : 'as-math-inline';
    container.title = 'Click to edit LaTeX formula';
    // Synchronous placeholder keeps keystroke→paint under budget; the
    // async upgrade below replaces it when KaTeX arrives.
    container.textContent = `$${this.latex}$`;

    void loadKatex().then((katex) => {
      if (!katex) return;
      try {
        container.innerHTML = cachedRender(katex, this.latex, isBlock);
      } catch {
        container.textContent = `$${this.latex}$`;
        container.style.color = '#ef4444';
      }
    });

    container.addEventListener('click', (e) => {
      const pos = view.posAtDOM(container);
      if (typeof pos === 'number' && pos >= 0) {
        e.preventDefault();
        view.dispatch({
          selection: { anchor: pos },
        });
        view.focus();
      }
    });

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'click';
  }
}

// Regex for block math: $$...$$
const BLOCK_MATH_REGEX = /(\$\$)([\s\S]*?)(\$\$)/g;

// Regex for inline math: $formula$ (ignores escaped dollars, empty $$, and currency like $50)
const INLINE_MATH_REGEX = /(?<!\\|\$)(\$)(?!\s|\$)((?:[^\$\n]|\\\$)+?)(?<!\s|\\)(\$)(?!\d|\$)/g;

export const mathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view: EditorView): DecorationSet {
      const widgets: any[] = [];
      const cursor = view.state.selection.main.head;

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);

        // 1. Block Math ($$...$$)
        BLOCK_MATH_REGEX.lastIndex = 0;
        let blockMatch: RegExpExecArray | null;
        const matchedBlockRanges: Array<{ start: number; end: number }> = [];

        while ((blockMatch = BLOCK_MATH_REGEX.exec(text)) !== null) {
          const start = from + blockMatch.index;
          const end = start + blockMatch[0].length;
          matchedBlockRanges.push({ start, end });

          if (cursor < start || cursor > end) {
            const formula = blockMatch[2];
            widgets.push(
              Decoration.replace({
                widget: new MathWidget(formula, true),
              }).range(start, end)
            );
          }
        }

        // 2. Inline Math ($formula$)
        INLINE_MATH_REGEX.lastIndex = 0;
        let inlineMatch: RegExpExecArray | null;

        while ((inlineMatch = INLINE_MATH_REGEX.exec(text)) !== null) {
          const start = from + inlineMatch.index;
          const end = start + inlineMatch[0].length;

          // Skip if inside a matched block math
          const insideBlock = matchedBlockRanges.some(
            (b) => start >= b.start && end <= b.end
          );
          if (insideBlock) continue;

          if (cursor < start || cursor > end) {
            const formula = inlineMatch[2];
            widgets.push(
              Decoration.replace({
                widget: new MathWidget(formula, false),
              }).range(start, end)
            );
          }
        }
      }

      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export const mathExtension: Extension = [mathPlugin];
