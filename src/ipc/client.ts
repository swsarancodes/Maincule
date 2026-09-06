import { invoke } from '@tauri-apps/api/core';

export type LineEnding = 'lf' | 'crlf';

export interface FileReadResult {
  text: string;
  path: string;
  hash: string;
  mtime: number;
  line_ending: LineEnding;
  has_bom: boolean;
  final_newline: boolean;
}

export interface FileWriteResult {
  path: string;
  hash: string;
  mtime: number;
}

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

export async function readFile(path: string): Promise<FileReadResult> {
  if (isTauriEnvironment()) {
    return await invoke<FileReadResult>('read_file', { path });
  }
  throw new Error('Native file reading is only available in the desktop shell.');
}

export async function writeFileAtomic(
  path: string,
  contents: string,
  expectedHash?: string
): Promise<FileWriteResult> {
  if (isTauriEnvironment()) {
    return await invoke<FileWriteResult>('write_file_atomic', {
      path,
      contents,
      expectedHash: expectedHash || null,
    });
  }
  throw new Error('Atomic file writing is only available in the desktop shell.');
}
