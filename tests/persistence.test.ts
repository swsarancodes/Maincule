import { expect, test, describe, beforeAll, beforeEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import {
  buildVaultTree,
  imageExtFor,
  assetRelFor,
  assetAbsPath,
  resolveImageSrc,
  hasDiskHash,
  saveDocToDisk,
  storeImageBytes,
  dataUrlToAsset,
  type VaultEntry,
} from '../src/ipc/vault';
import { useWorkspaceStore, flushPendingSaves, flushPendingAutoRename } from '../src/app/stores/workspace';

beforeAll(() => {
  const window = new GlobalWindow();
  (global as any).window = window;
  (global as any).document = window.document;
});

beforeEach(() => {
  flushPendingAutoRename();
});

describe('Vault tree builder', () => {
  const entries: VaultEntry[] = [
    { path: '/v/root.md', rel: 'root.md', name: 'root.md', kind: 'file' },
    { path: '/v/notes', rel: 'notes', name: 'notes', kind: 'dir' },
    { path: '/v/notes/a.md', rel: 'notes/a.md', name: 'a.md', kind: 'file' },
    { path: '/v/notes/sub', rel: 'notes/sub', name: 'sub', kind: 'dir' },
    { path: '/v/notes/sub/b.md', rel: 'notes/sub/b.md', name: 'b.md', kind: 'file' },
  ];

  test('nests files under their scanned directories', () => {
    const tree = buildVaultTree(entries);
    expect(tree.length).toBe(2);

    const notes = tree.find((n) => n.rel === 'notes')!;
    expect(notes.kind).toBe('dir');
    expect(notes.depth).toBe(0);
    expect(notes.children.map((c) => c.rel).sort()).toEqual(['notes/a.md', 'notes/sub']);

    const sub = notes.children.find((c) => c.rel === 'notes/sub')!;
    expect(sub.children.length).toBe(1);
    expect(sub.children[0].rel).toBe('notes/sub/b.md');
    expect(sub.children[0].depth).toBe(2);
  });

  test('keeps root files at depth 0 with absolute paths', () => {
    const tree = buildVaultTree(entries);
    const root = tree.find((n) => n.rel === 'root.md')!;
    expect(root.kind).toBe('file');
    expect(root.depth).toBe(0);
    expect(root.path).toBe('/v/root.md');
  });

  test('empty scan builds an empty tree', () => {
    expect(buildVaultTree([])).toEqual([]);
  });
});

describe('Asset helpers', () => {
  test('imageExtFor prefers MIME, then filename, then png', () => {
    expect(imageExtFor('image/png', 'photo.jpg')).toBe('png');
    expect(imageExtFor('image/jpeg', 'photo')).toBe('jpg');
    expect(imageExtFor('image/svg+xml', 'x')).toBe('svg');
    expect(imageExtFor('', 'shot.WEBP')).toBe('webp');
    expect(imageExtFor('application/octet-stream', 'noext')).toBe('png');
  });

  test('assetRelFor yields a unique sanitized .assets path', () => {
    const rel = assetRelFor('My Meeting Notes.md', 'png');
    expect(rel).toMatch(/^\.assets\/My-Meeting-Notes-[0-9a-f]{6}\.png$/);
    expect(assetRelFor('My Meeting Notes.md', 'png')).not.toBe(rel);
    expect(assetRelFor('!!!.md', 'jpg')).toMatch(/^\.assets\/note-[0-9a-f]{6}\.jpg$/);
  });

  test('assetAbsPath tolerates trailing slashes on the root', () => {
    expect(assetAbsPath('/v', '.assets/a.png')).toBe('/v/.assets/a.png');
    expect(assetAbsPath('/v/', '.assets/a.png')).toBe('/v/.assets/a.png');
  });

  test('resolveImageSrc passes everything through outside Tauri', () => {
    expect(resolveImageSrc('.assets/a.png', '/v/note.md', '/v')).toBe('.assets/a.png');
    expect(resolveImageSrc('/abs/path.png', '/v/note.md', '/v')).toBe('/abs/path.png');
    expect(resolveImageSrc('https://example.com/x.png', '/v/note.md', '/v')).toBe('https://example.com/x.png');
    expect(resolveImageSrc('data:image/png;base64,AAA', null, null)).toBe('data:image/png;base64,AAA');
  });
});

describe('Disk guards (browser build)', () => {
  test('hasDiskHash only accepts Rust-issued SHA-256 hex', () => {
    expect(hasDiskHash('a'.repeat(64))).toBe(true);
    expect(hasDiskHash('abc123')).toBe(false);
    expect(hasDiskHash(undefined)).toBe(false);
    expect(hasDiskHash(null)).toBe(false);
    expect(hasDiskHash('')).toBe(false);
  });

  test('disk writes refuse to run outside the desktop shell', async () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('CX Disk Doc.md');
    const docId = useWorkspaceStore.getState().activeDocumentId!;
    const doc = useWorkspaceStore.getState().documents.find((d) => d.id === docId)!;

    await expect(saveDocToDisk(doc)).rejects.toThrow('desktop shell');
    await expect(storeImageBytes(new Uint8Array([1, 2, 3]), 'png', 'CX Disk Doc.md', null)).rejects.toThrow();
    expect(await dataUrlToAsset('data:image/png;base64,AAA=', 'CX Disk Doc.md', null)).toBeNull();

    // Autosave silently no-ops in the browser: no timer, no crash, no rename of flow.
    store.updateDocumentContent(docId, '# CX Disk Doc\n\nbody');
    await flushPendingSaves();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.filePath).toBeNull();
  });
});
