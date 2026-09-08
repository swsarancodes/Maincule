import React, { useState, useRef, useEffect } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import {
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  PanelLeftClose,
  BookOpen,
  Search,
  X,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { formatDisplayName } from '../../core/document/file-meta';
import { TrashModal } from './TrashModal';
import { isTauriEnvironment } from '../../ipc/client';
import { buildVaultTree, VaultTreeNode } from '../../ipc/vault';

export const Sidebar: React.FC = () => {
  const documents = useWorkspaceStore((s) => s.documents);
  const folders = useWorkspaceStore((s) => s.folders);
  const collapsedIds = useWorkspaceStore((s) => s.collapsedIds);
  const activeId = useWorkspaceStore((s) => s.activeDocumentId);

  const [trashOpen, setTrashOpen] = useState(false);
  const setActiveDoc = useWorkspaceStore((s) => s.setActiveDocument);
  const deleteDoc = useWorkspaceStore((s) => s.deleteDocument);
  const createEmpty = useWorkspaceStore((s) => s.createEmptyDocument);
  const openDoc = useWorkspaceStore((s) => s.openDocument);
  const renameDoc = useWorkspaceStore((s) => s.renameDocument);

  const createFolder = useWorkspaceStore((s) => s.createFolder);
  const renameFolder = useWorkspaceStore((s) => s.renameFolder);
  const deleteFolder = useWorkspaceStore((s) => s.deleteFolder);
  const toggleCollapse = useWorkspaceStore((s) => s.toggleCollapse);
  const moveItem = useWorkspaceStore((s) => s.moveItem);

  const vaultRoot = useWorkspaceStore((s) => s.vaultRoot);
  const vaultEntries = useWorkspaceStore((s) => s.vaultEntries);
  const openVault = useWorkspaceStore((s) => s.openVault);
  const refreshVault = useWorkspaceStore((s) => s.refreshVault);
  const openVaultFile = useWorkspaceStore((s) => s.openVaultFile);
  const deleteVaultFile = useWorkspaceStore((s) => s.deleteVaultFile);
  const createVaultFile = useWorkspaceStore((s) => s.createVaultFile);
  const createVaultFolder = useWorkspaceStore((s) => s.createVaultFolder);
  const renameVaultEntry = useWorkspaceStore((s) => s.renameVaultEntry);
  const closeVault = useWorkspaceStore((s) => s.closeVault);

  const isDesktop = isTauriEnvironment();
  const [collapsedVaultRels, setCollapsedVaultRels] = useState<string[]>([]);
  const vaultTree = React.useMemo(() => buildVaultTree(vaultEntries), [vaultEntries]);
  const toggleVaultDir = (rel: string) =>
    setCollapsedVaultRels((prev) => (prev.includes(rel) ? prev.filter((r) => r !== rel) : [...prev, rel]));
  const vaultRootName = vaultRoot ? (vaultRoot.split(/[/\\]/).pop() || vaultRoot) : null;

  // Vault delete: confirm natively, then move to the OS Trash via Rust.
  // Dynamically imported so the browser build never touches Tauri plugins.
  const handleVaultDelete = React.useCallback(
    async (node: VaultTreeNode, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!node.path) return;
      try {
        const { confirm } = await import('@tauri-apps/plugin-dialog');
        const what = node.kind === 'dir' ? `folder "${node.name}" and its contents` : `"${node.name}"`;
        const ok = await confirm(`Move ${what} to Trash?`, {
          title: 'Delete from vault',
          kind: 'warning',
        });
        if (!ok) return;
        await deleteVaultFile(node.path);
      } catch (err) {
        console.warn('Vault delete failed:', err);
      }
    },
    [deleteVaultFile]
  );

  const handleVaultCreateFile = React.useCallback(
    async (dirRel?: string) => {
      const name = window.prompt('New note name:', 'Untitled.md');
      if (name === null) return;
      try {
        await createVaultFile(dirRel, name || 'Untitled.md');
      } catch (err) {
        console.warn('Vault create failed:', err);
        window.alert(`Could not create note: ${err}`);
      }
    },
    [createVaultFile]
  );

  const handleVaultCreateFolder = React.useCallback(
    async (dirRel?: string) => {
      const name = window.prompt('New folder name:', 'New Folder');
      if (name === null) return;
      if (!name.trim()) return;
      try {
        await createVaultFolder(dirRel, name.trim());
      } catch (err) {
        console.warn('Vault folder create failed:', err);
        window.alert(`Could not create folder: ${err}`);
      }
    },
    [createVaultFolder]
  );

  const handleVaultRename = React.useCallback(
    async (node: VaultTreeNode, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!node.path) return;
      const next = window.prompt(
        node.kind === 'dir' ? 'Rename folder:' : 'Rename note:',
        node.name
      );
      if (next === null || next.trim() === '' || next === node.name) return;
      try {
        await renameVaultEntry(node.path, next.trim());
      } catch (err) {
        console.warn('Vault rename failed:', err);
        window.alert(`Could not rename: ${err}`);
      }
    },
    [renameVaultEntry]
  );

  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

  const [isCompact, setIsCompact] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // When the workspace search box has text, flatten vault hits instead of the tree.
  const filteredVaultFiles = React.useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const out: VaultTreeNode[] = [];
    const walk = (nodes: VaultTreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'file' && n.name.toLowerCase().includes(q)) out.push(n);
        walk(n.children);
      }
    };
    walk(vaultTree);
    return out;
  }, [vaultTree, query]);

  // Drag and drop state
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Folders can't be dropped onto documents (docs accept subpages, but a folder
  // parented to a doc would vanish from the tree). The store rejects it too;
  // this just keeps the drop highlight honest.
  const draggedIsFolder = draggedItemId
    ? folders.some((f) => f.id === draggedItemId)
    : false;

  // Renaming state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'doc' | 'folder'>('doc');
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleStartRename = (
    id: string,
    currentName: string,
    type: 'doc' | 'folder',
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    setEditingId(id);
    setEditingType(type);
    setEditingName(type === 'doc' ? formatDisplayName(currentName) : currentName);
  };

  const handleFinishRename = () => {
    if (editingId && editingName.trim()) {
      if (editingType === 'doc') {
        renameDoc(editingId, editingName.trim());
      } else {
        renameFolder(editingId, editingName.trim());
      }
    }
    setEditingId(null);
  };

  const handleOpenLocalFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const text = await file.text();
        openDoc(text, file.name);
      }
    };
    input.click();
  };

  const handleLoadSampleSpec = () => {
    const specMarkdown = `# 03 — Editor Core Spec

## 1. The model

There is exactly one representation of the document: **the Markdown text**.

\`\`\`
EditorState.doc  ← the only source of truth
      │
      ├── Lezer syntax tree      (derived, incremental, disposable)
      └── DecorationSet          (derived, viewport-scoped, disposable)
\`\`\`

There is no AST-of-record. There is no rich-text model. There is no
serialization step. Saving is \`doc.toString()\` plus line-ending restoration.

**Invariant:** if the user makes no edit, the bytes written equal the bytes read.
`;
    openDoc(specMarkdown, '03-editor-core-spec.md');
  };

  // Search filter
  const isSearching = query.trim().length > 0;
  const filteredDocs = isSearching
    ? documents.filter((doc) => {
        if (doc.deletedAt) return false;
        const q = query.trim().toLowerCase();
        return (
          doc.meta.fileName.toLowerCase().includes(q) ||
          formatDisplayName(doc.meta.fileName).toLowerCase().includes(q)
        );
      })
    : [];

  const filteredFolders = isSearching
    ? folders.filter((f) => !f.deletedAt && f.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  // Recursive Tree Node Renderer
  const renderTree = (parentId: string | null = null, depth: number = 0): React.ReactNode => {
    const childFolders = folders.filter((f) => f.parentId === parentId && !f.deletedAt);
    const childDocs = documents.filter((d) => (d.parentId ?? null) === parentId && !d.deletedAt);

    if (childFolders.length === 0 && childDocs.length === 0) {
      return null;
    }

    return (
      <div
        key={`level-${parentId || 'root'}-${depth}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderLeft: depth > 0 ? '1px solid var(--as-border-subtle, rgba(128,128,128,0.12))' : 'none',
          marginLeft: depth > 0 ? '12px' : 0,
          paddingLeft: depth > 0 ? '4px' : 0,
        }}
      >
        {/* 1. Folders in this level */}
        {childFolders.map((folder) => {
          const isCollapsed = collapsedIds.includes(folder.id);
          const hasChildren =
            folders.some((f) => f.parentId === folder.id) ||
            documents.some((d) => d.parentId === folder.id);
          const isEditing = editingId === folder.id && editingType === 'folder';

          const isDropTarget = dropTargetId === folder.id;
          return (
            <div key={`folder-${folder.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                className="as-tree-node"
                draggable={!isEditing}
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData('text/plain', folder.id);
                  setDraggedItemId(folder.id);
                }}
                onDragEnd={() => {
                  setDraggedItemId(null);
                  setDropTargetId(null);
                }}
                onDragOver={(e) => {
                  if (draggedItemId && draggedItemId !== folder.id) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTargetId(folder.id);
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  if (dropTargetId === folder.id) setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedItemId && draggedItemId !== folder.id) {
                    moveItem(draggedItemId, folder.id);
                  }
                  setDraggedItemId(null);
                  setDropTargetId(null);
                }}
                onClick={() => toggleCollapse(folder.id)}
                onDoubleClick={(e) => handleStartRename(folder.id, folder.name, 'folder', e)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 8px',
                  borderRadius: 'var(--as-radius-sm)',
                  fontSize: '13px',
                  color: 'var(--as-text)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'background var(--as-transition-fast)',
                  position: 'relative',
                  outline: isDropTarget ? '1.5px dashed var(--as-accent)' : 'none',
                  outlineOffset: '-1px',
                  backgroundColor: isDropTarget ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isDropTarget) e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isDropTarget) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {/* Chevron expand/collapse */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(folder.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '14px',
                    height: '14px',
                    color: 'var(--as-text-muted)',
                    opacity: hasChildren ? 0.9 : 0.3,
                  }}
                >
                  {hasChildren ? (
                    isCollapsed ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )
                  ) : (
                    <span style={{ width: '12px' }} />
                  )}
                </button>

                {/* Folder Icon */}
                {isCollapsed ? (
                  <Folder size={14} style={{ color: 'var(--as-accent)', flexShrink: 0 }} />
                ) : (
                  <FolderOpen size={14} style={{ color: 'var(--as-accent)', flexShrink: 0 }} />
                )}

                {/* Folder Title or Inline Edit */}
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    autoFocus
                    type="text"
                    value={editingName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') handleFinishRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      color: 'var(--as-text)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1.5px solid var(--as-accent)',
                      outline: 'none',
                      padding: '0 1px',
                      margin: 0,
                      width: `${Math.max(40, (editingName.length + 1) * 7.5)}px`,
                      minWidth: '40px',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 550,
                    }}
                    title={`${folder.name} (Double-click to rename)`}
                  >
                    {folder.name}
                  </span>
                )}

                {/* Folder Actions on Hover */}
                <div
                  className="as-tree-actions"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    opacity: 0,
                    transition: 'opacity var(--as-transition-fast)',
                  }}
                >
                  <button
                    type="button"
                    title="New Note in Folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      createEmpty(undefined, folder.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <Plus size={12} />
                  </button>

                  <button
                    type="button"
                    title="New Subfolder"
                    onClick={(e) => {
                      e.stopPropagation();
                      createFolder(undefined, folder.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <FolderPlus size={11} />
                  </button>

                  <button
                    type="button"
                    title="Rename Folder"
                    onClick={(e) => handleStartRename(folder.id, folder.name, 'folder', e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-text)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <Pencil size={11} />
                  </button>

                  <button
                    type="button"
                    title="Delete Folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFolder(folder.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Recursive Children of Folder */}
              {!isCollapsed && renderTree(folder.id, depth + 1)}
            </div>
          );
        })}

        {/* 2. Documents in this level */}
        {childDocs.map((doc) => {
          const isActive = doc.id === activeId;
          const isEditing = editingId === doc.id && editingType === 'doc';
          const subpages = documents.filter((d) => d.parentId === doc.id);
          const hasSubpages = subpages.length > 0;
          const isCollapsed = collapsedIds.includes(doc.id);

          const isDropTarget = dropTargetId === doc.id;
          return (
            <div key={`doc-${doc.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                className="as-tree-node"
                draggable={!isEditing}
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData('text/plain', doc.id);
                  setDraggedItemId(doc.id);
                }}
                onDragEnd={() => {
                  setDraggedItemId(null);
                  setDropTargetId(null);
                }}
                onDragOver={(e) => {
                  if (draggedItemId && draggedItemId !== doc.id && !draggedIsFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTargetId(doc.id);
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  if (dropTargetId === doc.id) setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedItemId && draggedItemId !== doc.id && !draggedIsFolder) {
                    moveItem(draggedItemId, doc.id);
                  }
                  setDraggedItemId(null);
                  setDropTargetId(null);
                }}
                onClick={() => {
                  setActiveDoc(doc.id);
                  if (isCompact) toggleSidebar();
                }}
                onDoubleClick={(e) => handleStartRename(doc.id, doc.meta.fileName, 'doc', e)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 8px',
                  borderRadius: 'var(--as-radius-sm)',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--as-text)' : 'var(--as-text-muted)',
                  backgroundColor: isDropTarget
                    ? 'rgba(59, 130, 246, 0.12)'
                    : isActive
                    ? 'var(--as-bg-subtle)'
                    : 'transparent',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'background var(--as-transition-fast)',
                  position: 'relative',
                  outline: isDropTarget ? '1.5px dashed var(--as-accent)' : 'none',
                  outlineOffset: '-1px',
                }}
                onMouseEnter={(e) => {
                  if (!isActive && !isDropTarget) e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive && !isDropTarget) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {/* Chevron for subpages */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(doc.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '14px',
                    height: '14px',
                    color: 'var(--as-text-muted)',
                    opacity: hasSubpages ? 0.9 : 0.3,
                  }}
                >
                  {hasSubpages ? (
                    isCollapsed ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )
                  ) : (
                    <span style={{ width: '12px' }} />
                  )}
                </button>

                {/* Document Icon */}
                <FileText size={14} style={{ opacity: isActive ? 1 : 0.6, flexShrink: 0 }} />

                {/* Document Title or Inline Edit */}
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    autoFocus
                    type="text"
                    value={editingName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') handleFinishRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      fontFamily: 'inherit',
                      color: 'var(--as-text)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1.5px solid var(--as-accent)',
                      outline: 'none',
                      padding: '0 1px',
                      margin: 0,
                      width: `${Math.max(40, (editingName.length + 1) * 7.5)}px`,
                      minWidth: '40px',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${doc.meta.fileName} (Double-click to rename)`}
                  >
                    {formatDisplayName(doc.meta.fileName)}
                  </span>
                )}

                {/* Document Actions on Hover */}
                <div
                  className="as-tree-actions"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    opacity: 0,
                    transition: 'opacity var(--as-transition-fast)',
                  }}
                >
                  <button
                    type="button"
                    title="Add Subpage"
                    onClick={(e) => {
                      e.stopPropagation();
                      createEmpty(undefined, doc.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <Plus size={12} />
                  </button>

                  <button
                    type="button"
                    title="Rename Note"
                    onClick={(e) => handleStartRename(doc.id, doc.meta.fileName, 'doc', e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-text)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <Pencil size={11} />
                  </button>

                  <button
                    type="button"
                    title="Delete Note"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDoc(doc.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--as-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Recursive Subpages of Document */}
              {hasSubpages && !isCollapsed && renderTree(doc.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderVaultTree = (nodes: VaultTreeNode[]): React.ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'dir') {
        const collapsed = collapsedVaultRels.includes(node.rel);
        return (
          <React.Fragment key={`vault-dir-${node.rel}`}>
            <div
              className="as-tree-node"
              onClick={() => toggleVaultDir(node.rel)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 8px',
                borderRadius: 'var(--as-radius-sm)',
                fontSize: '13px',
                color: 'var(--as-text)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <Folder size={14} style={{ color: 'var(--as-accent)', flexShrink: 0 }} />
              <span style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
              <div
                className="as-tree-actions"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginLeft: 'auto',
                  opacity: 0,
                  transition: 'opacity var(--as-transition-fast)',
                }}
              >
                <button
                  type="button"
                  title="New note here"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleVaultCreateFile(node.rel);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <Plus size={11} />
                </button>
                <button
                  type="button"
                  title="Rename folder"
                  onClick={(e) => void handleVaultRename(node, e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title="Delete Folder"
                  onClick={(e) => void handleVaultDelete(node, e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            {!collapsed && <div style={{ marginLeft: '12px' }}>{renderVaultTree(node.children)}</div>}
          </React.Fragment>
        );
      }
      const isOpen = node.path !== null && documents.some((d) => d.meta.filePath === node.path && !d.deletedAt);
      const isActiveDoc =
        node.path !== null && documents.some((d) => d.meta.filePath === node.path && d.id === activeId && !d.deletedAt);
      return (
        <div
          key={`vault-file-${node.rel}`}
          className="as-tree-node"
          onClick={() => {
            if (node.path) {
              openVaultFile(node.path);
              if (isCompact) toggleSidebar();
            }
          }}
          title={node.rel}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 8px',
            borderRadius: 'var(--as-radius-sm)',
            fontSize: '13px',
            fontWeight: isActiveDoc ? 600 : 400,
            color: isActiveDoc ? 'var(--as-text)' : 'var(--as-text-muted)',
            backgroundColor: isActiveDoc ? 'var(--as-bg-subtle)' : 'transparent',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            if (!isActiveDoc) e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (!isActiveDoc) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <FileText size={14} style={{ opacity: isOpen ? 1 : 0.6, flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatDisplayName(node.name)}
          </span>
          <div
            className="as-tree-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              opacity: 0,
              transition: 'opacity var(--as-transition-fast)',
            }}
          >
            <button
              type="button"
              title="Rename note"
              onClick={(e) => void handleVaultRename(node, e)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--as-text-dim)',
                cursor: 'pointer',
                padding: '2px',
                borderRadius: '3px',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              title="Delete Note"
              onClick={(e) => void handleVaultDelete(node, e)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--as-text-dim)',
                cursor: 'pointer',
                padding: '2px',
                borderRadius: '3px',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      );
    });

  return (
    <>
      {/* Mobile/Compact Backdrop */}
      {sidebarOpen && isCompact && (
        <div
          className="as-sidebar-backdrop"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="File Navigation"
        className="as-sidebar"
        style={{
          width: sidebarOpen ? (isCompact ? '280px' : '260px') : '0px',
          minWidth: sidebarOpen ? (isCompact ? '280px' : '260px') : '0px',
          maxWidth: isCompact ? '85vw' : '260px',
          height: '100%',
          backgroundColor: 'var(--as-bg-surface)',
          borderRight: sidebarOpen ? '1px solid var(--as-border)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all var(--as-transition-normal)',
          overflow: 'hidden',
          zIndex: isCompact ? 100 : 20,
          position: isCompact ? 'fixed' : 'relative',
          left: 0,
          top: 0,
          bottom: 0,
          boxShadow: isCompact && sidebarOpen ? 'var(--as-shadow-lg, 0 10px 30px rgba(0,0,0,0.25))' : 'none',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: isCompact ? '280px' : '260px',
            maxWidth: isCompact ? '85vw' : '260px',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            opacity: sidebarOpen ? 1 : 0,
            transition: 'opacity var(--as-transition-fast)',
          }}
        >
        {/* Header Branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '42px',
            padding: '0 10px 0 14px',
            borderBottom: '1px solid var(--as-border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px', color: 'var(--as-text)' }}>☞</span>
            <span style={{ fontWeight: 650, fontSize: '13.5px', letterSpacing: '-0.015em', color: 'var(--as-text)' }}>
              Manicule Studio
            </span>
          </div>

          <button
            type="button"
            aria-label="Collapse sidebar (⌘\)"
            title="Collapse sidebar (⌘\)"
            onClick={toggleSidebar}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: 'var(--as-radius-sm)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--as-text-muted)',
              cursor: 'pointer',
              transition: 'all var(--as-transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
              e.currentTarget.style.color = 'var(--as-text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--as-text-muted)';
            }}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* Quick Search */}
        <div style={{ padding: '8px 10px 4px 10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px',
              backgroundColor: 'var(--as-bg-hover)',
              borderRadius: 'var(--as-radius-sm)',
              border: searchFocused ? '1px solid var(--as-accent)' : '1px solid transparent',
              transition: 'border var(--as-transition-fast)',
            }}
          >
            <Search size={13} style={{ color: 'var(--as-text-dim)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search notes and folders…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                fontSize: '12px',
                color: 'var(--as-text)',
                width: '100%',
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--as-text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Quick Action Navigation */}
        <div style={{ padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <button
            type="button"
            onClick={() => createEmpty()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 'var(--as-radius-sm)',
              color: 'var(--as-text)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background var(--as-transition-fast)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Plus size={15} style={{ color: 'var(--as-accent)' }} />
            <span>New Note</span>
          </button>

          <button
            type="button"
            onClick={() => createFolder()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 'var(--as-radius-sm)',
              color: 'var(--as-text)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background var(--as-transition-fast)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <FolderPlus size={15} style={{ color: 'var(--as-accent)' }} />
            <span>New Folder</span>
          </button>

          <button
            type="button"
            onClick={handleOpenLocalFile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 'var(--as-radius-sm)',
              color: 'var(--as-text-muted)',
              fontSize: '13px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background var(--as-transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
              e.currentTarget.style.color = 'var(--as-text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--as-text-muted)';
            }}
          >
            <FolderOpen size={15} />
            <span>Open File…</span>
          </button>

          {isDesktop && (
            <button
              type="button"
              onClick={() => openVault()}
              title="Open a folder as a vault (disk-backed notes with autosave)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 10px',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: 'var(--as-radius-sm)',
                color: 'var(--as-text-muted)',
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background var(--as-transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
                e.currentTarget.style.color = 'var(--as-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--as-text-muted)';
              }}
            >
              <Folder size={15} />
              <span>{vaultRoot ? 'Switch Vault…' : 'Open Folder…'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleLoadSampleSpec}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 'var(--as-radius-sm)',
              color: 'var(--as-text-muted)',
              fontSize: '13px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background var(--as-transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
              e.currentTarget.style.color = 'var(--as-text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--as-text-muted)';
            }}
          >
            <BookOpen size={15} />
            <span>Spec Reference</span>
          </button>
        </div>

        {/* Section Header: Workspace */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px 4px 14px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--as-text-dim)',
              fontWeight: 650,
            }}
          >
            {isSearching ? `Results (${filteredDocs.length + filteredFolders.length})` : `Workspace (${documents.length})`}
          </span>

          {!isSearching && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                title="New Folder"
                onClick={() => createFolder()}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--as-text-dim)',
                  cursor: 'pointer',
                  padding: '2px',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
              >
                <FolderPlus size={13} />
              </button>
              <button
                type="button"
                title="New Note"
                onClick={() => createEmpty()}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--as-text-dim)',
                  cursor: 'pointer',
                  padding: '2px',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
              >
                <Plus size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Tree Container */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 8px 16px 8px',
          }}
        >
          {isSearching ? (
            // Search Results Flat List
            <div>
              {filteredFolders.map((f) => (
                <div
                  key={`search-folder-${f.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px',
                    borderRadius: 'var(--as-radius-sm)',
                    fontSize: '13px',
                    color: 'var(--as-text)',
                  }}
                >
                  <Folder size={14} style={{ color: 'var(--as-accent)' }} />
                  <span style={{ fontWeight: 550 }}>{f.name}</span>
                </div>
              ))}
              {filteredDocs.map((doc) => {
                const isActive = doc.id === activeId;
                return (
                  <div
                    key={`search-doc-${doc.id}`}
                    onClick={() => {
                      setActiveDoc(doc.id);
                      if (isCompact) toggleSidebar();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 8px',
                      borderRadius: 'var(--as-radius-sm)',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? 'var(--as-text)' : 'var(--as-text-muted)',
                      backgroundColor: isActive ? 'var(--as-bg-subtle)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <FileText size={14} style={{ opacity: isActive ? 1 : 0.6 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatDisplayName(doc.meta.fileName)}
                    </span>
                  </div>
                );
              })}
              {filteredFolders.length === 0 && filteredDocs.length === 0 && (
                <div style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--as-text-dim)', fontStyle: 'italic' }}>
                  No matches found
                </div>
              )}
            </div>
          ) : (
            // Notion Hierarchical Tree
            <>
              {renderTree(null, 0)}
              {documents.length === 0 && folders.length === 0 && (
                <div style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--as-text-dim)', fontStyle: 'italic' }}>
                  No notes yet. Click + to create one.
                </div>
              )}

              {/* Root drop zone for un-nesting items to top level */}
              <div
                style={{
                  minHeight: '40px',
                  margin: '8px 0',
                  padding: '6px',
                  borderRadius: 'var(--as-radius-sm)',
                  border: dropTargetId === 'root' ? '1.5px dashed var(--as-accent)' : '1.5px dashed transparent',
                  backgroundColor: dropTargetId === 'root' ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all var(--as-transition-fast)',
                }}
                onDragOver={(e) => {
                  if (draggedItemId) {
                    e.preventDefault();
                    setDropTargetId('root');
                  }
                }}
                onDragLeave={() => {
                  if (dropTargetId === 'root') setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedItemId) {
                    moveItem(draggedItemId, null);
                  }
                  setDraggedItemId(null);
                  setDropTargetId(null);
                }}
              >
                {dropTargetId === 'root' && (
                  <span style={{ fontSize: '11px', color: 'var(--as-accent)', fontWeight: 500 }}>
                    Drop here to move to root
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Section: Disk Vault (desktop only) */}
        {isDesktop && vaultRoot && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px 4px 14px',
              }}
            >
              <span
                title={vaultRoot}
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--as-text-dim)',
                  fontWeight: 650,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {`Vault · ${vaultRootName} (${vaultEntries.filter((e) => e.kind === 'file').length})`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <button
                  type="button"
                  title="New note in vault"
                  onClick={() => void handleVaultCreateFile()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  title="New folder in vault"
                  onClick={() => void handleVaultCreateFolder()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  type="button"
                  title="Rescan vault folder"
                  onClick={() => refreshVault()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  type="button"
                  title="Close vault"
                  onClick={() => closeVault()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--as-text-dim)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--as-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--as-text-dim)')}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            <div style={{ maxHeight: '40%', overflowY: 'auto', padding: '4px 8px 8px 8px' }}>
              {vaultTree.length === 0 ? (
                <div style={{ padding: '8px', fontSize: '12px', color: 'var(--as-text-dim)', fontStyle: 'italic' }}>
                  No markdown files in this folder.
                </div>
              ) : (
                renderVaultTree(filteredVaultFiles ?? vaultTree)
              )}
            </div>
          </>
        )}

        {/* Bottom Sidebar Controls: Trash */}
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--as-border-subtle)',
            backgroundColor: 'var(--as-bg-surface)',
          }}
        >
          {(() => {
            const trashedCount =
              documents.filter((d) => d.deletedAt).length +
              folders.filter((f) => f.deletedAt).length;

            return (
              <button
                type="button"
                onClick={() => setTrashOpen(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 'var(--as-radius-sm)',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--as-text-muted)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'all var(--as-transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--as-bg-hover)';
                  e.currentTarget.style.color = 'var(--as-text)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--as-text-muted)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Trash2 size={14} />
                  <span>Trash</span>
                </div>
                {trashedCount > 0 && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--as-bg-subtle)',
                      color: 'var(--as-text-muted)',
                    }}
                  >
                    {trashedCount}
                  </span>
                )}
              </button>
            );
          })()}
        </div>
      </div>

      {/* Trash Recovery Modal */}
      <TrashModal isOpen={trashOpen} onClose={() => setTrashOpen(false)} />
    </aside>
    </>
  );
};
