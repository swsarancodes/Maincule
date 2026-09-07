import { FileMeta, detectFileMeta } from './file-meta';
import { serializeDocument } from './serialize';
import { frontmatterEnd } from '../markdown/frontmatter';

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  deletedAt?: string | null;
}

export function generateFolderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `folder-${crypto.randomUUID()}`;
  }
  return `folder-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createFolderItem(name: string, parentId: string | null = null): FolderItem {
  return {
    id: generateFolderId(),
    name: name.trim() || 'New Folder',
    parentId,
    createdAt: Date.now(),
    deletedAt: null,
  };
}

export interface DocumentState {
  id: string;
  meta: FileMeta;
  initialText: string;
  currentText: string;
  isDirty: boolean;
  parentId?: string | null;
  deletedAt?: string | null;
  /**
   * True once the user (or the filesystem) has explicitly named this document:
   * via rename, opening a real file, saving to a path, or creating with a title.
   * Auto-rename from the first heading only applies while this is falsy.
   */
  hasCustomName?: boolean;
  /**
   * Set when an autosave was refused because the file on disk changed
   * underneath us (B3 renders this as a conflict banner). Cleared on the next
   * successful save. Never persisted — recomputed every session.
   */
  syncConflict?: boolean;
  /**
   * Set when the file on disk backing this doc was deleted externally.
   * Banner offers "Save it back" / "Keep open". Never persisted.
   */
  syncDeleted?: boolean;
}

export function generateDocId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDocumentState(
  initialContent: string,
  filePath: string | null = null,
  parentId: string | null = null
): DocumentState {
  const { text, meta } = detectFileMeta(initialContent, filePath);
  return {
    id: generateDocId(),
    meta,
    initialText: text,
    currentText: text,
    isDirty: false,
    parentId: parentId || null,
  };
}

export function serializeDocumentState(doc: DocumentState): string {
  return serializeDocument(doc.currentText, doc.meta);
}

export function syncDocumentHeading(text: string, title: string): string {
  const cleanTitle = title.trim();
  if (!cleanTitle) return text;

  const headingLine = `# ${cleanTitle}`;

  // If text is empty or only whitespace
  if (!text.trim()) {
    return `${headingLine}\n\n`;
  }

  // Check frontmatter (YAML ---, TOML +++, or JSON {...} — first block only)
  const fmEnd = frontmatterEnd(text);
  const fm = text.slice(0, fmEnd);
  const body = text.slice(fmEnd);

  // Find the first non-empty line in body
  const lines = body.split(/\r?\n/);
  let firstNonEmptyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      firstNonEmptyIdx = i;
      break;
    }
  }

  if (firstNonEmptyIdx !== -1) {
    const firstLine = lines[firstNonEmptyIdx].trim();
    // If first non-empty line starts with '#' OR is a plain title line (not a list, quote, code, table, hr):
    if (firstLine.startsWith('#') || !firstLine.match(/^([-*+]|\d+\.|>|```|---|===|\|)/)) {
      lines[firstNonEmptyIdx] = headingLine;
      return fm + lines.join('\n');
    }
  }

  // Otherwise (e.g. document starts directly with a list or table), prepend heading
  return `${fm}${headingLine}\n\n${body.replace(/^\r?\n*/, '')}`;
}

export function extractDocumentHeading(text: string): string | null {
  if (!text.trim()) return null;

  // Skip frontmatter (YAML ---, TOML +++, or JSON {...} — first block only)
  const body = text.slice(frontmatterEnd(text));

  // 1. Look for explicit H1 heading anywhere near the top: # Heading
  const h1Match = body.match(/^#\s+([^\r\n]+)/m);
  if (h1Match) {
    const clean = h1Match[1].replace(/[*_~`]/g, '').trim();
    if (clean) return clean;
  }

  // 2. If no # heading found, find the first non-empty line
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Don't treat markdown syntax (lists, quotes, code blocks, dividers, tables) as a title
    if (trimmed.match(/^([-*+]|\d+\.|>|```|---|===|\||\[[ xX]\])/)) {
      break;
    }
    const clean = trimmed.replace(/^#+\s*/, '').replace(/[*_~`]/g, '').trim();
    if (clean && clean.length <= 120) {
      return clean;
    }
    break;
  }

  return null;
}
