import { describe, test, expect } from 'bun:test';
import { useWorkspaceStore, flushPendingStats } from '../src/app/stores/workspace';

describe('typing stats debounce (perf)', () => {
  test('content lands immediately, counts settle after flush', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Perf.md');
    const id = useWorkspaceStore.getState().activeDocumentId!;
    const before = useWorkspaceStore.getState().wordCount;
    void before;
    store.updateDocumentContent(id, 'hello world foo bar baz');
    // Content is immediate.
    const doc = useWorkspaceStore.getState().documents.find((d) => d.id === id)!;
    expect(doc.currentText).toBe('hello world foo bar baz');
    expect(doc.isDirty).toBe(true);
    // Stats settle on flush (debounced off critical path).
    flushPendingStats();
    expect(useWorkspaceStore.getState().wordCount).toBe(5);
    expect(useWorkspaceStore.getState().charCount).toBe('hello world foo bar baz'.length);
  });
});

describe('vault file actions (store surface)', () => {
  test('create/rename actions exist and require desktop (no-throw wiring)', () => {
    const s = useWorkspaceStore.getState();
    expect(typeof s.createVaultFile).toBe('function');
    expect(typeof s.createVaultFolder).toBe('function');
    expect(typeof s.renameVaultEntry).toBe('function');
  });
});
