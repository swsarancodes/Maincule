import { formatDisplayName } from './file-meta';
import { renderMarkdownToHtmlBody } from './render-html';

/**
 * Triggers native browser print dialog, using @media print stylesheet for clean PDF export.
 */
export function exportToPdf(): void {
  window.print();
}

/**
 * Downloads the document content as a standard .md file to local disk.
 */
export function exportToMarkdown(fileName: string, content: string): void {
  const cleanName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Renders the document through the remark pipeline and downloads a clean,
 * standalone, self-contained HTML file (offline — no external requests).
 * Front matter is stripped; math renders as MathML; raw HTML stays inert.
 * Falls back to an escaped source dump if rendering ever fails.
 */
export async function exportToHtml(fileName: string, content: string): Promise<void> {
  const title = formatDisplayName(fileName);
  const cleanName = fileName.replace(/\.md$/i, '') + '.html';

  let bodyHtml: string;
  try {
    bodyHtml = await renderMarkdownToHtmlBody(content);
  } catch (e) {
    console.warn('HTML export render failed, falling back to source dump:', e);
    const escapedContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    bodyHtml = `<pre style="white-space: pre-wrap;">${escapedContent}</pre>`;
  }

  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlAttr(title)}</title>
  <style>
    :root {
      color-scheme: light;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.65;
      max-width: 78ch;
      margin: 40px auto;
      padding: 0 20px;
      color: #1a1a1a;
      background-color: #faf9f7;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin: 1.5em 0 0.5em;
    }
    p, ul, ol, pre, table, blockquote, math {
      margin: 1em 0;
    }
    a {
      color: #4a5568;
    }
    pre {
      background-color: #f3f4f6;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      line-height: 1.5;
    }
    code {
      background-color: #f3f4f6;
      padding: 2px 4px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
    }
    pre code {
      background: none;
      padding: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background-color: #f9fafb;
    }
    blockquote {
      border-left: 4px solid #3b82f6;
      margin: 16px 0;
      padding: 4px 0 4px 16px;
      color: #4b5563;
    }
    blockquote > :first-child {
      margin-top: 0;
    }
    blockquote > :last-child {
      margin-bottom: 0;
    }
    img {
      max-width: 100%;
    }
    hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 2em 0;
    }
    .contains-task-list {
      list-style: none;
      padding-left: 0;
    }
    .task-list-item input[type="checkbox"] {
      margin-right: 6px;
    }
    .katex-display {
      text-align: center;
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Escape for the <title> attribute context. */
function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
