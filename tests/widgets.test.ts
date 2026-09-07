import { expect, test, describe, beforeAll } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { TableWidget, parseMarkdownTable, serializeMarkdownTable } from '../src/editor/widgets/table';
import { MermaidWidget } from '../src/editor/widgets/mermaid';
import { CodeBlockWidget } from '../src/editor/widgets/code-block';
import { CalloutWidget } from '../src/editor/widgets/callout';
import { ImageWidget, parseImageMarkdown, serializeImageMarkdown } from '../src/editor/widgets/image';
import { blockWidgetField } from '../src/editor/widgets/plugin';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  wrapWithLink,
  removeLink,
  insertLinkTemplate,
  setTaskList,
  setBulletList,
  setNumberedList,
  setHeadingLevel,
  toggleTaskCompletion,
  markdownFormattingKeymap,
} from '../src/editor/commands/formatting';
import { findLinkUrlAt, imagePasteDropExtension } from '../src/editor/setup';
import { wikilinkPlugin } from '../src/editor/decorations/wikilink';
import { wikilinkCompletionSource } from '../src/editor/completions/wikilink-completion';
import { useWorkspaceStore } from '../src/app/stores/workspace';
import { codeFolding, foldCode, unfoldCode, foldable } from '@codemirror/language';
import { createMarkdownExtension } from '../src/core/markdown/grammar';
import { MathWidget, mathPlugin } from '../src/editor/decorations/math';

