import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeFileAtomic, isTauriEnvironment } from './client';
import { serializeDocument } from '../core/document/serialize';
import type { DocumentState } from '../core/document/document';

/**
 * Thrown when the file on disk changed since we last read/wrote it.
 * The frontend turns this into a conflict banner (B3) instead of
 * silently overwriting the external edit.
 */
export class VaultConflictError extends Error {
  readonly docId: string;
  constructor(docId: string) {
    super('Conflict: file on disk was modified externally');
    this.name = 'VaultConflictError';
    this.docId = docId;
  }
}

/**
 * The Rust side compares SHA-256 hex digests. Legacy docs persisted before
 * disk wiring carry a short non-crypto hash in meta.hash — sending that as
 * expected_hash would false-conflict every first save, so the guard is only
 * attached when we actually hold a Rust-issued digest.
 */
export function hasDiskHash(hash: string | undefined | null): hash is string {
  return !!hash && /^[0-9a-f]{64}$/.test(hash);
}

export interface DiskSaveResult {
  hash: string;
  mtime: number;
  savedText: string;
}

/**
 * Serialize + atomically write a doc to its filePath.
 * Returns the exact text that hit disk (for dirty tracking) plus the new
 * Rust-issued hash/mtime. Outside the Tauri shell this always throws — the
 * browser build keeps the localStorage model.
 */
export async function saveDocToDisk(doc: DocumentState): Promise<DiskSaveResult> {
  if (!isTauriEnvironment()) {
    throw new Error('Disk saving is only available in the desktop shell.');
  }
  const filePath = doc.meta.filePath;
  if (!filePath) {
    throw new Error('Cannot save: document has no file path yet.');
  }
  const savedText = serializeDocument(doc.currentText, doc.meta);
  try {
    const res = await writeFileAtomic(
      filePath,
      savedText,
      hasDiskHash(doc.meta.hash) ? doc.meta.hash : undefined
    );
    return { hash: res.hash, mtime: res.mtime, savedText };
  } catch (e) {
    if (/conflict/i.test(String(e))) {
      throw new VaultConflictError(doc.id);
    }
    throw e;
  }
}

/**
 * Force-write a doc, skipping the optimistic-concurrency guard. Used for
 * "Keep mine" conflict resolution and for saving back a file deleted on disk.
 */
export async function forceSaveDocToDisk(doc: DocumentState): Promise<DiskSaveResult> {
  if (!isTauriEnvironment()) {
    throw new Error('Disk saving is only available in the desktop shell.');
  }
  const filePath = doc.meta.filePath;
  if (!filePath) {
    throw new Error('Cannot save: document has no file path yet.');
  }
  const savedText = serializeDocument(doc.currentText, doc.meta);
  const res = await writeFileAtomic(filePath, savedText);
  return { hash: res.hash, mtime: res.mtime, savedText };
}

// ---------------------------------------------------------------------------
// Folder vault: open / scan
// ---------------------------------------------------------------------------

export type VaultEntryKind = 'file' | 'dir';

export interface VaultEntry {
  /** Absolute path on disk. */
  path: string;
  /** Vault-relative path with `/` separators (stable tree key). */
  rel: string;
  /** File or directory name. */
  name: string;
  kind: VaultEntryKind;
}

/**
 * Native open-folder dialog. Returns the picked directory or null when the
 * user cancels. Desktop only.
 */
export async function openVaultDialog(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  const picked = await openDialog({ directory: true, multiple: false });
  return typeof picked === 'string' ? picked : null;
}

/** Register the picked folder as the vault root (canonicalized by Rust). */
export async function setVaultRoot(path: string): Promise<string> {
  return invoke<string>('set_vault_root', { path });
}

/** Recursive scan of the vault root: markdown files + their directories. */
export async function listVaultFiles(): Promise<VaultEntry[]> {
  return invoke<VaultEntry[]>('read_vault_dir');
}

/**
 * Move a vault file or directory to the OS Trash. Returns the trashed
 * entry's display name. Desktop only — rejects outside the browser shell
 * just like the disk-write guards below.
 */
export async function deleteVaultPath(path: string): Promise<string> {
  if (!isTauriEnvironment()) throw new Error('Vault delete needs the desktop shell');
  return invoke<string>('delete_to_trash', { path });
}

/** Create a markdown file in the vault (dir = vault-relative or absolute). */
export async function createVaultFile(dir?: string, name?: string): Promise<VaultEntry> {
  if (!isTauriEnvironment()) throw new Error('Vault create needs the desktop shell');
  const stem = (name ?? 'Untitled').replace(/\.(md|markdown)$/i, '');
  return invoke<VaultEntry>('create_vault_file', {
    dir: dir ?? null,
    name: name ?? null,
    initialContent: `# ${stem || 'Untitled'}\n\n`,
  });
}

/** Create a folder in the vault. */
export async function createVaultDir(dir?: string, name?: string): Promise<VaultEntry> {
  if (!isTauriEnvironment()) throw new Error('Vault create needs the desktop shell');
  return invoke<VaultEntry>('create_vault_dir', { dir: dir ?? null, name: name ?? null });
}

/** Rename a vault file or folder (same directory, new base name). */
export async function renameVaultPath(path: string, newName: string): Promise<VaultEntry> {
  if (!isTauriEnvironment()) throw new Error('Vault rename needs the desktop shell');
  return invoke<VaultEntry>('rename_vault_path', { oldPath: path, newName });
}

export interface VaultChangeEvent {
  /** Absolute path that changed. */
  path: string;
  /** 'created' | 'modified' | 'removed' */
  kind: string;
}

/** Start the backend file watcher for the current vault root. */
export async function startVaultWatch(): Promise<void> {
  await invoke('start_vault_watch');
}

