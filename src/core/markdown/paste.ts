/**
 * Paste-as-Markdown core (pure, no React, no I/O).
 *
 * A9 contract (docs/04-feature-spec.md):
 * - `text/html` clipboard content becomes clean Markdown through the normal
 *   transaction path. No live HTML is ever emitted into the buffer.
 * - Malformed / exotic markup falls back to plain inner text, never a
 *   broken widget or an exception.
 * - Zero network, zero dependencies, O(n) over the clipboard payload.
 *
 * The converter is intentionally dependency-free (no turndown / hast): it
 * must run offline inside the Tauri WebView and inside `bun test` (which
 * has no DOMParser), so it tokenizes the HTML string directly.
 */

const IMAGE_URL_RE =
  /^https?:\/\/[^\s]+?\.(png|jpg|jpeg|gif|webp|svg)(\?[^\s]*)?$/i;
const DATA_IMAGE_RE = /^data:image\/[a-zA-Z+]+;base64,/i;
const PLAIN_URL_RE = /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i;

/** True for remote image URLs and inline data:image URLs. */
export function isImageUrl(text: string): boolean {
  const t = text.trim();
  return IMAGE_URL_RE.test(t) || DATA_IMAGE_RE.test(t);
}

/** True for any pastable URL (used for smart-link wrapping). */
export function isPlainUrl(text: string): boolean {
  return PLAIN_URL_RE.test(text.trim());
}

// ---------------------------------------------------------------------------
// Minimal HTML tokenizer + tree builder (no DOM needed)
// ---------------------------------------------------------------------------

interface Node {
  tag: string; // '#text' for text nodes, otherwise lowercase tag name
  text?: string;
  attrs?: Record<string, string>;
  children?: Node[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const VOID_TAGS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'wbr',
]);