beforeAll(() => {
  const window = new GlobalWindow();
  (global as any).window = window;
  (global as any).document = window.document;
  (global as any).HTMLElement = window.HTMLElement;
  (global as any).HTMLTextAreaElement = window.HTMLTextAreaElement;
  (global as any).MutationObserver = window.MutationObserver;
  (global as any).navigator = window.navigator;
  (global as any).Event = window.Event;
  (global as any).KeyboardEvent = window.KeyboardEvent;
  (global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
});

describe('MermaidWidget In-Place Code Editing & Lifecycle', () => {
  test('Creates DOM and supports mode switching to Code and Split', () => {
    const source = '```mermaid\nflowchart TD\n  A --> B\n```';
    const widget = new MermaidWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    expect(dom).not.toBeNull();
    expect(dom.className).toContain('as-diagram-container');

    // Check toolbar mode buttons
    const modeBtns = dom.querySelectorAll('.as-widget-btn');
    const previewBtn = Array.from(modeBtns).find((b) => b.textContent === 'Preview') as HTMLElement;
    const splitBtn = Array.from(modeBtns).find((b) => b.textContent === 'Split') as HTMLElement;
    const codeBtn = Array.from(modeBtns).find((b) => b.textContent === 'Code') as HTMLElement;

    expect(previewBtn).toBeDefined();
    expect(splitBtn).toBeDefined();
    expect(codeBtn).toBeDefined();

    // Switch to Code mode
    codeBtn.click();
    expect(dom.dataset.mode).toBe('code');

    const textarea = dom.querySelector('.as-diagram-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('flowchart TD\n  A --> B');

    // Simulate typing in textarea
    textarea.value = 'flowchart TD\n  A --> B\n  B --> C';
    textarea.dispatchEvent(new Event('input'));

    // Test updateDOM preserves the DOM and mode
    const updatedSource = '```mermaid\nflowchart TD\n  A --> B\n  B --> C\n```';
    const nextWidget = new MermaidWidget(updatedSource, 0, updatedSource.length);
    const retained = nextWidget.updateDOM(dom, view);
    expect(retained).toBe(true);
    expect(dom.dataset.mode).toBe('code');

    // Switch to Split mode
    splitBtn.click();
    expect(dom.dataset.mode).toBe('split');
  });
});

describe('TableWidget In-Place Code & Visual Editing', () => {
  test('Supports Visual, Split, and Code modes with live synchronization', () => {
    const source = '| Col A | Col B |\n| :--- | ---: |\n| 1 | 2 |';
    const widget = new TableWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    expect(dom).not.toBeNull();
    expect(dom.className).toContain('as-table-container');

    // Check mode buttons
    const modeBtns = dom.querySelectorAll('.as-widget-btn');
    const visualBtn = Array.from(modeBtns).find((b) => b.textContent === 'Visual') as HTMLElement;
    const splitBtn = Array.from(modeBtns).find((b) => b.textContent === 'Split') as HTMLElement;
    const codeBtn = Array.from(modeBtns).find((b) => b.textContent === 'Code') as HTMLElement;

    expect(visualBtn).toBeDefined();
    expect(splitBtn).toBeDefined();
    expect(codeBtn).toBeDefined();

    // Visual mode initially has interactive cells
    const cells = dom.querySelectorAll('.as-table-cell-header, .as-table-cell-data');
    expect(cells.length).toBe(4); // 2 headers + 2 cells

    // Switch to Code mode
    codeBtn.click();
    expect(dom.dataset.mode).toBe('code');

    const textarea = dom.querySelector('.as-table-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toContain('| Col A | Col B |');

    // Edit raw markdown table code
    textarea.value = '| Col A | Col B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |';
    textarea.dispatchEvent(new Event('input'));

    // Switch to Split mode
    splitBtn.click();
    expect(dom.dataset.mode).toBe('split');

    // In Split mode, visual table has updated row count
    const updatedCells = dom.querySelectorAll('tbody td.as-table-cell-data');
    expect(updatedCells.length).toBe(4); // 2 rows of 2 cols = 4 cells

    // Verify updateDOM returns true
    const nextWidget = new TableWidget(textarea.value, 0, textarea.value.length);
    const retained = nextWidget.updateDOM(dom, view);
    expect(retained).toBe(true);
  });

  test('TableWidget operations: adding, removing, and modifying rows without duplicating or corrupting', () => {
    const initialSource = '| Item | Price |\n| :--- | ---: |\n| Apple | 10 |\n| Banana | 20 |\n| Cherry | 30 |';
    const state = EditorState.create({
      doc: initialSource,
      extensions: [createMarkdownExtension(), blockWidgetField],
    });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);

    const container = view.dom.querySelector('.as-table-container') as HTMLElement;
    expect(container).not.toBeNull();

    // 1. Verify initial rows count
    let rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(3);

    // 2. Click "- Row" to remove the bottom row (Cherry)
    const removeRowBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '- Row'
    ) as HTMLButtonElement;
    expect(removeRowBtn).toBeDefined();
    removeRowBtn.click();

    // CRITICAL: Doc must have 2 rows now, NOT duplicated or extra rows!
    const docAfterRemove = view.state.doc.toString();
    expect(docAfterRemove).toContain('Apple');
    expect(docAfterRemove).toContain('Banana');
    expect(docAfterRemove).not.toContain('Cherry');
    expect(docAfterRemove.split('\n').filter((l) => l.trim().length > 0).length).toBe(4); // Header, align, 2 rows

    rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(2);

    // 3. Click "+ Row" to add a new empty row
    const addRowBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '+ Row'
    ) as HTMLButtonElement;
    expect(addRowBtn).toBeDefined();
    addRowBtn.click();

    const docAfterAdd = view.state.doc.toString();
    expect(docAfterAdd.split('\n').filter((l) => l.trim().length > 0).length).toBe(5); // Header, align, 3 rows
    rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(3);

    // 4. Delete a specific row in the middle (Banana, index 1)
    const middleRow = rows[1];
    const delMiddleBtn = middleRow.querySelector('.as-table-row-action-del') as HTMLButtonElement;
    expect(delMiddleBtn).not.toBeNull();
    delMiddleBtn.click();

    const docAfterDelMiddle = view.state.doc.toString();
    expect(docAfterDelMiddle).not.toContain('Banana');
    expect(docAfterDelMiddle).toContain('Apple');
    rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(2);

    // 5. Insert row below the first row using row action (+)
    const firstRow = rows[0];
    const insertBelowBtn = firstRow.querySelector('.as-table-row-action-btn:not(.as-table-row-action-del)') as HTMLButtonElement;
    expect(insertBelowBtn).not.toBeNull();
    insertBelowBtn.click();

    rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(3);

    // 6. Modify a cell value and verify CodeMirror doc updates
    const firstCell = rows[0].querySelector('td.as-table-cell-data') as HTMLElement;
    firstCell.textContent = 'Honeycrisp Apple';
    firstCell.dispatchEvent(new Event('blur'));

    expect(view.state.doc.toString()).toContain('Honeycrisp Apple');

    // 7. Add Column (+ Col)
    const addColBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '+ Col'
    ) as HTMLButtonElement;
    expect(addColBtn).toBeDefined();
    addColBtn.click();

    expect(view.state.doc.toString()).toContain('Col 3');
    let headers = container.querySelectorAll('thead th.as-table-cell-header');
    expect(headers.length).toBe(3);

    // 8. Remove Column (- Col)
    const removeColBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '- Col'
    ) as HTMLButtonElement;
    expect(removeColBtn).toBeDefined();
    removeColBtn.click();

    expect(view.state.doc.toString()).not.toContain('Col 3');
    headers = container.querySelectorAll('thead th.as-table-cell-header');
    expect(headers.length).toBe(2);

    // Cleanup DOM
    document.body.removeChild(view.dom);
  });

  test('TableWidget Tab key at bottom-right preserves typed text and appends row', () => {
    const initialSource = '| A | B |\n| :--- | :--- |\n| One | Two |';
    const state = EditorState.create({
      doc: initialSource,
      extensions: [createMarkdownExtension(), blockWidgetField],
    });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);

    const container = view.dom.querySelector('.as-table-container') as HTMLElement;
    const lastCell = container.querySelector('tbody tr:last-child td.as-table-cell-data:nth-child(2)') as HTMLElement;
    expect(lastCell).not.toBeNull();

    // Type new text into the last cell
    lastCell.textContent = 'Two Updated';

    // Press Tab
    lastCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    // Doc must preserve 'Two Updated' and have an appended row
    const doc = view.state.doc.toString();
    expect(doc).toContain('Two Updated');
    const rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(2); // 1 original + 1 newly appended

    document.body.removeChild(view.dom);
  });

  test('TableWidget delete button removes entire table cleanly', () => {
    const doc = '# Top\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |\n\n# Bottom';
    const state = EditorState.create({
      doc,
      extensions: [createMarkdownExtension(), blockWidgetField],
    });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);

    const container = view.dom.querySelector('.as-table-container') as HTMLElement;
    const deleteBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Delete')
    ) as HTMLButtonElement;
    expect(deleteBtn).toBeDefined();

    deleteBtn.click();

    const afterDelete = view.state.doc.toString();
    expect(afterDelete).not.toContain('| X | Y |');
    expect(afterDelete).toContain('# Top');
    expect(afterDelete).toContain('# Bottom');

    document.body.removeChild(view.dom);
  });

  test('TableWidget supports removing down to 0 rows and adding a row back', () => {
    const singleRowSource = '| Col 1 | Col 2 |\n| :--- | :--- |\n| Val 1 | Val 2 |';
    const state = EditorState.create({
      doc: singleRowSource,
      extensions: [createMarkdownExtension(), blockWidgetField],
    });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);

    const container = view.dom.querySelector('.as-table-container') as HTMLElement;
    const removeRowBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '- Row'
    ) as HTMLButtonElement;

    // 1. Remove the single row
    removeRowBtn.click();

    // Markdown should still be valid table header without crashing
    const doc = view.state.doc.toString();
    expect(doc).toContain('| Col 1 | Col 2 |');
    expect(doc).not.toContain('Val 1');

    // Shows empty placeholder
    const emptyNotice = container.querySelector('.as-table-empty-td');
    expect(emptyNotice).not.toBeNull();
    expect(emptyNotice?.textContent).toContain('No rows yet');

    // 2. Add row back
    const addRowBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '+ Row'
    ) as HTMLButtonElement;
    addRowBtn.click();

    const rows = container.querySelectorAll('tbody tr:not(.as-table-empty-tr)');
    expect(rows.length).toBe(1);
    expect(view.state.doc.toString().split('\n').filter((l) => l.trim().length > 0).length).toBe(3);

    document.body.removeChild(view.dom);
  });

  test('TableWidget arrow navigation moves focus up and down between cells', () => {
    const source = '| Alpha | Beta |\n| :--- | :--- |\n| A1 | B1 |\n| A2 | B2 |';
    const state = EditorState.create({
      doc: source,
      extensions: [createMarkdownExtension(), blockWidgetField],
    });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);

    const container = view.dom.querySelector('.as-table-container') as HTMLElement;
    const thAlpha = container.querySelector('thead th.as-table-cell-header:nth-child(1)') as HTMLElement;
    const tdA1 = container.querySelector('tbody tr:nth-child(1) td.as-table-cell-data:nth-child(1)') as HTMLElement;
    const tdA2 = container.querySelector('tbody tr:nth-child(2) td.as-table-cell-data:nth-child(1)') as HTMLElement;

    // Header ArrowDown focuses A1
    thAlpha.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(tdA1);

    // Row 0 ArrowDown focuses A2
    tdA1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(tdA2);

    // Row 1 ArrowUp focuses A1
    tdA2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(tdA1);

    // Row 0 ArrowUp focuses thAlpha
    tdA1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(thAlpha);

    document.body.removeChild(view.dom);
  });
});

