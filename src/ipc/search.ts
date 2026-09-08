import { invoke } from '@tauri-apps/api/core';
import { isTauriEnvironment } from './client';

export interface VaultSearchHit {
  path: string;
  rel: string;
  title: string;
  snippet: string;
  line: number;
  rank: number;
}

/** Rebuild the on-disk FTS5 index from the current vault scan. */
export async function rebuildSearchIndex(): Promise<number> {
  if (!isTauriEnvironment()) throw new Error('Vault search needs the desktop shell');
  return invoke<number>('rebuild_search_index');
}

/** Full-text search across all vault files on disk (closed files included). */
export async function searchVault(query: string, limit = 30): Promise<VaultSearchHit[]> {
  if (!isTauriEnvironment()) return [];
  if (!query.trim()) return [];
  try {
    return await invoke<VaultSearchHit[]>('search_vault', { query, limit });
  } catch (e) {
    // FTS syntax or missing index must never break the modal —
    // the caller falls back to in-memory search.
    console.warn('Vault search failed, falling back:', e);
    return [];
  }
}

/** Incremental upsert after a save / external reload (fire-and-forget). */
export async function upsertSearchPath(path: string): Promise<void> {
  if (!isTauriEnvironment() || !path) return;
  try {
    await invoke('upsert_search_path', { path });
  } catch (e) {
    console.warn('Search upsert failed:', e);
  }
}

/** Remove a trashed / deleted path from the index (fire-and-forget). */
export async function removeSearchPath(path: string): Promise<void> {
  if (!isTauriEnvironment() || !path) return;
  try {
    await invoke('remove_search_path', { path });
  } catch (e) {
    console.warn('Search remove failed:', e);
  }
}
