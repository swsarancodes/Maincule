import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { TableWidget } from './table';
import { MermaidWidget } from './mermaid';
import { CodeBlockWidget } from './code-block';
import { CalloutWidget } from './callout';
import { HRWidget } from './hr';
import { ImageWidget } from './image';
import { FrontmatterWidget } from './frontmatter';
import { detectFrontmatter } from '../../core/markdown/frontmatter';

export function buildBlockWidgets(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const decos: Array<{ from: number; to: number; deco: Decoration }> = [];

  // Front matter is offset-based (Lezer only tags YAML): it owns [0, to).
  // Every Lezer node inside that range is skipped below so a `---` fence
  // never double-renders as a horizontal rule inside the panel.
  const fm = detectFrontmatter(doc.length > 8192 ? doc.sliceString(0, 8192) : doc.toString());
  if (fm) {
    decos.push({
      from: fm.from,
      to: Math.min(fm.to, doc.length),
      deco: Decoration.replace({ widget: new FrontmatterWidget(doc.sliceString(fm.from, Math.min(fm.to, doc.length)), fm.from, Math.min(fm.to, doc.length)), block: true }),
    });
  }
  const fmTo = fm ? Math.min(fm.to, doc.length) : 0;

  syntaxTree(state).iterate({
    from: 0,
    to: doc.length,
    enter: (node) => {
      const name = node.name;
      const nodeFrom = node.from;
      const nodeTo = node.to;

      // Front-matter range is owned by the panel above — never decorate inside.
      if (fmTo > 0 && nodeFrom < fmTo) return false;

      // 1. Tables: Always render interactive Notion-style table widget
      if (name === 'Table') {
        const tableText = doc.sliceString(nodeFrom, nodeTo);
        const widget = new TableWidget(tableText, nodeFrom, nodeTo);
        decos.push({
          from: nodeFrom,
          to: nodeTo,
          deco: Decoration.replace({ widget, block: true }),
        });
        return false; // Don't descend into child table cells
      }

      // 2. Fenced Code Blocks (Mermaid or Standard Code)
      else if (name === 'FencedCode') {
        const blockText = doc.sliceString(nodeFrom, nodeTo);
        const firstLine = blockText.split('\n')[0] || '';
        const langMatch = firstLine.match(/^```([a-zA-Z0-9_\-]+)?/);
        const lang = (langMatch ? langMatch[1] : '')?.toLowerCase() || '';

        if (lang === 'mermaid') {
          const widget = new MermaidWidget(blockText, nodeFrom, nodeTo);
          decos.push({
            from: nodeFrom,
            to: nodeTo,
            deco: Decoration.replace({ widget, block: true }),
          });
          return false;
        } else {
          const widget = new CodeBlockWidget(blockText, nodeFrom, nodeTo, lang);
          decos.push({
            from: nodeFrom,
            to: nodeTo,
            deco: Decoration.replace({ widget, block: true }),
          });
          return false;
        }
      }

      // 3. Blockquotes / Callouts
      else if (name === 'Blockquote') {
        const quoteText = doc.sliceString(nodeFrom, nodeTo);
        const widget = new CalloutWidget(quoteText, nodeFrom, nodeTo);
        decos.push({
          from: nodeFrom,
          to: nodeTo,
          deco: Decoration.replace({ widget, block: true }),
        });
        return false;
      }

      // 4. Horizontal Rules
      else if (name === 'HorizontalRule') {
        const hrText = doc.sliceString(nodeFrom, nodeTo);
        const widget = new HRWidget(hrText, nodeFrom, nodeTo);
        decos.push({
          from: nodeFrom,
          to: nodeTo,
          deco: Decoration.replace({ widget, block: true }),
        });
      }

      // 6. Image Widget: ![alt](url)
      else if (name === 'Image') {
        const imageText = doc.sliceString(nodeFrom, nodeTo);
        const line = doc.lineAt(nodeFrom);
        const isWholeLine = line.text.trim() === imageText.trim();

        if (isWholeLine) {
          const widget = new ImageWidget(imageText, line.from, line.to);
          decos.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({ widget, block: true }),
          });
        } else {
          const widget = new ImageWidget(imageText, nodeFrom, nodeTo);
          decos.push({
            from: nodeFrom,
            to: nodeTo,
            deco: Decoration.replace({ widget }),
          });
        }
        return false;
      }
    },
  });

  // Sort strictly by from ascending, to ascending
  decos.sort((a, b) => a.from - b.from || a.to - b.to);

  for (const item of decos) {
    builder.add(item.from, item.to, item.deco);
  }

  return builder.finish();
}

/**
 * StateField for block widgets (Tables, Mermaid, Code Blocks, Callouts)
 */
export const blockWidgetField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockWidgets(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildBlockWidgets(tr.state);
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});