describe('CodeBlockWidget and CalloutWidget In-Place Editing', () => {
  test('CodeBlockWidget toggles Edit and Done with textarea', () => {
    const source = '```python\nprint("hello")\n```';
    const widget = new CodeBlockWidget(source, 0, source.length, 'python');

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    const editBtn = Array.from(dom.querySelectorAll('button')).find((b) => b.textContent === 'Edit') as HTMLElement;
    expect(editBtn).toBeDefined();

    // Click Edit
    editBtn.click();
    const textarea = dom.querySelector('.as-codeblock-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.style.display).toBe('block');
    expect(textarea.value).toBe('print("hello")');

    // updateDOM returns true
    const nextWidget = new CodeBlockWidget(source, 0, source.length, 'python');
    expect(nextWidget.updateDOM(dom, view)).toBe(true);
  });

  test('CalloutWidget has editable title and body and updateDOM returns true', () => {
    const source = '> [!NOTE] Important Notice\n> Please read this carefully.';
    const widget = new CalloutWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    const titleEl = dom.querySelector('.as-callout-title') as HTMLElement;
    const bodyEl = dom.querySelector('.as-callout-body') as HTMLElement;

    expect(titleEl).not.toBeNull();
    expect(titleEl.contentEditable).toBe('true');
    expect(titleEl.textContent).toBe('Important Notice');

    expect(bodyEl).not.toBeNull();
    expect(bodyEl.contentEditable).toBe('true');
    expect(bodyEl.textContent).toBe('Please read this carefully.');

    const nextWidget = new CalloutWidget(source, 0, source.length);
    expect(nextWidget.updateDOM(dom, view)).toBe(true);
  });

  test('CalloutWidget has action bar with direct Delete, Turn to Text, and Type Switcher', () => {
    const source = '> This is an inspiring quote';
    const widget = new CalloutWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    const actionBar = dom.querySelector('.as-callout-actions');
    expect(actionBar).not.toBeNull();

    // Direct Delete button (no dropdown)
    const deleteBtn = dom.querySelector('.as-callout-delete-btn') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn.textContent).toBe('Delete');

    const unquoteBtn = Array.from(dom.querySelectorAll('.as-callout-btn')).find(
      (b) => b.textContent?.includes('Turn to Text')
    ) as HTMLButtonElement;
    expect(unquoteBtn).not.toBeNull();

    // Type switcher menu still opens via icon click
    const typeMenu = dom.querySelector('.as-callout-type-menu') as HTMLElement;
    expect(typeMenu).not.toBeNull();

    // 1. Test direct Delete action
    deleteBtn.click();
    expect(view.state.doc.toString()).toBe('');

    view.destroy();
  });

  test('CalloutWidget Turn to Text converts blockquote back into plain text', () => {
    const source = '> First line of quote\n> Second line';
    const widget = new CalloutWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    const unquoteBtn = Array.from(dom.querySelectorAll('.as-callout-btn')).find(
      (b) => b.textContent?.includes('Turn to Text')
    ) as HTMLButtonElement;
    expect(unquoteBtn).not.toBeNull();

    unquoteBtn.click();
    expect(view.state.doc.toString()).toBe('First line of quote\nSecond line');

    view.destroy();
  });

  test('CalloutWidget Backspace on empty body deletes quote completely', () => {
    const source = '> ';
    const widget = new CalloutWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    const bodyEl = dom.querySelector('.as-callout-body') as HTMLElement;
    expect(bodyEl).not.toBeNull();

    // Body is empty -> press Backspace
    bodyEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(view.state.doc.toString()).toBe('');

    view.destroy();
  });
});

