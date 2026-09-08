import { describe, test, expect } from 'bun:test';
import { searchVault, rebuildSearchIndex } from '../src/ipc/search';

// Outside the Tauri shell (bun/happy-dom), vault search must degrade
// gracefully: empty results, never a modal-breaking throw (except rebuild
// which explicitly requires the shell).
describe('vault FTS fallback (browser build)', () => {
  test('searchVault returns [] without Tauri', async () => {
    const hits = await searchVault('hello');
    expect(hits).toEqual([]);
  });

  test('searchVault empty query returns []', async () => {
    const hits = await searchVault('   ');
    expect(hits).toEqual([]);
  });

  test('rebuildSearchIndex throws outside Tauri', async () => {
    let threw = false;
    try {
      await rebuildSearchIndex();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
