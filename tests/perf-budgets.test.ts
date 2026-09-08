import { describe, test, expect } from 'bun:test';
import { computeWordCount } from '../src/app/stores/workspace';
import { searchWorkspace } from '../src/core/search/full-text-search';
import { createDocumentState } from '../src/core/document/document';

describe('perf budgets (loose guards, catch regressions)', () => {
  test('word count on 10k-line doc stays well under frame budget', () => {
    const line = 'hello world foo bar baz qux '.repeat(8);
    const big = Array.from({ length: 10_000 }, () => line).join('\n');
    const start = performance.now();
    const n = computeWordCount(big);
    const ms = performance.now() - start;
    expect(n).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });

  test('in-memory search over 100 docs stays fast', () => {
    const docs = Array.from({ length: 100 }, (_, i) =>
      createDocumentState(`# Note ${i}\n\nsome filler text needle-${i % 10}\n`.repeat(20), null)
    );
    const start = performance.now();
    const res = searchWorkspace(docs, 'needle-3');
    const ms = performance.now() - start;
    expect(res.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  });
});