describe('Link Attachment Commands & Normalization', () => {
  test('wrapWithLink wraps selected text with normalized URL', () => {
    const doc = 'Check out Google for info';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(10, 16), // "Google"
    });
    const view = new EditorView({ state });

    wrapWithLink(view, 'google.com');
    expect(view.state.doc.toString()).toBe('Check out [Google](https://google.com) for info');
  });

  test('wrapWithLink updates existing markdown link URL', () => {
    const doc = 'Check out [Google](https://yahoo.com) for info';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(10, 37), // "[Google](https://yahoo.com)"
    });
    const view = new EditorView({ state });

    wrapWithLink(view, 'https://google.com');
    expect(view.state.doc.toString()).toBe('Check out [Google](https://google.com) for info');
  });

  test('removeLink converts [text](url) back to plain text', () => {
    const doc = 'Check out [Google](https://google.com) for info';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(10, 38), // "[Google](https://google.com)"
    });
    const view = new EditorView({ state });

    removeLink(view);
    expect(view.state.doc.toString()).toBe('Check out Google for info');
  });

  test('insertLinkTemplate inserts template and focuses URL', () => {
    const doc = 'Hello ';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(6, 6),
    });
    const view = new EditorView({ state });

    insertLinkTemplate(view);
    expect(view.state.doc.toString()).toBe('Hello [link](https://)');
  });

  test('findLinkUrlAt extracts link URL from document position', () => {
    const doc = 'Check out [Google](https://google.com) today';
    const state = EditorState.create({ doc });
    const view = new EditorView({ state });

    const url = findLinkUrlAt(view, 15);
    expect(url).toBe('https://google.com');

    const notFound = findLinkUrlAt(view, 2);
    expect(notFound).toBeNull();
  });
});

