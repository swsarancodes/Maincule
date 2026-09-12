import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import {
  DocumentState,
  createDocumentState,
  generateDocId,
  FolderItem,
  createFolderItem,
  syncDocumentHeading,
  extractDocumentHeading,
} from '../../core/document/document';
import { formatDisplayName, detectFileMeta } from '../../core/document/file-meta';
import {
  saveDocToDisk,
  forceSaveDocToDisk,
  VaultConflictError,
  openVaultDialog,
  setVaultRoot,
  listVaultFiles,
  deleteVaultPath,
  createVaultFile as ipcCreateVaultFile,
  createVaultDir as ipcCreateVaultDir,
  renameVaultPath as ipcRenameVaultPath,
  startVaultWatch,
  stopVaultWatch,
} from '../../ipc/vault';
import type { VaultEntry, VaultChangeEvent } from '../../ipc/vault';
import { isTauriEnvironment, readFile } from '../../ipc/client';
import type { FileReadResult } from '../../ipc/client';
import {
  rebuildSearchIndex,
  upsertSearchPath,
  removeSearchPath,
} from '../../ipc/search';

// ---------------------------------------------------------------------------
// Search index maintenance (Rust FTS5, desktop only)
//
// The on-disk index covers closed vault files that the in-memory modal search
// cannot see. Rebuilds are debounced and fire-and-forget so typing/autosave
// never blocks on indexing; single-path upserts keep saves/watcher events
// fresh without a full rescan.
// ---------------------------------------------------------------------------

let searchRebuildTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSearchRebuild(): void {
  if (!isTauriEnvironment()) return;
  if (searchRebuildTimer) clearTimeout(searchRebuildTimer);
  searchRebuildTimer = setTimeout(() => {
    searchRebuildTimer = null;
    void rebuildSearchIndex().catch((e) => console.warn('Search index rebuild failed:', e));
  }, 1500);
}

const WELCOME_DOC = `# Manicule ☞

> An open-source, distraction-free Markdown studio with visual hybrid editing.

The Markdown text **is** the document model. Bytes you don't touch are bytes we don't rewrite.

---

> [!NOTE]
> Manicule edits Markdown visually without an AST serialization step. When you move your cursor away from syntax, it renders cleanly; when your caret enters a node, the raw markdown is revealed instantly.

---

## 1. Live Mermaid Architecture

\`\`\`mermaid
flowchart TD
    A[Markdown File on Disk] -->|Zero Loss Read| B[CodeMirror 6 Text Buffer]
    B -->|Incremental Parse| C[Lezer Syntax Tree]
    C -->|Viewport Scoped| D[Hybrid Decoration Engine]
    D --> E[Notion Tables]
    D --> F[Mermaid Diagrams]
    D --> G[Concealed Inline Markdown]
    D --> H[Rich Callouts]
    E & F & G & H -->|Transactions Only| B
    B -->|Atomic Write| A
\`\`\`

---

## 2. Interactive Notion-Style Tables

| Feature | Description | Status |
| :--- | :--- | :---: |
| **Hybrid Concealment** | Hide syntax markers on blur | Ready |
| **Visual Tables** | In-place cell editing with padded writeback | Ready |
| **Mermaid Diagrams** | Live SVG rendering with rounded cards | Ready |
| **Lossless Invariant** | Byte-identical round trip | 100% |

---

## 3. Notion & GitHub Callouts

> [!TIP]
> You can toggle between **Hybrid View** (\`⌘1\`), **Source View** (\`⌘2\`), and **Split View** (\`⌘3\`) anytime using keyboard shortcuts.

> [!IMPORTANT]
> The top floating toolbar appears smoothly whenever you highlight text, giving you 1-click styling, lists, and turn-into dropdowns.

---

## 4. Key Highlights
* **Zero Disruption Hybrid Mode**: Type freely with live concealment.
* **Smart Delimiter Guard**: No accidental deletions of closing asterisks or brackets.
* **Sub-millisecond Stats**: Word count, character count, and reading time computed on every keystroke.
* **Nested Folders & Subpages**: Complete Notion-style organization.
`;

const STORAGE_WRITE_DELAY_MS = 500;
const pendingStorageWrites = new Map<string, ReturnType<typeof setTimeout>>();

export function flushPendingStorageWrites(): void {
  for (const [, timer] of pendingStorageWrites) clearTimeout(timer);
  pendingStorageWrites.clear();
}

const safeStorage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(name);
      }
    } catch {}
    return null;
  },
  setItem: (name: string, value: string): void => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      // Zustand persist calls setItem on every store set — including every
      // cursor move. Debounce the actual localStorage write so typing and
      // caret motion never block on synchronous JSON serialization.
      const prev = pendingStorageWrites.get(name);
      if (prev) clearTimeout(prev);
      pendingStorageWrites.set(
        name,
        setTimeout(() => {
          pendingStorageWrites.delete(name);
          try {
            window.localStorage.setItem(name, value);
          } catch {}
        }, STORAGE_WRITE_DELAY_MS)
      );
    } catch {}
  },
  removeItem: (name: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(name);
      }
    } catch {}
  },
};

export interface DocViewState {
  line: number;
  col: number;
  scrollTop: number;
}

export interface WorkspaceState {
  documents: DocumentState[];
  folders: FolderItem[];
  collapsedIds: string[];
  activeDocumentId: string | null;
  cursorLine: number;
  cursorCol: number;
  wordCount: number;
  charCount: number;
  readingTimeMin: number;
  /** Canonicalized vault root picked via the native dialog (desktop only). */
  vaultRoot: string | null;
  /** Last scan of the vault root (never persisted — rescanned on launch). */
  vaultEntries: VaultEntry[];
  /** Recently opened file paths (persisted, capped). Powers quick-reopen. */
  recentPaths: string[];
  /** Per-document caret + scroll (persisted, restored on launch). */
  docViewState: Record<string, DocViewState>;

