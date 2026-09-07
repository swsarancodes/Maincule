import { frontmatterEnd } from '../markdown/frontmatter';

/**
 * Markdown → sanitized HTML fragment for export (F1).
 *
 * Per ADR-006 this is the remark pipeline — Lezer output never leaves the
 * editor. Raw HTML in the source is dropped (inert posture: we never emit
 * live HTML the user didn't write as Markdown). Math renders as MathML
 * (no KaTeX CSS/fonts needed — renders natively, keeps the file offline).
 * Mermaid fences export as code blocks (SVG snapshot is a follow-up).
 *
 * Remark is dynamically imported so the ~150kB pipeline lives in a
 * lazily-loaded chunk instead of the startup bundle.
 */
export async function renderMarkdownToHtmlBody(markdown: string): Promise<string> {
  const [{ remark }, { default: remarkGfm }, { default: remarkMath }, { default: remarkRehype }, { default: rehypeKatex }, { default: rehypeStringify }] =
    await Promise.all([
      import('remark'),
      import('remark-gfm'),
      import('remark-math'),
      import('remark-rehype'),
      import('rehype-katex'),
      import('rehype-stringify'),
    ]);

  // Front matter is metadata, not content — never render it as text.
  const body = markdown.slice(frontmatterEnd(markdown));

  const file = await remark()
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex, { output: 'mathml' })
    .use(rehypeStringify)
    .process(body);
  return String(file);
}