describe('ImageWidget & Image Paste Support', () => {
  test('parseImageMarkdown extracts alt and url accurately', () => {
    const parsed1 = parseImageMarkdown('![Screenshot](https://example.com/pic.png)');
    expect(parsed1).not.toBeNull();
    expect(parsed1?.alt).toBe('Screenshot');
    expect(parsed1?.url).toBe('https://example.com/pic.png');

    const parsed2 = parseImageMarkdown('![Diagram](data:image/png;base64,iVBORw0KGgo "My Title")');
    expect(parsed2).not.toBeNull();
    expect(parsed2?.alt).toBe('Diagram');
    expect(parsed2?.url).toBe('data:image/png;base64,iVBORw0KGgo');
    expect(parsed2?.title).toBe('My Title');

    const invalid = parseImageMarkdown('not an image markdown');
    expect(invalid).toBeNull();
  });

  test('serializeImageMarkdown formats image markdown correctly', () => {
    expect(serializeImageMarkdown('Architecture', 'https://example.com/arch.svg')).toBe(
      '![Architecture](https://example.com/arch.svg)'
    );
    expect(serializeImageMarkdown('Flow', 'https://example.com/flow.png', 'Flowchart')).toBe(
      '![Flow](https://example.com/flow.png "Flowchart")'
    );
  });

  test('ImageWidget creates DOM element with img, caption, and hover actions', () => {
    const source = '![Banner](https://example.com/banner.png)';
    const widget = new ImageWidget(source, 0, source.length);

    const state = EditorState.create({ doc: source });
    const view = new EditorView({ state });

    const dom = widget.toDOM(view);
    expect(dom).not.toBeNull();
    expect(dom.className).toBe('as-image-widget');

    const img = dom.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toBe('https://example.com/banner.png');
    expect(img?.alt).toBe('Banner');

    const caption = dom.querySelector('.as-image-caption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe('Banner');

    // Check action buttons exist
    const actionBar = dom.querySelector('.as-image-actions');
    expect(actionBar).not.toBeNull();
    const buttons = actionBar?.querySelectorAll('button');
    expect(buttons?.length).toBe(3); // Copy URL, Edit, Delete

    // Test updateDOM preserves node
    expect(widget.updateDOM(dom)).toBe(true);
  });

  test('imagePasteDropExtension registers without errors', () => {
    const ext = imagePasteDropExtension();
    expect(ext).toBeDefined();

    const state = EditorState.create({
      doc: 'Start\n\nEnd',
      extensions: [ext],
    });
    const view = new EditorView({ state });
    expect(view).toBeDefined();
  });
});

describe('Task List & Empty Line List Formatting', () => {
  test('setTaskList on empty line creates empty todo item with cursor at end', () => {
    const state = EditorState.create({ doc: '' });
    const view = new EditorView({ state });

    setTaskList(view);
    expect(view.state.doc.toString()).toBe('- [ ] ');
    expect(view.state.selection.main.anchor).toBe(6);
  });

  test('setBulletList and setNumberedList on empty line create list items with cursor at end', () => {
    const state1 = EditorState.create({ doc: '' });
    const view1 = new EditorView({ state1 });
    setBulletList(view1);
    expect(view1.state.doc.toString()).toBe('- ');
    expect(view1.state.selection.main.anchor).toBe(2);

    const state2 = EditorState.create({ doc: '' });
    const view2 = new EditorView({ state2 });
    setNumberedList(view2);
    expect(view2.state.doc.toString()).toBe('1. ');
    expect(view2.state.selection.main.anchor).toBe(3);
  });

  test('setHeadingLevel on empty line inserts heading prefix with cursor at end', () => {
    const state = EditorState.create({ doc: '' });
    const view = new EditorView({ state });

    setHeadingLevel(view, 2);
    expect(view.state.doc.toString()).toBe('## ');
    expect(view.state.selection.main.anchor).toBe(3);
  });

  test('Enter on task item continues list; Enter on empty task item exits list', () => {
    const enterCmd = markdownFormattingKeymap.find((k) => k.key === 'Enter');
    expect(enterCmd).toBeDefined();

    // 1. Enter on non-empty task item continues
    const state1 = EditorState.create({ doc: '- [ ] Buy milk' });
    const view1 = new EditorView({ state: state1 });
    view1.dispatch({ selection: { anchor: 14, head: 14 } });
    enterCmd?.run(view1);
    expect(view1.state.doc.toString()).toBe('- [ ] Buy milk\n- [ ] ');

    // 2. Enter on empty task item exits
    const state2 = EditorState.create({ doc: '- [ ] ' });
    const view2 = new EditorView({ state: state2 });
    view2.dispatch({ selection: { anchor: 6, head: 6 } });
    enterCmd?.run(view2);
    expect(view2.state.doc.toString()).toBe('');
  });

  test('Backspace on empty task item clears it', () => {
    const backspaceCmd = markdownFormattingKeymap.find((k) => k.key === 'Backspace');
    expect(backspaceCmd).toBeDefined();

    const state = EditorState.create({ doc: '- [ ] ' });
    const view = new EditorView({ state });
    view.dispatch({ selection: { anchor: 6, head: 6 } });
    backspaceCmd?.run(view);
    expect(view.state.doc.toString()).toBe('');
  });

  test('toggleTaskCompletion toggles checked state and upgrades bullet items', () => {
    // 1. Toggle unchecked to checked
    const state1 = EditorState.create({ doc: '- [ ] Read documentation' });
    const view1 = new EditorView({ state: state1 });
    view1.dispatch({ selection: { anchor: 10, head: 10 } });
    const toggled1 = toggleTaskCompletion(view1);
    expect(toggled1).toBe(true);
    expect(view1.state.doc.toString()).toBe('- [x] Read documentation');

    // 2. Toggle checked back to unchecked
    const toggled2 = toggleTaskCompletion(view1);
    expect(toggled2).toBe(true);
    expect(view1.state.doc.toString()).toBe('- [ ] Read documentation');

    // 3. Upgrades bullet list item to task item
    const state3 = EditorState.create({ doc: '- Plain bullet note' });
    const view3 = new EditorView({ state: state3 });
    view3.dispatch({ selection: { anchor: 5, head: 5 } });
    const toggled3 = toggleTaskCompletion(view3);
    expect(toggled3).toBe(true);
    expect(view3.state.doc.toString()).toBe('- [ ] Plain bullet note');

    // 4. Mod-Enter keybinding triggers toggle
    const modEnter = markdownFormattingKeymap.find((k) => k.key === 'Mod-Enter');
    expect(modEnter).toBeDefined();
    modEnter?.run(view3);
    expect(view3.state.doc.toString()).toBe('- [x] Plain bullet note');
  });
});

describe('Wikilinks & Note Auto-Complete', () => {
  test('wikilinkPlugin creates WikilinkWidget when cursor is outside target range', () => {
    const doc = 'Check out [[Architecture]] for design notes.';
    const state = EditorState.create({
      doc,
      extensions: [wikilinkPlugin],
    });
    const view = new EditorView({ state });
    // Position cursor at end of doc, away from [[Architecture]]
    view.dispatch({ selection: { anchor: doc.length, head: doc.length } });

    const plugin = view.plugin(wikilinkPlugin as any);
    expect(plugin).toBeDefined();
    expect(plugin.decorations.size).toBe(1);

    let hasWidget = false;
    plugin.decorations.between(0, doc.length, (_from: number, _to: number, deco: any) => {
      if (deco.spec.widget) {
        hasWidget = true;
        expect(deco.spec.widget.target).toBe('Architecture');
        const dom = deco.spec.widget.toDOM();
        expect(dom.className).toBe('as-wikilink-pill');
        expect(dom.textContent).toContain('Architecture');
      }
    });
    expect(hasWidget).toBe(true);
  });

  test('wikilinkCompletionSource provides note title completions when typing [[', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('System Design.md', null);

    const text = 'Here is [[Sys';
    const state = EditorState.create({ doc: text });
    const view = new EditorView({ state });

    const mockContext: any = {
      state,
      pos: text.length,
      matchBefore: (regex: RegExp) => {
        const match = regex.exec(text);
        if (!match) return null;
        return { from: match.index, to: text.length, text: match[0] };
      },
    };

    const result = wikilinkCompletionSource(mockContext);
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
    const hasSysDesign = result!.options.some((o: any) => o.label === 'System Design');
    expect(hasSysDesign).toBe(true);
  });
});