  createEmptyDocument: (title?: string, parentId?: string | null) => void;
  createFolder: (name?: string, parentId?: string | null) => void;
  renameFolder: (id: string, newName: string) => void;
  deleteFolder: (id: string) => void;
  toggleCollapse: (id: string) => void;
  moveItem: (itemId: string, newParentId: string | null) => void;
  openDocument: (content: string, filePath?: string | null) => void;
  setActiveDocument: (id: string) => void;
  closeDocument: (id: string) => void;
  deleteDocument: (id: string) => void;
  restoreItem: (id: string) => void;
  permanentDeleteItem: (id: string) => void;
  emptyTrash: () => void;
  updateDocumentContent: (id: string, newContent: string) => void;
  renameDocument: (id: string, newName: string) => void;
  reorderDocument: (fromId: string, toId: string | null, position?: 'before' | 'after') => void;
  openVault: () => Promise<void>;
  refreshVault: () => Promise<void>;
  openVaultFile: (path: string) => Promise<void>;
  /** Reopen a recent path; drops it from recents when unreadable. */
  openRecentPath: (path: string) => Promise<void>;
  /** Move a vault file/dir to the OS Trash; closes affected tabs. */
  deleteVaultFile: (path: string) => Promise<void>;
  /** Create a markdown file in the vault, refresh tree, open it. */
  createVaultFile: (dir?: string, name?: string) => Promise<void>;
  /** Create a folder in the vault and refresh the tree. */
  createVaultFolder: (dir?: string, name?: string) => Promise<void>;
  /** Rename a vault file/folder; retargets open tabs. */
  renameVaultEntry: (oldPath: string, newName: string) => Promise<void>;
  closeVault: () => void;
  /** Subscribe to backend watcher events (idempotent; desktop only). */
  startVaultSync: () => void;
  /** Conflict banner: overwrite disk with editor content. */
  resolveConflictKeepMine: (id: string) => Promise<void>;
  /** Conflict banner: discard edits, adopt disk content. */
  resolveConflictLoadDisk: (id: string) => Promise<void>;
  /** Deleted banner: write the open doc back to its path. */
  saveBackDeletedFile: (id: string) => Promise<void>;
  /** Deleted banner: keep the doc open without its file. */
  dismissDeletedFile: (id: string) => void;
  markDocumentSaved: (id: string, newPath?: string) => void;
  updateCursorPosition: (line: number, col: number) => void;
  updateCursorStats: (line: number, col: number) => void;
  updateDocViewState: (id: string, partial: Partial<DocViewState>) => void;
  /** Re-read open vault files on launch; clean docs adopt disk, dirty docs flag conflict. */
  rehydrateVaultDocs: () => Promise<void>;
}

const initialDoc = createDocumentState(WELCOME_DOC, null);
initialDoc.meta.fileName = 'Welcome.md';
initialDoc.hasCustomName = true;

function getDescendantDocIds(parentDocId: string, documents: DocumentState[]): Set<string> {
  const result = new Set<string>();
  function recurse(id: string) {
    for (const doc of documents) {
      if (doc.parentId === id && !result.has(doc.id)) {
        result.add(doc.id);
        recurse(doc.id);
      }
    }
  }
  recurse(parentDocId);
  return result;
}

function getDescendantFolderIds(parentFolderId: string, folders: FolderItem[]): Set<string> {  const result = new Set<string>();
  function recurse(id: string) {
    for (const f of folders) {
      if (f.parentId === id && !result.has(f.id)) {
        result.add(f.id);
        recurse(f.id);
      }
    }
  }
  recurse(parentFolderId);
  return result;
}

// ---------------------------------------------------------------------------
// Heading auto-rename (debounced)
//
// Typing a first heading renames Untitled-N.md to match — but only while the
// doc was never explicitly named, only after the user pauses typing, and never
// to a name another doc already has. This keeps tab labels stable per keystroke
// and stops the rename from fighting explicit renames.
// ---------------------------------------------------------------------------

const AUTO_RENAME_DELAY_MS = 500;
let autoRenameTimer: ReturnType<typeof setTimeout> | null = null;
const pendingAutoRenameIds = new Set<string>();

function scheduleAutoRename(id: string): void {
  pendingAutoRenameIds.add(id);
  if (autoRenameTimer) clearTimeout(autoRenameTimer);
  autoRenameTimer = setTimeout(() => {
    autoRenameTimer = null;
    const ids = [...pendingAutoRenameIds];
    pendingAutoRenameIds.clear();
    for (const targetId of ids) applyAutoRename(targetId);
  }, AUTO_RENAME_DELAY_MS);
}

/** Test hook: run any pending auto-renames synchronously instead of on a timer. */
export function flushPendingAutoRename(): void {
  if (autoRenameTimer) {
    clearTimeout(autoRenameTimer);
    autoRenameTimer = null;
  }
  const ids = [...pendingAutoRenameIds];
  pendingAutoRenameIds.clear();
  for (const targetId of ids) applyAutoRename(targetId);
}

// ---------------------------------------------------------------------------
// Word-count stats (debounced off the typing critical path)
//
// computeWordCount is O(n): running it on every keystroke janks large docs.
// Content lands immediately in updateDocumentContent; this trails by 250ms
// and only touches the status-bar counters (+ persist payload).
// ---------------------------------------------------------------------------

const STATS_DELAY_MS = 250;
let statsTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStats: { id: string; text: string } | null = null;

function scheduleStatsUpdate(id: string, text: string): void {
  pendingStats = { id, text };
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    statsTimer = null;
    const cur = pendingStats;
    pendingStats = null;
    if (!cur) return;
    const words = computeWordCount(cur.text);
    useWorkspaceStore.setState(() => ({
      wordCount: words,
      charCount: cur.text.length,
      readingTimeMin: computeReadingTime(words),
    }));
  }, STATS_DELAY_MS);
}

/** Test hook: flush pending stats synchronously. */
export function flushPendingStats(): void {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  const cur = pendingStats;
  pendingStats = null;
  if (!cur) return;
  const words = computeWordCount(cur.text);
  useWorkspaceStore.setState(() => ({
    wordCount: words,
    charCount: cur.text.length,
    readingTimeMin: computeReadingTime(words),
  }));
}

