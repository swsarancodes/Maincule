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
import { formatDisplayName } from '../../core/document/file-meta';

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
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(name, value);
      }
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
  markDocumentSaved: (id: string, newPath?: string) => void;
  updateCursorPosition: (line: number, col: number) => void;
  updateCursorStats: (line: number, col: number) => void;
}

const initialDoc = createDocumentState(WELCOME_DOC, null);
initialDoc.meta.fileName = 'Welcome.md';

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

function getDescendantFolderIds(parentFolderId: string, folders: FolderItem[]): Set<string> {
  const result = new Set<string>();
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

      createEmptyDocument: (title?: string, parentId: string | null = null) => {
        set((state) => {
          let fileName = title;
          if (!fileName) {
            let n = 1;
            const existingNames = new Set(
              state.documents
                .filter((d) => d.parentId === parentId)
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
                .filter((f) => f.parentId === parentId)
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
        set((state) => {
          const existing = state.documents.find((d) => d.meta.filePath === filePath && filePath !== null);
          if (existing) {
            return { activeDocumentId: existing.id };
          }
          return {
            documents: [...state.documents, doc],
            activeDocumentId: doc.id,
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

            const nextDocs = state.documents.map((d) => {
              if (d.id === id) return { ...d, deletedAt: null, parentId: nextParentId };
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

            const nextFolders = state.folders.map((f) => {
              if (f.id === id) return { ...f, deletedAt: null, parentId: nextParentId };
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

      updateDocumentContent: (id: string, newContent: string) => {        const words = computeWordCount(newContent);
        const headingTitle = extractDocumentHeading(newContent);

        set((state) => ({
          documents: state.documents.map((doc) => {
            if (doc.id === id) {
              const isDirty = newContent !== doc.initialText;
              let meta = doc.meta;

              if (headingTitle) {
                const sanitized = headingTitle.replace(/[/\\?%*:|"<>]/g, '-').trim();
                if (sanitized) {
                  const hadMd = doc.meta.fileName.toLowerCase().endsWith('.md');
                  const newFileName = hadMd ? `${sanitized}.md` : sanitized;

                  if (newFileName !== doc.meta.fileName) {
                    let newFilePath = doc.meta.filePath;
                    if (doc.meta.filePath) {
                      const parts = doc.meta.filePath.split(/[/\\]/);
                      if (parts.length > 1) {
                        parts[parts.length - 1] = newFileName;
                        newFilePath = parts.join('/');
                      } else {
                        newFilePath = newFileName;
                      }
                    }
                    meta = {
                      ...doc.meta,
                      fileName: newFileName,
                      filePath: newFilePath,
                    };
                  }
                }
              }

              return { ...doc, currentText: newContent, isDirty, meta };
            }
            return doc;
          }),
          wordCount: words,
          charCount: newContent.length,
          readingTimeMin: computeReadingTime(words),
        }));
      },

      markDocumentSaved: (id: string, newPath?: string) => {
        set((state) => ({
          documents: state.documents.map((doc) => {
            if (doc.id === id) {
              return {
                ...doc,
                initialText: doc.currentText,
                isDirty: false,
                meta: {
                  ...doc.meta,
                  filePath: newPath || doc.meta.filePath,
                  fileName: newPath ? newPath.split(/[\/\\]/).pop() || doc.meta.fileName : doc.meta.fileName,
                },
              };
            }
            return doc;
          }),
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
    }),
    {
      name: 'manicule_workspace_history',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        documents: state.documents,
        folders: state.folders,
        collapsedIds: state.collapsedIds,
        activeDocumentId: state.activeDocumentId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.folders = state.folders || [];
          state.collapsedIds = state.collapsedIds || [];

          if (state.documents && state.documents.length > 0) {
            const seenIds = new Set<string>();
            state.documents = state.documents.map((doc) => {
              let id = doc.id;
              if (!id || seenIds.has(id)) {
                id = generateDocId();
              }
              seenIds.add(id);
              return { ...doc, id, parentId: doc.parentId ?? null };
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