describe('Foldable Headings & Section Folding', () => {
  test('Markdown headings are recognized as foldable ranges', () => {
    const markdown = `# Architecture Overview
Here is the first section paragraph with details.
More details.

## Database Layer
PostgreSQL specifications.`;

    const state = EditorState.create({
      doc: markdown,
      extensions: [createMarkdownExtension(), codeFolding()],
    });
    const view = new EditorView({ state });

    const line1 = view.state.doc.line(1);
    const foldRange = foldable(view.state, line1.from, line1.to);
    expect(foldRange).not.toBeNull();
    expect(foldRange!.from).toBe(line1.to);

    // Can fold and unfold the view
    const folded = foldCode(view);
    expect(typeof folded).toBe('boolean');
    const unfolded = unfoldCode(view);
    expect(typeof unfolded).toBe('boolean');
  });
});

describe('KaTeX Math Formula Rendering', () => {  test('MathWidget renders inline math with KaTeX markup', () => {
    const widget = new MathWidget('E = mc^2', false);
    const mockView = {} as any;
    const dom = widget.toDOM(mockView);

    expect(dom.tagName.toLowerCase()).toBe('span');
    expect(dom.className).toBe('as-math-inline');
    expect(dom.innerHTML).toContain('katex');
  });

  test('MathWidget renders block math with display mode', () => {
    const widget = new MathWidget('\\sum_{i=1}^n i = \\frac{n(n+1)}{2}', true);
    const mockView = {} as any;
    const dom = widget.toDOM(mockView);

    expect(dom.tagName.toLowerCase()).toBe('div');
    expect(dom.className).toBe('as-math-block');
    expect(dom.innerHTML).toContain('katex');
  });

  test('mathPlugin decorates math when cursor is outside and unwraps when cursor is inside', () => {
    const text = 'Formula is $a^2 + b^2 = c^2$ in geometry.';
    // Cursor at end of doc (pos: text.length)
    const state = EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [mathPlugin],
    });
    const view = new EditorView({ state });

    const pluginInstance = view.plugin(mathPlugin as any);
    expect(pluginInstance).toBeDefined();
    expect(pluginInstance!.decorations.size).toBe(1);

    // Now move cursor inside formula (pos: 15)
    view.dispatch({ selection: { anchor: 15 } });
    const updatedInstance = view.plugin(mathPlugin as any);
    expect(updatedInstance!.decorations.size).toBe(0); // unwrapped for editing!
  });
});