function applyAutoRename(id: string): void {
  const state = useWorkspaceStore.getState();
  const doc = state.documents.find((d) => d.id === id);
  if (!doc || doc.deletedAt || doc.hasCustomName) return;

  const headingTitle = extractDocumentHeading(doc.currentText);
  if (!headingTitle) return;
  const sanitized = headingTitle.replace(/[/\\?%*:|"<>]/g, '-').trim();
  if (!sanitized) return;

  const hadMd = doc.meta.fileName.toLowerCase().endsWith('.md');
  const base = hadMd ? `${sanitized}.md` : sanitized;
  if (base.toLowerCase() === doc.meta.fileName.toLowerCase()) return;

  // Never steal another live doc's name — append " - 2", " - 3", ...
  const taken = new Set(
    state.documents
      .filter((d) => d.id !== id && !d.deletedAt)
      .map((d) => d.meta.fileName.toLowerCase())
  );
  let candidate = base;
  if (taken.has(candidate.toLowerCase())) {
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let n = 2;
    while (taken.has(`${stem} - ${n}${ext}`.toLowerCase())) n++;
    candidate = `${stem} - ${n}${ext}`;
  }

  useWorkspaceStore.setState((s) => ({
    documents: s.documents.map((d) => {
      if (d.id !== id) return d;
      let newFilePath = d.meta.filePath;
      if (d.meta.filePath) {
        const parts = d.meta.filePath.split(/[/\\]/);
        if (parts.length > 1) {
          parts[parts.length - 1] = candidate;
          newFilePath = parts.join('/');
        } else {
          newFilePath = candidate;
        }
      }
      return { ...d, meta: { ...d.meta, fileName: candidate, filePath: newFilePath } };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Debounced vault autosave (desktop only)
//
// Docs with a filePath save 500ms after the last edit via an atomic,
// hash-guarded Rust write. Untitled docs (no path) and the browser build are
// untouched — they keep the localStorage model until B2's Save flow.
// ---------------------------------------------------------------------------

const AUTOSAVE_DELAY_MS = 500;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSaveIds = new Set<string>();
const inflightSaveIds = new Set<string>();

function scheduleAutosave(id: string): void {
  if (!isTauriEnvironment()) return;
  const doc = useWorkspaceStore.getState().documents.find((d) => d.id === id);
  if (!doc || !doc.meta.filePath || doc.deletedAt) return;
  pendingSaveIds.add(id);
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const ids = [...pendingSaveIds];
    pendingSaveIds.clear();
    for (const targetId of ids) void flushDocSave(targetId);
  }, AUTOSAVE_DELAY_MS);
}

async function flushDocSave(id: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  if (inflightSaveIds.has(id)) {
    // A save for this doc is already running: re-queue so the newest text
    // lands in a follow-up write instead of racing it (a race would surface
    // as a false conflict from the hash guard).
    pendingSaveIds.add(id);
    return;
  }
  const doc = useWorkspaceStore.getState().documents.find((d) => d.id === id);
  if (!doc || !doc.meta.filePath || doc.deletedAt) return;

  inflightSaveIds.add(id);
  try {
    const { hash, mtime, savedText } = await saveDocToDisk(doc);
    applySaveSuccess(id, hash, mtime, savedText);
  } catch (e) {
    if (e instanceof VaultConflictError) {
      useWorkspaceStore.setState((s) => ({
        documents: s.documents.map((d) => (d.id === id ? { ...d, syncConflict: true } : d)),
      }));
    } else {
      console.warn('Autosave failed:', e);
    }
  } finally {
    inflightSaveIds.delete(id);
    // Edits that landed mid-save re-queued above — flush them now.
    if (pendingSaveIds.has(id)) {
      pendingSaveIds.delete(id);
      await flushDocSave(id);
    }
  }
}

/**
 * Shared post-save bookkeeping: the saved text becomes the new clean baseline,
 * the Rust-issued hash arms the next conflict guard, and the timestamp tells
 * the watcher to ignore its own echo.
 */
function applySaveSuccess(id: string, hash: string, mtime: number, savedText: string): void {
  const path = useWorkspaceStore.getState().documents.find((d) => d.id === id)?.meta.filePath;
  if (path) lastOwnSaveAt.set(path, Date.now());
  useWorkspaceStore.setState((s) => ({
    documents: s.documents.map((d) => {
      if (d.id !== id) return d;
      return {
        ...d,
        initialText: savedText,
        isDirty: d.currentText !== savedText,
        syncConflict: false,
        syncDeleted: false,
        meta: { ...d.meta, hash, mtime },
      };
    }),
  }));
  // Keep the FTS index fresh without blocking the save path.
  if (path) void upsertSearchPath(path).catch(() => {});
}

/** Test hook: run pending autosaves now instead of on a timer. */
export async function flushPendingSaves(): Promise<void> {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  const ids = [...pendingSaveIds];
  pendingSaveIds.clear();
  for (const targetId of ids) await flushDocSave(targetId);
}

// ---------------------------------------------------------------------------
// External-change reconciliation (desktop vault only)
//
// Backend watcher events land here via startVaultSync's listener. Per-path
// debounced; our own saves are ignored by timestamp AND by content hash, so a
// save echo can never prompt. Three outcomes for an open doc:
//   clean + disk changed  -> silent reload (adopt disk content)
//   dirty + disk changed  -> syncConflict banner (Keep mine / Load disk)
//   file gone on disk     -> syncDeleted banner (Save it back / Keep open)
// ---------------------------------------------------------------------------

const RECONCILE_DEBOUNCE_MS = 400;
const OWN_SAVE_QUIET_MS = 1500;
const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastOwnSaveAt = new Map<string, number>();
let vaultSyncActive = false;

/** Replace a doc's content with disk state (silent reload / Load disk). */
function adoptDiskResult(id: string, result: FileReadResult): void {
  const { text, meta } = detectFileMeta(result.text, result.path);
  useWorkspaceStore.setState((s) => {
    const nextDocs = s.documents.map((d) => {
      if (d.id !== id) return d;
      return {
        ...d,
        currentText: text,
        initialText: text,
        isDirty: false,
        syncConflict: false,
        syncDeleted: false,
        meta: {
          ...meta,
          lineEnding: (result.line_ending === 'crlf' ? 'crlf' : 'lf') as 'lf' | 'crlf',
          hasBOM: result.has_bom,
          finalNewline: result.final_newline,
          mtime: result.mtime,
          hash: result.hash,
        },
      };
    });
    const activeDoc = nextDocs.find((d) => d.id === s.activeDocumentId);
    const viewingAdopted = s.activeDocumentId === id;
    return {
      documents: nextDocs,
      wordCount: viewingAdopted ? computeWordCount(text) : activeDoc ? computeWordCount(activeDoc.currentText) : s.wordCount,
      charCount: viewingAdopted ? text.length : activeDoc ? activeDoc.currentText.length : s.charCount,
      readingTimeMin: viewingAdopted
        ? computeReadingTime(computeWordCount(text))
        : activeDoc
          ? computeReadingTime(computeWordCount(activeDoc.currentText))
          : s.readingTimeMin,
    };
  });
}

async function reconcileVaultPath(path: string): Promise<void> {
  const fileName = path.split(/[/\\]/).pop() ?? '';
  // Our atomic-write temp files and hidden files never concern the UI.
  if (!fileName || fileName.startsWith('.tmp_') || fileName.startsWith('.')) return;
  const lastOwn = lastOwnSaveAt.get(path);
  if (lastOwn && Date.now() - lastOwn < OWN_SAVE_QUIET_MS) return;

  const st = useWorkspaceStore.getState();
  const doc = st.documents.find((d) => d.meta.filePath === path && !d.deletedAt);

  // The tree may have changed (created / removed / renamed) — resnapshot.
  // Concurrent scans are idempotent full snapshots; last write wins converges.
  await st.refreshVault();
  // Index the changed path even when no tab has it open (new external file).
  void upsertSearchPath(path).catch(() => {});

  if (!doc) return;

  let result: FileReadResult;
  try {
    result = await readFile(path);
  } catch {
    useWorkspaceStore.setState((s) => ({
      documents: s.documents.map((d) => (d.id === doc.id ? { ...d, syncDeleted: true } : d)),
    }));
    return;
  }

  if (result.hash === doc.meta.hash) {
    // Same bytes (save echo, chmod, touch, or remove+recreate dance): freshen mtime.
    useWorkspaceStore.setState((s) => ({
      documents: s.documents.map((d) =>
        d.id === doc.id ? { ...d, syncDeleted: false, meta: { ...d.meta, mtime: result.mtime } } : d
      ),
    }));
    return;
  }

  if (!doc.isDirty) {
    adoptDiskResult(doc.id, result);
  } else {
    useWorkspaceStore.setState((s) => ({
      documents: s.documents.map((d) => (d.id === doc.id ? { ...d, syncConflict: true } : d)),
    }));
  }
}

const MAX_RECENT_PATHS = 10;

/** Most-recent-first, deduped file path list for quick-reopen. */
function pushRecent(prev: string[], path: string): string[] {
  const next = [path, ...prev.filter((p) => p !== path)];
  return next.slice(0, MAX_RECENT_PATHS);
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      documents: [initialDoc],
      folders: [],
      collapsedIds: [],
      activeDocumentId: initialDoc.id,
      cursorLine: 1,
      cursorCol: 1,
      wordCount: computeWordCount(WELCOME_DOC),
      charCount: WELCOME_DOC.length,
      readingTimeMin: computeReadingTime(computeWordCount(WELCOME_DOC)),
      vaultRoot: null,
      vaultEntries: [],
      recentPaths: [],
      docViewState: {},

      createEmptyDocument: (title?: string, parentId: string | null = null) => {
        set((state) => {
          let fileName = title;
          if (!fileName) {
            let n = 1;
            const existingNames = new Set(
              state.documents
                .filter((d) => d.parentId === parentId && !d.deletedAt)
                .map((d) => d.meta.fileName.toLowerCase())
            );
            while (existingNames.has(`untitled-${n}.md`) || existingNames.has(`untitled-${n}`)) {
              n++;
            }
            fileName = `Untitled-${n}.md`;
          }
          const displayName = formatDisplayName(fileName);
          const initialContent = `# ${displayName}\n\n`;
          const newDoc = createDocumentState(initialContent, null, parentId);
          newDoc.meta.fileName = fileName;
          // An explicitly titled doc is already named; a generated
          // Untitled-N.md may still be auto-renamed from its first heading.
          newDoc.hasCustomName = !!title?.trim();

          const nextCollapsed = parentId
            ? state.collapsedIds.filter((cid) => cid !== parentId)
            : state.collapsedIds;

          return {
            documents: [...state.documents, newDoc],
            activeDocumentId: newDoc.id,
            collapsedIds: nextCollapsed,
            wordCount: computeWordCount(initialContent),
            charCount: initialContent.length,
            readingTimeMin: computeReadingTime(computeWordCount(initialContent)),
          };
        });
      },

      createFolder: (name?: string, parentId: string | null = null) => {
        set((state) => {
          let folderName = name?.trim();
          if (!folderName) {
            let n = 1;
            const existing = new Set(
              state.folders
                .filter((f) => f.parentId === parentId && !f.deletedAt)
                .map((f) => f.name.toLowerCase())
            );
            while (existing.has(`new folder ${n}`.toLowerCase()) || (n === 1 && existing.has('new folder'))) {
              n++;
            }
            folderName = n === 1 && !existing.has('new folder') ? 'New Folder' : `New Folder ${n}`;
          }

          const newFolder = createFolderItem(folderName, parentId);
          const nextCollapsed = parentId
            ? state.collapsedIds.filter((cid) => cid !== parentId)
            : state.collapsedIds;

          return {
            folders: [...state.folders, newFolder],
            collapsedIds: nextCollapsed,
          };
        });
      },

      renameFolder: (id: string, newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        set((state) => ({
          folders: state.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
        }));
      },

      deleteFolder: (id: string) => {
        set((state) => {
          const descendantFolderIds = getDescendantFolderIds(id, state.folders);
          const folderIdsToDelete = new Set([id, ...descendantFolderIds]);

          const docIdsInFolders = new Set<string>();
          for (const doc of state.documents) {
            if (doc.parentId && folderIdsToDelete.has(doc.parentId)) {
              docIdsInFolders.add(doc.id);
            }
          }

          const allDocIdsToDelete = new Set<string>();
          for (const docId of docIdsInFolders) {
            allDocIdsToDelete.add(docId);
            const subs = getDescendantDocIds(docId, state.documents);
            for (const s of subs) allDocIdsToDelete.add(s);
          }

          const now = new Date().toISOString();
          const nextFolders = state.folders.map((f) =>
            folderIdsToDelete.has(f.id) ? { ...f, deletedAt: now } : f
          );
          const nextDocs = state.documents.map((d) =>
            allDocIdsToDelete.has(d.id) ? { ...d, deletedAt: now } : d
          );

          const activeRemainingDocs = nextDocs.filter((d) => !d.deletedAt);
          let nextActive = state.activeDocumentId;

          if (activeRemainingDocs.length === 0) {
            const fresh = createDocumentState('', null);
            fresh.meta.fileName = 'Untitled-1.md';
            return {
              folders: nextFolders,
              documents: [...nextDocs, fresh],
              activeDocumentId: fresh.id,
              wordCount: 0,
              charCount: 0,
              readingTimeMin: 0,
            };
          } else if (allDocIdsToDelete.has(state.activeDocumentId || '')) {
            nextActive = activeRemainingDocs[0]?.id ?? null;
          }

          const activeDoc = activeRemainingDocs.find((d) => d.id === nextActive);
          return {
            folders: nextFolders,
            documents: nextDocs,
            activeDocumentId: nextActive,
            wordCount: activeDoc ? computeWordCount(activeDoc.currentText) : 0,
            charCount: activeDoc ? activeDoc.currentText.length : 0,
            readingTimeMin: activeDoc ? computeReadingTime(computeWordCount(activeDoc.currentText)) : 0,
          };
        });
      },

      toggleCollapse: (id: string) => {
        set((state) => ({
          collapsedIds: state.collapsedIds.includes(id)
            ? state.collapsedIds.filter((cid) => cid !== id)
            : [...state.collapsedIds, id],
        }));
      },

      moveItem: (itemId: string, newParentId: string | null) => {
        set((state) => {
          const isFolder = state.folders.some((f) => f.id === itemId);
          if (isFolder) {
            const descendants = getDescendantFolderIds(itemId, state.folders);
            if (newParentId === itemId || (newParentId && descendants.has(newParentId))) {
              return state;
            }
            // Folders may only live at the root or inside other folders —
            // never under a document (which would orphan them from the tree).
            if (newParentId !== null && !state.folders.some((f) => f.id === newParentId)) {
              return state;
            }
            return {
              folders: state.folders.map((f) =>
                f.id === itemId ? { ...f, parentId: newParentId } : f
              ),
            };
          }

          const isDoc = state.documents.some((d) => d.id === itemId);
          if (isDoc) {
            const docDescendants = getDescendantDocIds(itemId, state.documents);
            if (newParentId === itemId || (newParentId && docDescendants.has(newParentId))) {
              return state;
            }
            return {
              documents: state.documents.map((d) =>
                d.id === itemId ? { ...d, parentId: newParentId } : d
              ),
            };
          }

          return state;
        });
      },

      openDocument: (content: string, filePath = null) => {
        const doc = createDocumentState(content, filePath);
        // A doc opened from disk already has a real name.
        doc.hasCustomName = filePath ? true : doc.hasCustomName;
        set((state) => {
          const existing = state.documents.find((d) => d.meta.filePath === filePath && filePath !== null);
          if (existing) {
            return {
              activeDocumentId: existing.id,
              recentPaths: filePath ? pushRecent(state.recentPaths, filePath) : state.recentPaths,
            };
          }
          return {
            documents: [...state.documents, doc],
            activeDocumentId: doc.id,
            recentPaths: filePath ? pushRecent(state.recentPaths, filePath) : state.recentPaths,
          };
        });
      },

      setActiveDocument: (id: string) => {
        const doc = get().documents.find((d) => d.id === id);
        if (doc) {
          set({
            activeDocumentId: id,
            wordCount: computeWordCount(doc.currentText),
            charCount: doc.currentText.length,
            readingTimeMin: computeReadingTime(computeWordCount(doc.currentText)),
          });
        }
      },

      closeDocument: (id: string) => {
        get().deleteDocument(id);
      },

      deleteDocument: (id: string) => {
        set((state) => {
          const descendantDocIds = getDescendantDocIds(id, state.documents);
          const idsToDelete = new Set([id, ...descendantDocIds]);

          const now = new Date().toISOString();
          const nextDocs = state.documents.map((d) =>
            idsToDelete.has(d.id) ? { ...d, deletedAt: now } : d
          );

          const activeRemaining = nextDocs.filter((d) => !d.deletedAt);
          if (activeRemaining.length === 0) {
            const fresh = createDocumentState('', null);
            fresh.meta.fileName = 'Untitled-1.md';
            return {
              documents: [...nextDocs, fresh],
              activeDocumentId: fresh.id,
              wordCount: 0,
              charCount: 0,
              readingTimeMin: 0,
            };
          }
          const nextActive = idsToDelete.has(state.activeDocumentId || '')
            ? (activeRemaining[0]?.id ?? null)
            : state.activeDocumentId;
          const activeDoc = activeRemaining.find((d) => d.id === nextActive);
          return {
            documents: nextDocs,
            activeDocumentId: nextActive,
            wordCount: activeDoc ? computeWordCount(activeDoc.currentText) : 0,
            charCount: activeDoc ? activeDoc.currentText.length : 0,
            readingTimeMin: activeDoc ? computeReadingTime(computeWordCount(activeDoc.currentText)) : 0,
          };
        });
      },

      restoreItem: (id: string) => {
        set((state) => {
          const nowDoc = state.documents.find((d) => d.id === id);
          if (nowDoc) {
            const descendantDocIds = getDescendantDocIds(id, state.documents);
            const idsToRestore = new Set([id, ...descendantDocIds]);

            const parentIsDeleted =
              state.documents.some((d) => d.id === nowDoc.parentId && d.deletedAt) ||
              state.folders.some((f) => f.id === nowDoc.parentId && f.deletedAt);
            const nextParentId = parentIsDeleted ? null : nowDoc.parentId;

            // Name reuse: trashed names no longer reserve Untitled-N, so a
            // restore may collide with a live doc created afterwards.
            // Suffix the restored copy (" - 2", " - 3", ...) instead of duplicating.
            const liveNames = new Set(
              state.documents
                .filter((d) => d.id !== id && !d.deletedAt && d.parentId === nextParentId)
                .map((d) => d.meta.fileName.toLowerCase())
            );
            let restoredName = nowDoc.meta.fileName;
            if (liveNames.has(restoredName.toLowerCase())) {
              const dot = restoredName.lastIndexOf('.');
              const stem = dot > 0 ? restoredName.slice(0, dot) : restoredName;
              const ext = dot > 0 ? restoredName.slice(dot) : '';
              let n = 2;
              while (liveNames.has(`${stem} - ${n}${ext}`.toLowerCase())) n++;
              restoredName = `${stem} - ${n}${ext}`;
            }

            const nextDocs = state.documents.map((d) => {
              if (d.id === id)
                return {
                  ...d,
                  deletedAt: null,
                  parentId: nextParentId,
                  meta: { ...d.meta, fileName: restoredName },
                };
              if (idsToRestore.has(d.id)) return { ...d, deletedAt: null };
              return d;
            });

            return {
              documents: nextDocs,
              activeDocumentId: id,
            };
          }

          const nowFolder = state.folders.find((f) => f.id === id);
          if (nowFolder) {
            const descendantFolderIds = getDescendantFolderIds(id, state.folders);
            const folderIdsToRestore = new Set([id, ...descendantFolderIds]);

            const parentIsDeleted = state.folders.some(
              (f) => f.id === nowFolder.parentId && f.deletedAt
            );
            const nextParentId = parentIsDeleted ? null : nowFolder.parentId;

            // Same collision guard as docs: trashed folder names are reusable,
            // so suffix the restored copy when a live sibling took the name.
            const liveFolderNames = new Set(
              state.folders
                .filter((f) => f.id !== id && !f.deletedAt && f.parentId === nextParentId)
                .map((f) => f.name.toLowerCase())
            );
            let restoredFolderName = nowFolder.name;
            if (liveFolderNames.has(restoredFolderName.toLowerCase())) {
              let n = 2;
              while (liveFolderNames.has(`${restoredFolderName} - ${n}`.toLowerCase())) n++;
              restoredFolderName = `${restoredFolderName} - ${n}`;
            }

            const nextFolders = state.folders.map((f) => {
              if (f.id === id)
                return { ...f, deletedAt: null, parentId: nextParentId, name: restoredFolderName };
              if (folderIdsToRestore.has(f.id)) return { ...f, deletedAt: null };
              return f;
            });

            const nextDocs = state.documents.map((d) => {
              if (d.parentId && folderIdsToRestore.has(d.parentId)) {
                return { ...d, deletedAt: null };
              }
              return d;
            });

            return {
              folders: nextFolders,
              documents: nextDocs,
            };
          }

          return state;
        });
      },

      permanentDeleteItem: (id: string) => {
        set((state) => {
          const isFolder = state.folders.some((f) => f.id === id);
          if (isFolder) {
            const descendantFolderIds = getDescendantFolderIds(id, state.folders);
            const folderIdsToDelete = new Set([id, ...descendantFolderIds]);

            const docIdsInFolders = new Set<string>();
            for (const doc of state.documents) {
              if (doc.parentId && folderIdsToDelete.has(doc.parentId)) {
                docIdsInFolders.add(doc.id);
              }
            }
            const allDocIdsToDelete = new Set<string>();
            for (const docId of docIdsInFolders) {
              allDocIdsToDelete.add(docId);
              const subs = getDescendantDocIds(docId, state.documents);
              for (const s of subs) allDocIdsToDelete.add(s);
            }

            return {
              folders: state.folders.filter((f) => !folderIdsToDelete.has(f.id)),
              documents: state.documents.filter((d) => !allDocIdsToDelete.has(d.id)),
            };
          }

          const descendantDocIds = getDescendantDocIds(id, state.documents);
          const idsToDelete = new Set([id, ...descendantDocIds]);
          return {
            documents: state.documents.filter((d) => !idsToDelete.has(d.id)),
          };
        });
      },

      emptyTrash: () => {
        set((state) => ({
          folders: state.folders.filter((f) => !f.deletedAt),
          documents: state.documents.filter((d) => !d.deletedAt),
        }));
      },

      renameDocument: (id: string, newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed) return;

        set((state) => {
          const updatedDocs = state.documents.map((doc) => {
            if (doc.id === id) {
              const hadMd = doc.meta.fileName.toLowerCase().endsWith('.md');
              let finalName = trimmed;
              if (hadMd && !trimmed.toLowerCase().endsWith('.md')) {
                finalName = `${trimmed}.md`;
              } else if (!trimmed.includes('.')) {
                finalName = `${trimmed}.md`;
              }

              const displayName = formatDisplayName(finalName);
              const updatedText = syncDocumentHeading(doc.currentText, displayName);

              return {
                ...doc,
                currentText: updatedText,
                isDirty: doc.isDirty || updatedText !== doc.initialText,
                hasCustomName: true,
                meta: {
                  ...doc.meta,
                  fileName: finalName,
                },
              };
            }
            return doc;
          });

          const activeDoc = updatedDocs.find((d) => d.id === state.activeDocumentId);
          return {
            documents: updatedDocs,
            wordCount: activeDoc ? computeWordCount(activeDoc.currentText) : state.wordCount,
            charCount: activeDoc ? activeDoc.currentText.length : state.charCount,
            readingTimeMin: activeDoc ? computeReadingTime(computeWordCount(activeDoc.currentText)) : state.readingTimeMin,
          };
        });

        // Renaming rewrites the first heading line: persist it like any edit.
        scheduleAutosave(id);
      },

      reorderDocument: (fromId: string, toId: string | null, position: 'before' | 'after' = 'before') => {
        if (toId !== null && fromId === toId) return;
        set((state) => {
          const fromIdx = state.documents.findIndex((d) => d.id === fromId);
          if (fromIdx === -1) return state;
          const next = [...state.documents];
          const [moved] = next.splice(fromIdx, 1);
          if (toId === null) {
            next.push(moved);
          } else {
            const toIdx = next.findIndex((d) => d.id === toId);
            if (toIdx === -1) return state;
            next.splice(position === 'after' ? toIdx + 1 : toIdx, 0, moved);
          }
          return { documents: next };
        });
      },

      updateDocumentContent: (id: string, newContent: string) => {
        // Critical path: content + dirty flag land synchronously so typing
        // never waits on stats. Word counts are O(n) — debounce them so
        // fast typing on large docs doesn't re-run a full scan per keystroke.
        set((state) => ({
          documents: state.documents.map((doc) => {
            if (doc.id === id) {
              return { ...doc, currentText: newContent, isDirty: newContent !== doc.initialText };
            }
            return doc;
          }),
        }));
        scheduleStatsUpdate(id, newContent);

        // Heading auto-rename is debounced (see scheduleAutoRename): the text
        // lands immediately, the tab label settles after the user pauses typing.
        scheduleAutoRename(id);
        // Same for vault autosave: disk writes trail typing by 500ms.
        scheduleAutosave(id);
      },

      markDocumentSaved: (id: string, newPath?: string) => {
        set((state) => {
          const target = state.documents.find((d) => d.id === id);
          const savedPath = newPath || target?.meta.filePath || null;
          return {
            documents: state.documents.map((doc) => {
              if (doc.id === id) {
                return {
                  ...doc,
                  initialText: doc.currentText,
                  isDirty: false,
                  hasCustomName: newPath ? true : doc.hasCustomName,
                  meta: {
                    ...doc.meta,
                    filePath: newPath || doc.meta.filePath,
                    fileName: newPath ? newPath.split(/[/\\]/).pop() || doc.meta.fileName : doc.meta.fileName,
                  },
                };
              }
              return doc;
            }),
            recentPaths: savedPath ? pushRecent(state.recentPaths, savedPath) : state.recentPaths,
          };
        });
      },

      openVault: async () => {
        if (!isTauriEnvironment()) return;
        const picked = await openVaultDialog();
        if (!picked) return;
        const root = await setVaultRoot(picked);
        const entries = await listVaultFiles();
        set({ vaultRoot: root, vaultEntries: entries });
        try {
          await startVaultWatch();
        } catch (e) {
          console.warn('Vault watch failed:', e);
        }
        scheduleSearchRebuild();
      },

      refreshVault: async () => {
        const { vaultRoot, vaultEntries } = get();
        if (!isTauriEnvironment() || !vaultRoot) return;
        try {
          // Re-register in case the backend restarted; then rescan.
          await setVaultRoot(vaultRoot);
          const entries = await listVaultFiles();
          set({ vaultEntries: entries });
          // A changed file count means created/deleted files the index
          // hasn't seen via upsert — schedule a background rebuild.
          if (entries.length !== vaultEntries.length) scheduleSearchRebuild();
        } catch (e) {
          console.warn('Vault refresh failed:', e);
        }
      },

      openVaultFile: async (path: string) => {
        const existing = get().documents.find(
          (d) => d.meta.filePath === path && !d.deletedAt
        );
        if (existing) {
          set((s) => ({
            activeDocumentId: existing.id,
            recentPaths: pushRecent(s.recentPaths, path),
          }));
          return;
        }
        const result = await readFile(path);
        const doc = createDocumentState(result.text, result.path);
        doc.hasCustomName = true;
        // Rust's byte-level analysis is authoritative (BOM already stripped).
        doc.meta = {
          ...doc.meta,
          lineEnding: result.line_ending === 'crlf' ? 'crlf' : 'lf',
          hasBOM: result.has_bom,
          finalNewline: result.final_newline,
          mtime: result.mtime,
          hash: result.hash,
        };
        set((state) => ({
          documents: [...state.documents, doc],
          activeDocumentId: doc.id,
          wordCount: computeWordCount(doc.currentText),
          charCount: doc.currentText.length,
          readingTimeMin: computeReadingTime(computeWordCount(doc.currentText)),
          recentPaths: pushRecent(state.recentPaths, path),
        }));
      },

      openRecentPath: async (path: string) => {
        try {
          await get().openVaultFile(path);
        } catch (e) {
          // Stale entry (deleted file, closed vault, browser build) —
          // prune it instead of stranding a dead row in the UI.
          console.warn('Recent reopen failed, pruning:', e);
          set((s) => ({ recentPaths: s.recentPaths.filter((p) => p !== path) }));
        }
      },

      closeVault: () => {
        if (isTauriEnvironment()) {
          stopVaultWatch().catch(() => {});
        }
        set({ vaultRoot: null, vaultEntries: [] });
      },

      deleteVaultFile: async (path: string) => {
        if (!isTauriEnvironment()) return;
        await deleteVaultPath(path);
        void removeSearchPath(path).catch(() => {});
        // Close tabs for the trashed path (and, for dirs, everything under
        // it) through the existing soft-delete, so TrashModal keeps working
        // for the tab. The watcher echo then only resnapshots the tree.
        const norm = (p: string) => p.replace(/\\/g, '/');
        const prefix = `${norm(path)}/`;
        const affected = get().documents.filter(
          (d) =>
            !d.deletedAt &&
            d.meta.filePath &&
            (d.meta.filePath === path || norm(d.meta.filePath).startsWith(prefix))
        );
        for (const doc of affected) get().deleteDocument(doc.id);
        set((s) => {
          const dropped = new Set(affected.map((d) => d.id));
          const viewState = { ...s.docViewState };
          for (const id of dropped) delete viewState[id];
          return {
            recentPaths: s.recentPaths.filter(
              (p) => p !== path && !norm(p).startsWith(prefix)
            ),
            docViewState: viewState,
          };
        });
        await get().refreshVault();
      },

      createVaultFile: async (dir?: string, name?: string) => {
        if (!isTauriEnvironment()) return;
        const entry = await ipcCreateVaultFile(dir, name);
        await get().refreshVault();
        void upsertSearchPath(entry.path).catch(() => {});
        await get().openVaultFile(entry.path);
      },

      createVaultFolder: async (dir?: string, name?: string) => {
        if (!isTauriEnvironment()) return;
        await ipcCreateVaultDir(dir, name);
        await get().refreshVault();
      },

      renameVaultEntry: async (oldPath: string, newName: string) => {
        if (!isTauriEnvironment()) return;
        const entry = await ipcRenameVaultPath(oldPath, newName);
        const norm = (p: string) => p.replace(/\\/g, '/');
        // Retarget open tabs: exact file or everything under a renamed dir.
        const isDirRename = entry.kind === 'dir';
        const prefix = `${norm(oldPath)}/`;
        set((s) => ({
          documents: s.documents.map((d) => {
            if (!d.meta.filePath || d.deletedAt) return d;
            if (d.meta.filePath === oldPath) {
              return {
                ...d,
                meta: {
                  ...d.meta,
                  filePath: entry.path,
                  fileName: entry.name,
                },
              };
            }
            if (isDirRename && norm(d.meta.filePath).startsWith(prefix)) {
              const rest = d.meta.filePath.slice(oldPath.length);
              const nextPath = `${entry.path}${rest}`;
              return {
                ...d,
                meta: {
                  ...d.meta,
                  filePath: nextPath,
                },
              };
            }
            return d;
          }),
          recentPaths: s.recentPaths.map((p) => {
            if (p === oldPath) return entry.path;
            if (isDirRename && norm(p).startsWith(prefix)) return `${entry.path}${p.slice(oldPath.length)}`;
            return p;
          }),
        }));
        void removeSearchPath(oldPath).catch(() => {});
        void upsertSearchPath(entry.path).catch(() => {});
        await get().refreshVault();
      },

      startVaultSync: () => {
        if (vaultSyncActive || !isTauriEnvironment()) return;
        vaultSyncActive = true;
        void (async () => {
          try {
            const { listen } = await import('@tauri-apps/api/event');
            if (useWorkspaceStore.getState().vaultRoot) {
              await startVaultWatch().catch((e) => console.warn('Vault watch failed:', e));
            }
            await listen<VaultChangeEvent>('vault://file-changed', (event) => {
              // Note: `kind` is intentionally unread — by the time the debounce
              // fires we re-read the file and compare hashes, which subsumes
              // created/modified/removed races (e.g. atomic-save dances).
              const { path } = event.payload;
              const prev = reconcileTimers.get(path);
              if (prev) clearTimeout(prev);
              reconcileTimers.set(
                path,
                setTimeout(() => {
                  reconcileTimers.delete(path);
                  void reconcileVaultPath(path);
                }, RECONCILE_DEBOUNCE_MS)
              );
            });
          } catch (e) {
            console.warn('Vault sync failed:', e);
            vaultSyncActive = false;
          }
        })();
      },

      resolveConflictKeepMine: async (id: string) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc || !doc.meta.filePath) return;
        try {
          const { hash, mtime, savedText } = await forceSaveDocToDisk(doc);
          applySaveSuccess(id, hash, mtime, savedText);
        } catch (e) {
          console.warn('Keep-mine save failed:', e);
        }
      },

      resolveConflictLoadDisk: async (id: string) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc || !doc.meta.filePath) return;
        try {
          const result = await readFile(doc.meta.filePath);
          adoptDiskResult(id, result);
        } catch {
          // File vanished between event and click — show the deleted banner.
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, syncConflict: false, syncDeleted: true } : d
            ),
          }));
        }
      },

      saveBackDeletedFile: async (id: string) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc || !doc.meta.filePath) return;
        try {
          const { hash, mtime, savedText } = await forceSaveDocToDisk(doc);
          applySaveSuccess(id, hash, mtime, savedText);
          await get().refreshVault();
        } catch (e) {
          console.warn('Save-back failed:', e);
        }
      },

      dismissDeletedFile: (id: string) => {
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, syncDeleted: false } : d)),
        }));
      },

      updateCursorPosition: (line: number, col: number) => {
        set((state) => {
          if (state.cursorLine === line && state.cursorCol === col) return state;
          return { cursorLine: line, cursorCol: col };
        });
      },

      updateCursorStats: (line: number, col: number) => {
        set((state) => {
          if (state.cursorLine === line && state.cursorCol === col) return state;
          return { cursorLine: line, cursorCol: col };
        });
      },

      updateDocViewState: (id: string, partial: Partial<DocViewState>) => {
        set((state) => {
          const prev = state.docViewState[id];
          return {
            docViewState: {
              ...state.docViewState,
              [id]: {
                line: partial.line ?? prev?.line ?? 1,
                col: partial.col ?? prev?.col ?? 1,
                scrollTop: partial.scrollTop ?? prev?.scrollTop ?? 0,
              },
            },
          };
        });
      },

      rehydrateVaultDocs: async () => {
        if (!isTauriEnvironment()) return;
        // Rebuild the disk index once per launch so closed files are searchable.
        scheduleSearchRebuild();
        const docs = get().documents.filter((d) => d.meta.filePath && !d.deletedAt);
        for (const doc of docs) {
          const path = doc.meta.filePath!;
          let result: FileReadResult;
          try {
            result = await readFile(path);
          } catch {
            // Deleted while we were away — surface the deleted banner.
            useWorkspaceStore.setState((s) => ({
              documents: s.documents.map((d) => (d.id === doc.id ? { ...d, syncDeleted: true } : d)),
            }));
            continue;
          }
          if (result.hash === doc.meta.hash) {
            useWorkspaceStore.setState((s) => ({
              documents: s.documents.map((d) =>
                d.id === doc.id ? { ...d, meta: { ...d.meta, mtime: result.mtime } } : d
              ),
            }));
            continue;
          }
          if (!doc.isDirty && doc.currentText === doc.initialText) {
            adoptDiskResult(doc.id, result);
          } else {
            // Crash-era or external edit under a dirty buffer — let the user choose.
            useWorkspaceStore.setState((s) => ({
              documents: s.documents.map((d) => (d.id === doc.id ? { ...d, syncConflict: true } : d)),
            }));
          }
        }
      },
    }),
    {
      name: 'manicule_workspace_history',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        // Trash is session-only: deleted docs never survive a reload, which
        // also bounds localStorage growth. Cap open tabs to the last 50.
        documents: state.documents.filter((d) => !d.deletedAt).slice(-50),
        folders: state.folders,
        collapsedIds: state.collapsedIds,
        activeDocumentId: state.activeDocumentId,
        vaultRoot: state.vaultRoot,
        recentPaths: state.recentPaths,
        docViewState: state.docViewState,
        cursorLine: state.cursorLine,
        cursorCol: state.cursorCol,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.folders = state.folders || [];
          state.collapsedIds = state.collapsedIds || [];
          state.recentPaths = Array.isArray(state.recentPaths) ? state.recentPaths.slice(0, 10) : [];
          state.docViewState =
            state.docViewState && typeof state.docViewState === 'object' ? state.docViewState : {};
          // Vault entries are never persisted — rescanned on launch (App mount).
          state.vaultRoot = state.vaultRoot ?? null;
          state.vaultEntries = [];

          if (state.documents && state.documents.length > 0) {
            const seenIds = new Set<string>();
            state.documents = state.documents
              .filter((doc) => !doc.deletedAt)
              .slice(-50)
              .map((doc) => {
                let id = doc.id;
                if (!id || seenIds.has(id)) {
                  id = generateDocId();
                }
                seenIds.add(id);
                // syncConflict / syncDeleted are live-session flags, never restored.
                // isDirty is recomputed from text so a crash-era buffer shows correctly.
                return {
                  ...doc,
                  id,
                  parentId: doc.parentId ?? null,
                  syncConflict: false,
                  syncDeleted: false,
                  isDirty: doc.currentText !== doc.initialText,
                };
              });

            const activeDoc =
              state.documents.find((d) => d.id === state.activeDocumentId) || state.documents[0];
            if (activeDoc) {
              state.activeDocumentId = activeDoc.id;
              state.wordCount = computeWordCount(activeDoc.currentText);
              state.charCount = activeDoc.currentText.length;
              state.readingTimeMin = computeReadingTime(state.wordCount);
            }
          }
        }
      },
    }
  )
);

export function computeWordCount(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Any whitespace (space, tab, newline, carriage return)
    if (code <= 32) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export function computeReadingTime(words: number): number {
  return Math.max(1, Math.ceil(words / 200));
}
