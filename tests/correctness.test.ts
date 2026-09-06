import { expect, test, describe, beforeAll, beforeEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, redo, undoDepth } from '@codemirror/commands';
import { createEditorExtensions, reconfigureEditorMode } from '../src/editor/setup';
import { useWorkspaceStore, flushPendingAutoRename } from '../src/app/stores/workspace';
import { extractDocumentHeadings } from '../src/app/components/DocumentOutline';

beforeAll(() => {
  const window = new GlobalWindow();
  (global as any).window = window;
  (global as any).Window = window.constructor;
  (global as any).document = window.document;
  (global as any).HTMLElement = window.HTMLElement;
  (global as any).HTMLTextAreaElement = window.HTMLTextAreaElement;
  (global as any).MutationObserver = window.MutationObserver;
  (global as any).navigator = window.navigator;
  (global as any).Event = window.Event;
  (global as any).KeyboardEvent = window.KeyboardEvent;
  (global as any).MouseEvent = window.MouseEvent;
  (global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
});

beforeEach(() => {
  // Never let a debounced rename leak from one test into the next.
  flushPendingAutoRename();
});

describe('Live mode reconfiguration preserves editor state', () => {
  test('hybrid -> source -> hybrid keeps doc, selection, undo AND redo history', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = EditorState.create({
      doc: '# hello',
      extensions: createEditorExtensions({ mode: 'hybrid' }),
    });
    const view = new EditorView({ state, parent: container });

    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' }, selection: { anchor: 1 } });
    expect(view.state.doc.toString()).toBe('x# hello');
    expect(undoDepth(view.state)).toBe(1);

    // The old behavior destroyed the view here (undo gone). Reconfigure must not.
    reconfigureEditorMode(view, { mode: 'source' });
    expect(view.state.doc.toString()).toBe('x# hello');
    expect(view.state.selection.main.head).toBe(1);
    expect(undoDepth(view.state)).toBe(1);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('# hello');

    reconfigureEditorMode(view, { mode: 'hybrid', typewriterMode: true, focusMode: 'paragraph' });
    expect(view.state.doc.toString()).toBe('# hello');

    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('x# hello');

    reconfigureEditorMode(view, { mode: 'hybrid', typewriterMode: false, focusMode: 'off' });
    expect(view.state.doc.toString()).toBe('x# hello');
    view.destroy();
  });
});

describe('Debounced heading auto-rename', () => {
  test('tab label settles after a pause, not on every keystroke', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument();
    const docId = useWorkspaceStore.getState().activeDocumentId!;
    const initialName = useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.fileName;

    store.updateDocumentContent(docId, '# H');
    store.updateDocumentContent(docId, '# He');
    store.updateDocumentContent(docId, '# Hello World');
    // Still the old name: nothing renames mid-burst.
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.fileName).toBe(initialName);

    flushPendingAutoRename();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.fileName).toBe('Hello World.md');
  });

  test('never renames a doc the user explicitly named', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument();
    const docId = useWorkspaceStore.getState().activeDocumentId!;

    store.renameDocument(docId, 'CX Custom Name');
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.fileName).toBe('CX Custom Name.md');

    // Typing a different heading must not fight the explicit rename.
    store.updateDocumentContent(docId, '# A Totally Different Heading\n\nbody');
    flushPendingAutoRename();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.fileName).toBe('CX Custom Name.md');
  });

  test('dedupes against live docs and ignores trashed names', () => {
    const store = useWorkspaceStore.getState();

    store.createEmptyDocument();
    const firstId = useWorkspaceStore.getState().activeDocumentId!;
    store.updateDocumentContent(firstId, '# CX Dup Title');
    flushPendingAutoRename();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === firstId)!.meta.fileName).toBe('CX Dup Title.md');

    // Second doc with the same heading gets " - 2".
    store.createEmptyDocument();
    const secondId = useWorkspaceStore.getState().activeDocumentId!;
    store.updateDocumentContent(secondId, '# CX Dup Title');
    flushPendingAutoRename();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === secondId)!.meta.fileName).toBe('CX Dup Title - 2.md');

    // Trashing the original frees the name for a third doc.
    store.deleteDocument(firstId);
    store.createEmptyDocument();
    const thirdId = useWorkspaceStore.getState().activeDocumentId!;
    store.updateDocumentContent(thirdId, '# CX Dup Title');
    flushPendingAutoRename();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === thirdId)!.meta.fileName).toBe('CX Dup Title.md');
  });
});

describe('moveItem hierarchy guard', () => {
  test('rejects moving a folder under a document', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('CX Guard Folder');
    const folder = useWorkspaceStore.getState().folders.find((f) => f.name === 'CX Guard Folder')!;

    store.createEmptyDocument('CX Guard Doc.md');
    const docId = useWorkspaceStore.getState().activeDocumentId!;

    store.moveItem(folder.id, docId);
    expect(useWorkspaceStore.getState().folders.find((f) => f.id === folder.id)!.parentId).toBeNull();
  });

  test('still allows doc-as-subpage and folder-into-folder', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('CX Sub Parent.md');
    const parentId = useWorkspaceStore.getState().activeDocumentId!;
    store.createEmptyDocument('CX Sub Child.md');
    const childId = useWorkspaceStore.getState().activeDocumentId!;

    store.moveItem(childId, parentId);
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === childId)!.parentId).toBe(parentId);

    store.createFolder('CX Outer');
    const outer = useWorkspaceStore.getState().folders.find((f) => f.name === 'CX Outer')!;
    store.createFolder('CX Inner');
    const inner = useWorkspaceStore.getState().folders.find((f) => f.name === 'CX Inner')!;
    store.moveItem(inner.id, outer.id);
    expect(useWorkspaceStore.getState().folders.find((f) => f.id === inner.id)!.parentId).toBe(outer.id);
  });
});

describe('Outline extraction correctness', () => {
  test('computes exact pos under CRLF line endings', () => {
    const markdown = '# A\r\nbody\r\n## B\r\n';
    const headings = extractDocumentHeadings(markdown);
    expect(headings.length).toBe(2);
    expect(headings[1].text).toBe('B');
    expect(headings[1].line).toBe(3);
    // '# A' (3) + CRLF (2) + 'body' (4) + CRLF (2) = 11
    expect(headings[1].pos).toBe(11);
    expect(markdown.slice(headings[1].pos, headings[1].pos + 4)).toBe('## B');
  });

  test('skips tilde fences, frontmatter, and indented code', () => {
    const markdown = [
      '---',
      'title: ignored',
      '# not a heading, it is frontmatter',
      '---',
      '~~~',
      '# not a heading, it is fenced',
      '~~~',
      '    # not a heading, it is indented code',
      '# Real Heading',
    ].join('\n');

    const headings = extractDocumentHeadings(markdown);
    expect(headings.length).toBe(1);
    expect(headings[0].text).toBe('Real Heading');
    expect(headings[0].line).toBe(9);
  });
});