describe('Shared Block Menu (Move up / Move down / Delete)', () => {
  test('computeDelete removes block plus one adjacent newline', async () => {
    const { computeDelete } = await import('../src/editor/widgets/block-actions');
    const doc = '# Top\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |\n\n# Bottom';
    const from = doc.indexOf('| X');
    const to = doc.indexOf('# Bottom') - 2;
    const { newDoc, anchor } = computeDelete(doc, from, to);
    expect(newDoc).not.toContain('| X | Y |');
    expect(newDoc).toContain('# Top');
    expect(newDoc).toContain('# Bottom');
    expect(anchor).toBe(from);
  });

  test('computeMoveUp swaps block with previous paragraph', async () => {
    const { computeMoveUp } = await import('../src/editor/widgets/block-actions');
    const doc = '# Top\n\nBBB\n\nCCC\n\n# Bottom';
    const from = doc.indexOf('CCC');
    const res = computeMoveUp(doc, from, from + 3);
    expect(res).not.toBeNull();
    expect(res!.newDoc).toBe('# Top\n\nCCC\n\nBBB\n\n# Bottom');
    expect(res!.anchor).toBe(doc.indexOf('BBB'));
  });

  test('computeMoveUp returns null for first block / after frontmatter', async () => {
    const { computeMoveUp } = await import('../src/editor/widgets/block-actions');
    expect(computeMoveUp('AAA\n\nBBB', 0, 3)).toBeNull();
    const fm = '---\ntitle: Hi\n---\n\nAAA\n\nBBB';
    const aFrom = fm.indexOf('AAA');
    expect(computeMoveUp(fm, aFrom, aFrom + 3)).toBeNull();
  });

  test('computeMoveDown swaps block with next paragraph', async () => {
    const { computeMoveDown } = await import('../src/editor/widgets/block-actions');
    const doc = '# Top\n\nBBB\n\nCCC\n\n# Bottom';
    const from = doc.indexOf('BBB');
    const res = computeMoveDown(doc, from, from + 3);
    expect(res).not.toBeNull();
    expect(res!.newDoc).toBe('# Top\n\nCCC\n\nBBB\n\n# Bottom');
  });

  test('computeMoveDown returns null for last block', async () => {
    const { computeMoveDown } = await import('../src/editor/widgets/block-actions');
    const doc = 'AAA\n\nBBB';
    const from = doc.indexOf('BBB');
    expect(computeMoveDown(doc, from, from + 3)).toBeNull();
  });

  test('Every block widget exposes a Move/Delete dropdown menu', async () => {
    const { createMarkdownExtension } = await import('../src/core/markdown/grammar');
    const { blockWidgetField } = await import('../src/editor/widgets/plugin');
    const doc = [
      '> [!NOTE] Hello',
      '> body text',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '```python',
      'print("hi")',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '![Alt](https://example.com/x.png)',
      '',
      '---',
      '',
      'tail',
    ].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [createMarkdownExtension(), blockWidgetField],
    });
    const view = new EditorView({ state });
    document.body.appendChild(view.dom);

    // Callout shows a direct Delete button; diagram, code, table use dropdown menus
    expect(view.dom.querySelector('.as-callout .as-callout-delete-btn')).not.toBeNull();
    expect(view.dom.querySelector('.as-diagram-container .as-block-menu')).not.toBeNull();
    expect(view.dom.querySelector('.as-codeblock-container .as-block-menu')).not.toBeNull();
    expect(view.dom.querySelector('.as-table-container .as-block-menu')).not.toBeNull();

    // Move a table up via its menu and verify doc order changed
    const tableMenu = view.dom.querySelector('.as-table-container .as-block-menu') as HTMLElement;
    const moveUpBtn = Array.from(tableMenu.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Move up')
    ) as HTMLButtonElement;
    expect(moveUpBtn).toBeDefined();
    moveUpBtn.click();
    const after = view.state.doc.toString();
    expect(after.indexOf('| A | B |')).toBeLessThan(after.indexOf('print("hi")'));

    document.body.removeChild(view.dom);
  });
});