/** Stop the backend file watcher (e.g. when the vault is closed). */
export async function stopVaultWatch(): Promise<void> {
  await invoke('stop_vault_watch');
}

// ---------------------------------------------------------------------------
// Vault image assets: File/bytes in, portable relative URL out.
// Markdown always stores the vault-relative `.assets/…` path; only the
// renderer resolves it to a streamable URL, so notes stay portable.
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** Pick a file extension from MIME type, falling back to the file name. */
export function imageExtFor(mime: string, fileName: string): string {
  if (MIME_TO_EXT[mime]) return MIME_TO_EXT[mime];
  const m = fileName.match(/\.([a-zA-Z0-9]+)$/);
  if (m && /^[a-zA-Z0-9]{2,5}$/.test(m[1])) return m[1].toLowerCase();
  return 'png';
}

/**
 * Vault-relative asset path: `.assets/<doc-stem>-<rand6>.<ext>`. Unique per
 * insert, so assets never need the text conflict guard.
 */
export function assetRelFor(docFileName: string, ext: string): string {
  const stem =
    (docFileName.replace(/\.(md|markdown)$/i, '') || 'note')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'note';
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `.assets/${stem}-${rand}.${ext}`;
}

export function assetAbsPath(vaultRoot: string, rel: string): string {
  return `${vaultRoot.replace(/[/\\]+$/, '')}/${rel}`;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Persist raw image bytes as a vault asset. Returns the vault-relative URL
 * for the markdown source. Throws outside the desktop shell / without a vault.
 */
export async function storeImageBytes(
  bytes: Uint8Array,
  ext: string,
  docFileName: string,
  vaultRoot: string | null
): Promise<string> {
  if (!isTauriEnvironment() || !vaultRoot) {
    throw new Error('Vault assets require the desktop shell with an open vault.');
  }
  const rel = assetRelFor(docFileName, ext);
  await invoke('write_binary_atomic', {
    path: assetAbsPath(vaultRoot, rel),
    bytes: Array.from(bytes),
  });
  return rel;
}

/**
 * Store an image `File` as a vault asset when possible, else fall back to an
 * inline data URL (browser build, or docs without a vault path).
 */
export async function storeImageFile(
  file: File,
  docFileName: string,
  vaultRoot: string | null
): Promise<string> {
  if (!isTauriEnvironment() || !vaultRoot) {
    return fileToDataUrl(file);
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  return storeImageBytes(buf, imageExtFor(file.type, file.name), docFileName, vaultRoot);
}

/**
 * Convert an inline `data:image/…` URL into a vault asset. Returns the
 * relative URL, or null when the input is not a data URL (remote URLs pass
 * through untouched by the caller).
 */
export async function dataUrlToAsset(
  dataUrl: string,
  docFileName: string,
  vaultRoot: string | null
): Promise<string | null> {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/s);
  if (!m || !isTauriEnvironment() || !vaultRoot) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return storeImageBytes(bytes, imageExtFor(m[1], ''), docFileName, vaultRoot);
}

/**
 * Resolve a markdown image URL for rendering. Vault-relative and absolute
 * disk paths become streamable asset URLs in the desktop shell; remote URLs,
 * data URLs, and every browser-build URL pass through untouched.
 */
export function resolveImageSrc(
  url: string,
  docFilePath: string | null,
  vaultRoot: string | null
): string {
  if (!isTauriEnvironment() || !url) return url;
  if (/^(https?:|data:|blob:|asset:|http:\/\/asset)/i.test(url)) return url;
  if (/^[a-zA-Z]:[/\\]|^\//.test(url)) {
    // Absolute on-disk path — stream it directly.
    try {
      return convertFileSrc(url);
    } catch {
      return url;
    }
  }
  const baseDir =
    docFilePath && vaultRoot ? docFilePath.split(/[/\\]/).slice(0, -1).join('/') : vaultRoot;
  if (!baseDir) return url;
  try {
    return convertFileSrc(`${baseDir}/${url}`);
  } catch {
    return url;
  }
}

export interface VaultTreeNode {
  name: string;
  rel: string;
  path: string | null;
  kind: VaultEntryKind;
  depth: number;
  children: VaultTreeNode[];
}

/**
 * Pure helper: fold flat `rel`-sorted scan entries into a nested tree.
 * Directories come from the scan itself, so every file's ancestors exist.
 */
export function buildVaultTree(entries: VaultEntry[]): VaultTreeNode[] {
  const roots: VaultTreeNode[] = [];
  const dirIndex = new Map<string, VaultTreeNode>();

  const ensureDir = (rel: string): VaultTreeNode => {
    const existing = dirIndex.get(rel);
    if (existing) return existing;
    const name = rel.split('/').pop() || rel;
    const depth = rel.split('/').length - 1;
    const node: VaultTreeNode = { name, rel, path: null, kind: 'dir', depth, children: [] };
    dirIndex.set(rel, node);
    const slash = rel.lastIndexOf('/');
    if (slash === -1) {
      roots.push(node);
    } else {
      ensureDir(rel.slice(0, slash)).children.push(node);
    }
    return node;
  };

  for (const entry of entries) {
    if (entry.kind === 'dir') {
      const node = ensureDir(entry.rel);
      node.name = entry.name;
      continue;
    }
    const depth = entry.rel.split('/').length - 1;
    const node: VaultTreeNode = {
      name: entry.name,
      rel: entry.rel,
      path: entry.path,
      kind: 'file',
      depth,
      children: [],
    };
    const slash = entry.rel.lastIndexOf('/');
    if (slash === -1) {
      roots.push(node);
    } else {
      ensureDir(entry.rel.slice(0, slash)).children.push(node);
    }
  }
  return roots;
}