function buildTree(html: string): Node {
  const root: Node = { tag: 'root', children: [] };
  const stack: Node[] = [root];
  // Strip comments, script/style blocks (incl. their content) up front.
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '');
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>|([^<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(clean)) !== null) {
    if (m[3] !== undefined) {
      const text = decodeEntities(m[3]);
      if (text) {
        stack[stack.length - 1].children!.push({ tag: '#text', text });
      }
      continue;
    }
    const full = m[0];
    const tag = m[1].toLowerCase();
    const isClose = full.startsWith('</');
    const selfClose = full.endsWith('/>') || VOID_TAGS.has(tag);
    if (isClose) {
      // Pop to the matching opener; tolerate mismatched nesting.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node: Node = { tag, attrs: parseAttrs(m[2] ?? ''), children: [] };
    stack[stack.length - 1].children!.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Tree -> Markdown renderer
// ---------------------------------------------------------------------------

function escapeInline(s: string): string {
  // Keep pasted text literal: backslashes first, then marker chars that
  // would otherwise re-parse as formatting.
  return s.replace(/\\/g, '\\\\').replace(/([`*_\[\]])/g, '\\$1');
}

function inlineChildren(node: Node): string {
  return (node.children ?? []).map(renderInline).join('');
}

function renderInline(node: Node): string {
  if (node.tag === '#text') return escapeInline(node.text ?? '');
  const kids = inlineChildren(node);
  switch (node.tag) {
    case 'strong':
    case 'b':
      return kids ? `**${kids}**` : '';
    case 'em':
    case 'i':
      return kids ? `*${kids}*` : '';
    case 'del':
    case 's':
    case 'strike':
      return kids ? `~~${kids}~~` : '';
    case 'code': {
      // Inline code: use double backticks when the content has one.
      if (!kids) return '';
      if (kids.indexOf('`') !== -1) return '`` ' + kids + ' ``';
      return '`' + kids + '`';
    }
    case 'a': {
      const href = (node.attrs?.['href'] ?? '').trim();
      if (!href) return kids;
      if (!kids) return `<${href}>`;
      return `[${kids}](${href})`;
    }
    case 'img': {
      const src = (node.attrs?.['src'] ?? '').trim();
      if (!src) return '';
      const alt = (node.attrs?.['alt'] ?? '').replace(/[\[\]]/g, '');
      return `![${alt}](${src})`;
    }
    case 'br':
      return '  \n';
    case 'input': {
      // Google Docs / Notion task lists arrive as checkbox inputs.
      const type = (node.attrs?.['type'] ?? '').toLowerCase();
      if (type === 'checkbox') return node.attrs?.['checked'] !== undefined ? '[x] ' : '[ ] ';
      return '';
    }
    case 'span':
    case 'font':
    case 'u':
    case 'abbr':
    case 'kbd':
    case 'samp':
    case 'var':
    case 'sub':
    case 'sup':
    case 'mark':
    case 'small':
    case 'time':
      return kids;
    default:
      // Unknown inline element: drop the tag, keep the text (inert posture).
      return kids;
  }
}

function tableCellText(cell: Node): string {
  // Cell content is inline; pipes must be escaped so the row doesn't split.
  const raw = inlineChildren(cell).replace(/\\/g, '');
  return raw.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function renderTable(node: Node): string {
  const rows: Node[][] = [];
  const walk = (n: Node) => {
    if (n.tag === 'tr') {
      rows.push((n.children ?? []).filter((c) => c.tag === 'th' || c.tag === 'td'));
    } else {
      for (const c of n.children ?? []) walk(c);
    }
  };
  walk(node);
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 0) return '';
  // Rectangularize; bail to plain text when the table is degenerate.
  if (cols > 12 || rows.length > 50) return rows.map((r) => r.map(tableCellText).join(' | ')).join('\n');
  const norm = rows.map((r) => {
    const cells = r.map(tableCellText);
    while (cells.length < cols) cells.push('');
    return cells.slice(0, cols);
  });
  const header = `| ${norm[0].join(' | ')} |`;
  const delim = `| ${norm[0].map(() => '---').join(' | ')} |`;
  const body = norm.slice(1).map((r) => `| ${r.join(' | ')} |`);
  return [header, delim, ...body].join('\n');
}

function renderBlocks(node: Node, out: string[]): void {
  if (node.tag === '#text') {
    const t = (node.text ?? '').replace(/\s+/g, ' ').trim();
    if (t) out.push(escapeInline(node.text ?? '').replace(/\s+/g, ' ').trim());
    return;
  }
  switch (node.tag) {
    case 'root':
    case 'html':
    case 'body':
    case 'article':
    case 'section':
    case 'main':
    case 'div':
    case 'span':
      for (const c of node.children ?? []) renderBlocks(c, out);
      break;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(node.tag[1]);
      const t = inlineChildren(node).replace(/\s+/g, ' ').trim();
      if (t) out.push(`${'#'.repeat(level)} ${t}`);
      break;
    }
    case 'p':
    case 'header':
    case 'footer':
    case 'figure':
    case 'figcaption': {
      const t = inlineChildren(node).replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      break;
    }
    case 'blockquote': {
      const inner: string[] = [];
      for (const c of node.children ?? []) renderBlocks(c, inner);
      const lines = inner.join('\n\n').split('\n');
      const quoted = lines.map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
      if (quoted.trim() !== '>') out.push(quoted);
      break;
    }
    case 'pre': {
      // Fenced block: prefer <code class="language-x"> when present.
      const codeEl = (node.children ?? []).find((c) => c.tag === 'code');
      const rawText = (node.children ?? [])
        .map((c) => (c.tag === '#text' ? (c.text ?? '') : c.tag === 'code' ? (c.children ?? []).map((g) => (g.tag === '#text' ? g.text ?? '' : '')).join('') : ''))
        .join('');
      let lang = '';
      const cls = codeEl?.attrs?.['class'] ?? '';
      const lm = cls.match(/language-([\w+-]+)/);
      if (lm) lang = lm[1];
      const code = decodeEntities(rawText).replace(/\n+$/g, '');
      out.push(`\`\`\`${lang}\n${code}\n\`\`\``);
      break;
    }
    case 'hr':
      out.push('---');
      break;
    case 'ul':
    case 'ol': {
      let idx = 1;
      const ordered = node.tag === 'ol';
      const startAttr = Number.parseInt(node.attrs?.['start'] ?? '1', 10);
      if (ordered && Number.isFinite(startAttr) && startAttr > 1) idx = startAttr;
      for (const li of node.children ?? []) {
        if (li.tag !== 'li') {
          renderBlocks(li, out);
          continue;
        }
        // A list item may itself contain blocks (nested lists, paragraphs).
        const inlineParts: string[] = [];
        const nested: string[] = [];
        for (const c of li.children ?? []) {
          if (c.tag === 'ul' || c.tag === 'ol') {
            const sub: string[] = [];
            renderBlocks(c, sub);
            nested.push(...sub);
          } else if (c.tag === 'p' || c.tag === 'div') {
            inlineParts.push(inlineChildren(c).replace(/\s+/g, ' ').trim());
          } else {
            const s = renderInline(c);
            if (s) inlineParts.push(s);
          }
        }
        const marker = ordered ? `${idx++}. ` : '- ';
        const first = inlineParts.join('').replace(/\s+/g, ' ').trim();
        out.push(`${marker}${first}`);
        for (const n of nested) {
          // Indent nested blocks under the parent item.
          out.push(n.split('\n').map((l) => `  ${l}`).join('\n'));
        }
      }
      break;
    }
    case 'table':
      out.push(renderTable(node));
      break;
    case 'img': {
      const md = renderInline(node);
      if (md) out.push(md);
      break;
    }
    case 'br':
      break;
    default: {
      // Unknown block-level element: recurse (keep text, drop tags).
      const kids = node.children ?? [];
      if (kids.length === 0) break;
      // If it behaves like inline content, emit as a paragraph.
      const asInline = inlineChildren(node).replace(/\s+/g, ' ').trim();
      if (asInline && kids.every((c) => c.tag === '#text' || c.tag === 'a' || c.tag === 'strong' || c.tag === 'em' || c.tag === 'code' || c.tag === 'span' || c.tag === 'img' || c.tag === 'br' || c.tag === 'del' || c.tag === 's' || c.tag === 'b' || c.tag === 'i' || c.tag === 'u')) {
        out.push(asInline);
      } else {
        for (const c of kids) renderBlocks(c, out);
      }
    }
  }
}

/**
 * Convert an HTML clipboard payload to Markdown. Never throws: on any
 * unexpected shape it returns '' so the caller falls back to plain text.
 */
export function htmlToMarkdown(html: string): string {
  try {
    if (!html || !/<[a-zA-Z][^>]*>/.test(html)) return '';
    const tree = buildTree(html);
    const out: string[] = [];
    renderBlocks(tree, out);
    return out
      .map((b) => b.replace(/[ \t]+\n/g, '\n').trim())
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
}
