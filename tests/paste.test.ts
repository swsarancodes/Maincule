import { expect, test, describe } from 'bun:test';
import { htmlToMarkdown, isImageUrl, isPlainUrl } from '../src/core/markdown/paste';

describe('paste url helpers', () => {
  test('detects remote + data image urls', () => {
    expect(isImageUrl('https://example.com/pic.png')).toBe(true);
    expect(isImageUrl('https://example.com/a.jpg?x=1')).toBe(true);
    expect(isImageUrl('data:image/png;base64,iVBORw0=')).toBe(true);
    expect(isImageUrl('https://example.com/page')).toBe(false);
    expect(isImageUrl('not a url')).toBe(false);
  });
  test('detects plain urls', () => {
    expect(isPlainUrl('https://example.com/x')).toBe(true);
    expect(isPlainUrl('mailto:a@b.com')).toBe(true);
    expect(isPlainUrl('just text')).toBe(false);
  });
});

describe('htmlToMarkdown', () => {
  test('headings, bold, italic, strike', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
    expect(htmlToMarkdown('<p><strong>b</strong> and <em>i</em> and <del>s</del></p>')).toBe(
      '**b** and *i* and ~~s~~'
    );
  });
  test('links and images', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com">hi</a></p>')).toBe('[hi](https://x.com)');
    expect(htmlToMarkdown('<p><img src="https://x.com/a.png" alt="pic"></p>')).toBe(
      '![](https://x.com/a.png)'.replace('![]', '![pic]')
    );
  });
  test('code blocks keep language', () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(md).toBe('```ts\nconst x = 1;\n```');
  });
  test('lists incl. task items and nesting', () => {
    const md = htmlToMarkdown('<ul><li><input type="checkbox" checked> done</li><li>next</li></ul>');
    expect(md).toContain('- [x] done');
    expect(md).toContain('- next');
    const nested = htmlToMarkdown('<ul><li>parent<ul><li>child</li></ul></li></ul>');
    expect(nested).toContain('- parent');
    expect(nested).toContain('child');
  });
  test('tables become GFM with escaped pipes', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>a</th><th>b</th></tr><tr><td>x|y</td><td>z</td></tr></table>'
    );
    expect(md).toContain('| a | b |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('x\\|y');
  });
  test('blockquote, hr, paragraphs', () => {
    expect(htmlToMarkdown('<blockquote><p>q</p></blockquote>')).toBe('> q');
    expect(htmlToMarkdown('<hr>')).toBe('---');
    expect(htmlToMarkdown('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
  });
  test('strips script/style, never emits live html, never throws', () => {
    expect(htmlToMarkdown('<script>alert(1)</script><p>ok</p>')).toBe('ok');
    expect(htmlToMarkdown('<div><unknown-tag>keep me</unknown-tag></div>')).toBe('keep me');
    expect(htmlToMarkdown('plain text')).toBe('');
    expect(htmlToMarkdown('')).toBe('');
  });
});
