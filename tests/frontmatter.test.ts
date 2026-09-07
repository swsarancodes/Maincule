import { expect, test, describe, beforeAll } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import {
  detectFrontmatter,
  updateFrontmatterKey,
  frontmatterEnd,
} from '../src/core/markdown/frontmatter';
import { FrontmatterWidget } from '../src/editor/widgets/frontmatter';
import { buildBlockWidgets } from '../src/editor/widgets/plugin';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createMarkdownExtension } from '../src/core/markdown/grammar';

beforeAll(() => {
  const window = new GlobalWindow();
  (global as any).window = window;
  (global as any).document = window.document;
  (global as any).HTMLElement = window.HTMLElement;
  (global as any).MutationObserver = window.MutationObserver;
  (global as any).navigator = window.navigator;
  (global as any).Event = window.Event;
  (global as any).KeyboardEvent = window.KeyboardEvent;
  (global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
});

describe('Front-matter detection (B7)', () => {
  test('detects YAML with keys and offsets', () => {
    const text = '---\ntitle: Hello\ntags: a, b\n---\n\n# Body\n';
    const fm = detectFrontmatter(text)!;
    expect(fm).not.toBeNull();
    expect(fm.format).toBe('yaml');
    expect(fm.from).toBe(0);
    expect(text.slice(fm.to)).toBe('\n# Body\n');
    expect(fm.keys.map((k) => k.key)).toEqual(['title', 'tags']);
    expect(fm.keys[0].value).toBe('Hello');
  });

  test('detects TOML +++ blocks', () => {
    const text = '+++\ntitle = "Hi"\ndraft = false\n+++\n\nBody\n';
    const fm = detectFrontmatter(text)!;
    expect(fm.format).toBe('toml');
    expect(fm.keys.map((k) => k.key)).toEqual(['title', 'draft']);
    expect(fm.keys[0].value).toBe('Hi');
  });

  test('detects JSON blocks and validates syntax', () => {
    const text = '{\n"title": "Hi",\n"draft": false\n}\n\nBody\n';
    const fm = detectFrontmatter(text)!;
    expect(fm.format).toBe('json');
    expect(fm.keys.map((k) => k.key)).toEqual(['title', 'draft']);
    expect(fm.keys[0].value).toBe('Hi');
  });

  test('a body --- is never mistaken for front matter', () => {
    const text = '# Title\n\nSome text\n\n---\n\nMore\n';
    expect(detectFrontmatter(text)).toBeNull();
    expect(frontmatterEnd(text)).toBe(0);
  });

  test('unclosed and malformed blocks render as raw text (null)', () => {
    expect(detectFrontmatter('---\ntitle: x\n\nBody, no fence\n')).toBeNull();
    expect(detectFrontmatter('+++\ntitle = 1\n')).toBeNull();
    expect(detectFrontmatter('{\n"title": oops\n}\n')).toBeNull();
    expect(detectFrontmatter('')).toBeNull();
  });

  test('handles CRLF line endings', () => {
    const text = '---\r\ntitle: Hi\r\n---\r\n\r\nBody\r\n';
    const fm = detectFrontmatter(text)!;
    expect(fm.format).toBe('yaml');
    expect(fm.keys[0]).toMatchObject({ key: 'title', value: 'Hi' });
    expect(text.slice(fm.to)).toBe('\r\nBody\r\n');
  });
});

describe('Single-key editing preserves every other byte (B7)', () => {
  test('YAML edit keeps order, quotes, comments, and body intact', () => {
    const text = '---\ntitle: "Old" # keep me\ntags: a, b\n---\n\nBody --- here\n';
    const next = updateFrontmatterKey(text, 'title', 'New');
    expect(next).toBe('---\ntitle: "New" # keep me\ntags: a, b\n---\n\nBody --- here\n');
  });

  test('TOML edit preserves delimiter style', () => {
    const text = '+++\ntitle = "Old"\n+++\nBody\n';
    expect(updateFrontmatterKey(text, 'title', 'New')).toBe('+++\ntitle = "New"\n+++\nBody\n');
  });

  test('JSON edit re-stringifies the value', () => {
    const text = '{\n"title": "Old"\n}\nBody\n';
    expect(updateFrontmatterKey(text, 'title', 'New')).toBe('{\n"title": "New"\n}\nBody\n');
  });

  test('missing key or absent block returns text unchanged', () => {
    const text = '---\ntitle: x\n---\nBody\n';
    expect(updateFrontmatterKey(text, 'nope', 'v')).toBe(text);
    expect(updateFrontmatterKey('# Just a doc\n', 'title', 'v')).toBe('# Just a doc\n');
  });
});

describe('FrontmatterWidget + plugin wiring', () => {
  test('widget renders a panel with one input per scalar key', () => {
    const source = '---\ntitle: Hello\ndraft: false\n---';
    const widget = new FrontmatterWidget(source, 0, source.length);
    const state = EditorState.create({ doc: `${source}\n\nBody\n` });
    const view = new EditorView({ state });
    const dom = widget.toDOM(view);
    expect(dom.className).toContain('as-frontmatter');
    expect(dom.textContent).toContain('YAML');
    const inputs = dom.querySelectorAll('input');
    expect(inputs.length).toBe(2);
    expect((inputs[0] as HTMLInputElement).value).toBe('Hello');
    view.destroy();
  });

  test('plugin owns the leading range and skips inner Lezer nodes', () => {
    const doc = '---\ntitle: Hello\n---\n\n# Body\n';
    // Decoration-set level assertion via the builder directly:
    const probe = EditorState.create({ doc, extensions: [createMarkdownExtension()] });
    const set = buildBlockWidgets(probe);
    let sawFm = false;
    const iter = set.iter();
    while (iter.value) {
      const widget = (iter.value.spec as any)?.widget;
      if (widget instanceof FrontmatterWidget) {
        sawFm = true;
        expect(iter.from).toBe(0);
      }
      iter.next();
    }
    expect(sawFm).toBe(true);
  });

  test('committing an input dispatches a span-scoped change only', () => {
    const doc = '---\ntitle: Old\ntags: keep\n---\n\nBody\n';
    const state = EditorState.create({ doc, extensions: [createMarkdownExtension()] });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);
    const widget = new FrontmatterWidget(doc.slice(0, doc.indexOf('Body')), 0, doc.indexOf('Body'));
    const dom = widget.toDOM(view);
    document.body.appendChild(dom);
    const input = dom.querySelector('input') as HTMLInputElement;
    input.value = 'New';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(view.state.doc.toString()).toBe('---\ntitle: New\ntags: keep\n---\n\nBody\n');
    view.destroy();
    dom.remove();
  });
});
