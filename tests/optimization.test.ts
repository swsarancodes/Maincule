import { expect, test, describe, beforeAll } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { computeWordCount, computeReadingTime, useWorkspaceStore, flushPendingAutoRename } from '../src/app/stores/workspace';
import { parseMarkdownTable, serializeMarkdownTable } from '../src/editor/widgets/table';
import { findInlineSpans } from '../src/editor/decorations/delimiter-guard';
import { formatDisplayName } from '../src/core/document/file-meta';
import { syncDocumentHeading, extractDocumentHeading } from '../src/core/document/document';
import { extractDocumentHeadings, findActiveHeading } from '../src/app/components/DocumentOutline';
import { searchWorkspace } from '../src/core/search/full-text-search';
import { exportToMarkdown, exportToHtml } from '../src/core/document/export';
import { renderMarkdownToHtmlBody } from '../src/core/document/render-html';

beforeAll(() => {
  const window = new GlobalWindow();
  (global as any).window = window;
  (global as any).document = window.document;
});

describe('Fast Word Count & Reading Time', () => {
  test('Empty and whitespace-only strings return 0 words', () => {
    expect(computeWordCount('')).toBe(0);
    expect(computeWordCount('   \t\n\r  ')).toBe(0);
  });

  test('Standard sentence word counting', () => {
    expect(computeWordCount('Hello world')).toBe(2);
    expect(computeWordCount('The quick brown fox jumps over the lazy dog.')).toBe(9);
  });

  test('Handles irregular whitespace and tabs seamlessly', () => {
    expect(computeWordCount('Word1\t\tWord2\n\n\nWord3   Word4')).toBe(4);
  });

  test('Reading time estimation', () => {
    expect(computeReadingTime(0)).toBe(1);
    expect(computeReadingTime(150)).toBe(1);
    expect(computeReadingTime(450)).toBe(3);
  });
});

describe('Line-Scoped Delimiter Guard', () => {
  test('finds inline bold and italic spans with line offset', () => {
    const line = 'A **bold note** with *italic* text';
    const spans = findInlineSpans(line, 100);

    expect(spans.length).toBe(2);
    expect(spans[0].delimiter).toBe('**');
    expect(spans[0].openFrom).toBe(102); // 100 + 2
    expect(spans[0].innerFrom).toBe(104);
    expect(spans[0].innerTo).toBe(113);

    expect(spans[1].delimiter).toBe('*');
    expect(spans[1].openFrom).toBe(121);
  });
});

describe('Interactive Table Serialization & Navigation', () => {
  test('Parses and adds rows losslessly', () => {
    const markdown = '| Name | Age |\n| :--- | ---: |\n| Alice | 30 |';
    const parsed = parseMarkdownTable(markdown);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.headers).toEqual(['Name', 'Age']);
    expect(parsed.rows.length).toBe(1);

    // Append new empty row (Tab at bottom-right)
    const updated = {
      ...parsed,
      rows: [...parsed.rows, ['', '']],
    };
    const serialized = serializeMarkdownTable(updated);
    expect(serialized).toContain('| Alice');
    expect(serialized.split('\n').length).toBe(4); // Header, Delimiter, Row 1, Row 2
  });

  test('Handles escaped pipes and code spans in table rows cleanly', () => {
    const markdown = '| Expression | Description |\n| :--- | :--- |\n| `a \\| b` | Bitwise OR |\n| Plain \\| pipe | Escaped pipe |';
    const parsed = parseMarkdownTable(markdown);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.headers).toEqual(['Expression', 'Description']);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0][0]).toBe('`a \\| b`');
    expect(parsed.rows[0][1]).toBe('Bitwise OR');
    expect(parsed.rows[1][0]).toBe('Plain \\| pipe');
    expect(parsed.rows[1][1]).toBe('Escaped pipe');

    const serialized = serializeMarkdownTable(parsed);
    expect(serialized).toContain('`a \\| b`');
    expect(serialized).toContain('Plain \\| pipe');
  });

  test('Preserves column alignments (left, center, right)', () => {
    const markdown = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| L | C | R |';
    const parsed = parseMarkdownTable(markdown);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.alignments).toEqual(['left', 'center', 'right']);
    const serialized = serializeMarkdownTable(parsed);
    expect(serialized).toMatch(/:\-+\s*\|/); // left
    expect(serialized).toMatch(/:\-+:\s*\|/); // center
    expect(serialized).toMatch(/\s\-+:\s*\|/); // right
  });
});

describe('File Display Name & Rename Sanitization', () => {
  test('formatDisplayName strips .md and .markdown while leaving others intact', () => {
    expect(formatDisplayName('Untitled.md')).toBe('Untitled');
    expect(formatDisplayName('My Notes.markdown')).toBe('My Notes');
    expect(formatDisplayName('Project v1.2.md')).toBe('Project v1.2');
    expect(formatDisplayName('config.json')).toBe('config.json');
    expect(formatDisplayName('')).toBe('Untitled');
  });

  test('renameDocument preserves .md extension when user renames without extension', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument();
    const docId = useWorkspaceStore.getState().activeDocumentId!;
    store.renameDocument(docId, 'Personal Roadmap');
    const updated = useWorkspaceStore.getState().documents.find((d) => d.id === docId);
    expect(updated?.meta.fileName).toBe('Personal Roadmap.md');
    expect(formatDisplayName(updated!.meta.fileName)).toBe('Personal Roadmap');
    expect(updated?.currentText.startsWith('# Personal Roadmap')).toBe(true);
  });

  test('syncDocumentHeading formats heading and preserves rest of content', () => {
    // Empty text
    expect(syncDocumentHeading('', 'My Title')).toBe('# My Title\n\n');
    // Existing heading replaced
    expect(syncDocumentHeading('# Old Heading\n\nBody line 1\nBody line 2', 'New Heading')).toBe(
      '# New Heading\n\nBody line 1\nBody line 2'
    );
    // Preserves YAML frontmatter
    const fmText = '---\ntitle: test\n---\n# Old\n\nBody';
    expect(syncDocumentHeading(fmText, 'Updated Title')).toBe(
      '---\ntitle: test\n---\n# Updated Title\n\nBody'
    );
  });

  test('renaming page A updates heading for page A alone without touching page B', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Page Alpha.md');
    const alphaId = useWorkspaceStore.getState().activeDocumentId!;

    store.createEmptyDocument('Page Beta.md');
    const betaId = useWorkspaceStore.getState().activeDocumentId!;

    expect(useWorkspaceStore.getState().documents.find((d) => d.id === alphaId)?.currentText.startsWith('# Page Alpha')).toBe(true);
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === betaId)?.currentText.startsWith('# Page Beta')).toBe(true);

    // Rename Page Alpha to "Engineering Roadmap"
    store.renameDocument(alphaId, 'Engineering Roadmap');

    const alphaDoc = useWorkspaceStore.getState().documents.find((d) => d.id === alphaId);
    const betaDoc = useWorkspaceStore.getState().documents.find((d) => d.id === betaId);

    // Page Alpha's heading is updated
    expect(alphaDoc?.currentText.startsWith('# Engineering Roadmap')).toBe(true);
    // Page Beta's heading is strictly untouched
    expect(betaDoc?.currentText.startsWith('# Page Beta')).toBe(true);
  });

  test('extractDocumentHeading extracts title from various markdown styles', () => {
    expect(extractDocumentHeading('# My Project Notes\nBody text')).toBe('My Project Notes');
    expect(extractDocumentHeading('# **Bold Title**')).toBe('Bold Title');
    expect(extractDocumentHeading('---\ntitle: YAML\n---\n# Real Title\n\nContent')).toBe('Real Title');
    expect(extractDocumentHeading('No heading at all\nJust text')).toBe('No heading at all');
    expect(extractDocumentHeading('# ')).toBeNull();
    expect(extractDocumentHeading('- List item 1\n- List item 2')).toBeNull();
  });

  test('changing heading inside page reflects back in sidebar document fileName', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument();
    const docId = useWorkspaceStore.getState().activeDocumentId!;
    const initialName = useWorkspaceStore.getState().documents.find((d) => d.id === docId)!.meta.fileName;

    // User types '# Sprint Planning' inside the page — the tab label settles
    // after a pause (debounced), not mid-keystroke.
    store.updateDocumentContent(docId, '# Sprint Planning\n\n- Task 1\n- Task 2');
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)?.meta.fileName).toBe(initialName);

    flushPendingAutoRename();
    const updatedDoc = useWorkspaceStore.getState().documents.find((d) => d.id === docId);
    expect(updatedDoc?.meta.fileName).toBe('Sprint Planning.md');
    expect(formatDisplayName(updatedDoc!.meta.fileName)).toBe('Sprint Planning');

    // Editing body content without changing heading preserves fileName
    store.updateDocumentContent(docId, '# Sprint Planning\n\n- Task 1\n- Task 2\n- Task 3');
    flushPendingAutoRename();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docId)?.meta.fileName).toBe('Sprint Planning.md');
  });

  test('deleteDocument moves document to trash and updates activeDocumentId or creates fresh note', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Doc A.md');
    const docAId = useWorkspaceStore.getState().activeDocumentId!;
    store.createEmptyDocument('Doc B.md');
    const docBId = useWorkspaceStore.getState().activeDocumentId!;

    expect(useWorkspaceStore.getState().documents.some((d) => d.id === docBId)).toBe(true);

    // Soft-delete doc B to trash
    useWorkspaceStore.getState().deleteDocument(docBId);
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === docBId)?.deletedAt).toBeTruthy();
    expect(useWorkspaceStore.getState().documents.filter((d) => !d.deletedAt).some((d) => d.id === docBId)).toBe(false);

    // If all active docs are deleted, a fresh empty doc is created automatically
    const allActiveIds = useWorkspaceStore.getState().documents.filter((d) => !d.deletedAt).map((d) => d.id);
    for (const id of allActiveIds) {
      useWorkspaceStore.getState().deleteDocument(id);
    }
    const remainingActive = useWorkspaceStore.getState().documents.filter((d) => !d.deletedAt);
    expect(remainingActive.length).toBe(1);
    expect(remainingActive[0].meta.fileName).toBe('Untitled-1.md');
  });
});

describe('Hierarchical Folders and Subpages (Notion-Style)', () => {
  test('creates root folders and nested subfolders', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('Engineering');
    const engFolder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Engineering');
    expect(engFolder).toBeDefined();
    expect(engFolder!.parentId).toBeNull();

    // Nested subfolder
    store.createFolder('Frontend', engFolder!.id);
    const feFolder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Frontend');
    expect(feFolder).toBeDefined();
    expect(feFolder!.parentId).toBe(engFolder!.id);
  });

  test('creates notes inside folders and subpages under notes', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('Design');
    const designFolder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Design')!;

    // Note inside folder
    store.createEmptyDocument('Typography.md', designFolder.id);
    const typoDoc = useWorkspaceStore.getState().documents.find((d) => d.meta.fileName === 'Typography.md');
    expect(typoDoc).toBeDefined();
    expect(typoDoc!.parentId).toBe(designFolder.id);

    // Subpage under Typography note
    store.createEmptyDocument('Font Weights.md', typoDoc!.id);
    const subDoc = useWorkspaceStore.getState().documents.find((d) => d.meta.fileName === 'Font Weights.md');
    expect(subDoc).toBeDefined();
    expect(subDoc!.parentId).toBe(typoDoc!.id);
  });

  test('cascades deletion of parent notes to child subpages', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Parent Note.md');
    const parentId = useWorkspaceStore.getState().activeDocumentId!;

    store.createEmptyDocument('Child Subpage 1.md', parentId);
    const child1Id = useWorkspaceStore.getState().activeDocumentId!;

    store.createEmptyDocument('Child Subpage 2.md', parentId);
    const child2Id = useWorkspaceStore.getState().activeDocumentId!;

    expect(useWorkspaceStore.getState().documents.some((d) => d.id === child1Id)).toBe(true);
    expect(useWorkspaceStore.getState().documents.some((d) => d.id === child2Id)).toBe(true);

    // Deleting parent soft-deletes all its child subpages to trash
    useWorkspaceStore.getState().deleteDocument(parentId);
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === parentId)?.deletedAt).toBeTruthy();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === child1Id)?.deletedAt).toBeTruthy();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === child2Id)?.deletedAt).toBeTruthy();
  });

  test('cascades deletion of folders and all contained subfolders & notes', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('Project Alpha');
    const alphaFolder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Project Alpha')!;

    store.createFolder('Alpha Specs', alphaFolder.id);
    const specsFolder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Alpha Specs')!;

    store.createEmptyDocument('Spec 1.md', specsFolder.id);
    const spec1Id = useWorkspaceStore.getState().activeDocumentId!;

    // Delete root folder Alpha (soft-delete to trash)
    useWorkspaceStore.getState().deleteFolder(alphaFolder.id);
    expect(useWorkspaceStore.getState().folders.find((f) => f.id === alphaFolder.id)?.deletedAt).toBeTruthy();
    expect(useWorkspaceStore.getState().folders.find((f) => f.id === specsFolder.id)?.deletedAt).toBeTruthy();
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === spec1Id)?.deletedAt).toBeTruthy();
  });

  test('toggleCollapse expands and collapses IDs', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('Docs');
    const docsFolder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Docs')!;

    expect(useWorkspaceStore.getState().collapsedIds.includes(docsFolder.id)).toBe(false);
    store.toggleCollapse(docsFolder.id);
    expect(useWorkspaceStore.getState().collapsedIds.includes(docsFolder.id)).toBe(true);
    store.toggleCollapse(docsFolder.id);
    expect(useWorkspaceStore.getState().collapsedIds.includes(docsFolder.id)).toBe(false);
  });
});

describe('Document Outline & Headings Parser', () => {
  test('extractDocumentHeadings extracts all heading levels with correct line numbers', () => {
    const markdown = `# Architecture Overview
Some intro text

## Component Design
Paragraph here

### Data Layer
- Point 1
- Point 2

#### Subsystem Alpha
Details

# Deployment`;

    const headings = extractDocumentHeadings(markdown);
    expect(headings.length).toBe(5);

    expect(headings[0].text).toBe('Architecture Overview');
    expect(headings[0].level).toBe(1);
    expect(headings[0].line).toBe(1);

    expect(headings[1].text).toBe('Component Design');
    expect(headings[1].level).toBe(2);
    expect(headings[1].line).toBe(4);

    expect(headings[2].text).toBe('Data Layer');
    expect(headings[2].level).toBe(3);
    expect(headings[2].line).toBe(7);

    expect(headings[3].text).toBe('Subsystem Alpha');
    expect(headings[3].level).toBe(4);
    expect(headings[3].line).toBe(11);

    expect(headings[4].text).toBe('Deployment');
    expect(headings[4].level).toBe(1);
    expect(headings[4].line).toBe(14);
  });

  test('extractDocumentHeadings skips comments and code blocks', () => {
    const markdown = `# Real Heading 1

\`\`\`typescript
# Not a heading
const x = '# Also not a heading';
\`\`\`

## Real Heading 2`;

    const headings = extractDocumentHeadings(markdown);
    expect(headings.length).toBe(2);
    expect(headings[0].text).toBe('Real Heading 1');
    expect(headings[1].text).toBe('Real Heading 2');
  });

  test('extractDocumentHeadings cleans inline formatting like bold, italic, and code', () => {
    const markdown = `# **Bold** and *Italic* and \`Code\` Heading`;
    const headings = extractDocumentHeadings(markdown);
    expect(headings.length).toBe(1);
    expect(headings[0].text).toBe('Bold and Italic and Code Heading');
  });

  test('extractDocumentHeadings returns empty array for empty document', () => {
    expect(extractDocumentHeadings('')).toEqual([]);
    expect(extractDocumentHeadings('Just plain paragraphs\nNo headings at all')).toEqual([]);
  });

  test('findActiveHeading determines active section based on scroll/cursor line', () => {
    const headings = [
      { id: 'h-1', level: 1, text: 'Introduction', line: 1, pos: 0 },
      { id: 'h-2', level: 2, text: 'Architecture', line: 15, pos: 150 },
      { id: 'h-3', level: 2, text: 'API Specs', line: 40, pos: 450 },
    ];

    expect(findActiveHeading([], 10)).toBeNull();
    // Line 1 is Introduction
    expect(findActiveHeading(headings, 1)?.text).toBe('Introduction');
    // Line 10 (between Intro and Architecture) is Introduction
    expect(findActiveHeading(headings, 10)?.text).toBe('Introduction');
    // Line 15 is Architecture
    expect(findActiveHeading(headings, 15)?.text).toBe('Architecture');
    // Line 25 is Architecture
    expect(findActiveHeading(headings, 25)?.text).toBe('Architecture');
    // Line 45 is API Specs
    expect(findActiveHeading(headings, 45)?.text).toBe('API Specs');
  });
});

describe('Full-Text Workspace Search Engine', () => {
  const mockDocs: any[] = [
    {
      id: 'doc-1',
      meta: { fileName: 'Meeting Notes.md' },
      currentText: '# Meeting Notes\nDiscussed Q3 roadmap and Apollo engine integration.\nApproved budget.',
    },
    {
      id: 'doc-2',
      meta: { fileName: 'Architecture.md' },
      currentText: '# Architecture\nFrontend uses CodeMirror 6 with hybrid markdown parsing.\nNo Apollo references here.',
    },
    {
      id: 'doc-3',
      meta: { fileName: 'Apollo Roadmap.md' },
      currentText: '# Apollo Project\nApollo launcher specs and release date.',
    },
  ];

  test('searchWorkspace finds body text matches with line numbers and snippets', () => {
    const results = searchWorkspace(mockDocs, 'CodeMirror');
    expect(results.length).toBe(1);
    expect(results[0].docId).toBe('doc-2');
    expect(results[0].snippets.length).toBe(1);
    expect(results[0].snippets[0].line).toBe(2);
    expect(results[0].snippets[0].snippet).toContain('CodeMirror');
  });

  test('searchWorkspace performs case-insensitive search', () => {
    const lowerResults = searchWorkspace(mockDocs, 'apollo');
    const upperResults = searchWorkspace(mockDocs, 'APOLLO');
    expect(lowerResults.length).toBe(upperResults.length);
    expect(lowerResults.length).toBe(3);
  });

  test('searchWorkspace prioritizes title matches', () => {
    const results = searchWorkspace(mockDocs, 'Apollo');
    expect(results[0].docId).toBe('doc-3'); // 'Apollo Roadmap.md' has title match
    expect(results[0].titleMatches).toBe(true);
  });

  test('searchWorkspace returns empty array for blank query', () => {
    expect(searchWorkspace(mockDocs, '')).toEqual([]);
    expect(searchWorkspace(mockDocs, '   ')).toEqual([]);
  });
});

describe('Sidebar Tree Drag and Drop & moveItem', () => {
  test('moveItem moves note into folder and back to root', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('Engineering');
    const folder = useWorkspaceStore.getState().folders.find((f) => f.name === 'Engineering')!;

    store.createEmptyDocument('Sprint Planning.md', null);
    const docId = useWorkspaceStore.getState().activeDocumentId!;

    // Move doc into folder
    useWorkspaceStore.getState().moveItem(docId, folder.id);
    const movedDoc = useWorkspaceStore.getState().documents.find((d) => d.id === docId)!;
    expect(movedDoc.parentId).toBe(folder.id);

    // Move doc back to root
    useWorkspaceStore.getState().moveItem(docId, null);
    const rootDoc = useWorkspaceStore.getState().documents.find((d) => d.id === docId)!;
    expect(rootDoc.parentId).toBeNull();
  });

  test('moveItem moves note to become a subpage of another note', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Parent Note.md', null);
    const parentId = useWorkspaceStore.getState().activeDocumentId!;

    store.createEmptyDocument('Child Note.md', null);
    const childId = useWorkspaceStore.getState().activeDocumentId!;

    useWorkspaceStore.getState().moveItem(childId, parentId);
    const childDoc = useWorkspaceStore.getState().documents.find((d) => d.id === childId)!;
    expect(childDoc.parentId).toBe(parentId);
  });

  test('moveItem prevents moving folder into its own descendant', () => {
    const store = useWorkspaceStore.getState();
    store.createFolder('Folder A');
    const folderA = useWorkspaceStore.getState().folders.find((f) => f.name === 'Folder A')!;

    store.createFolder('Folder B', folderA.id);
    const folderB = useWorkspaceStore.getState().folders.find((f) => f.name === 'Folder B')!;

    // Try to move folder A into its own child folder B (cycle!)
    useWorkspaceStore.getState().moveItem(folderA.id, folderB.id);
    const folderAAfter = useWorkspaceStore.getState().folders.find((f) => f.id === folderA.id)!;
    expect(folderAAfter.parentId).toBeNull(); // remains at root
  });
});

describe('Export Utilities (Markdown, HTML, PDF)', () => {
  test('exportToMarkdown creates download anchor with correct filename', () => {
    let clickedHref = '';
    let clickedDownload = '';

    const origCreateElement = document.createElement.bind(document);
    document.createElement = (tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        el.click = () => {
          clickedHref = el.getAttribute('href') || '';
          clickedDownload = el.getAttribute('download') || '';
        };
      }
      return el;
    };

    exportToMarkdown('Design Specs', '# Hello World');
    expect(clickedDownload).toBe('Design Specs.md');
    expect(clickedHref).toBeDefined();

    document.createElement = origCreateElement;
  });

  test('exportToHtml creates download anchor with html extension', async () => {
    let clickedDownload = '';

    const origCreateElement = document.createElement.bind(document);
    document.createElement = (tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        el.click = () => {
          clickedDownload = el.getAttribute('download') || '';
        };
      }
      return el;
    };

    await exportToHtml('Release Notes.md', '# Release v0.2.0');
    expect(clickedDownload).toBe('Release Notes.html');

    document.createElement = origCreateElement;
  });
});

describe('HTML export renderer (F1)', () => {
  test('renders headings, tables, and task lists', async () => {
    const body = await renderMarkdownToHtmlBody(
      '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n'
    );
    expect(body).toContain('<h1>Title</h1>');
    expect(body).toContain('<table>');
    expect(body).toContain('task-list-item');
  });

  test('strips front matter from the rendered body', async () => {
    const body = await renderMarkdownToHtmlBody('---\ntitle: Secret\n---\n\n# Visible\n');
    expect(body).not.toContain('Secret');
    expect(body).toContain('<h1>Visible</h1>');
  });

  test('raw HTML stays inert (no live script in output)', async () => {
    const body = await renderMarkdownToHtmlBody('# T\n<script>alert(1)</script>\n');
    expect(body).not.toContain('<script>');
  });

  test('math renders as MathML without external assets', async () => {
    const body = await renderMarkdownToHtmlBody('Euler: $e^{i\\pi}$\n');
    expect(body).toContain('<math');
    expect(body).not.toContain('katex.min.css');
  });

  test('mermaid fences fall back to code blocks', async () => {
    const body = await renderMarkdownToHtmlBody('```mermaid\nflowchart TD\n```\n');
    expect(body).toContain('flowchart TD');
  });
});

describe('Trash & Recovery Bin', () => {
  test('restoreItem restores soft-deleted document back to active list', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Important Note.md', null);
    const noteId = useWorkspaceStore.getState().activeDocumentId!;

    // Soft-delete
    useWorkspaceStore.getState().deleteDocument(noteId);
    expect(useWorkspaceStore.getState().documents.find((d) => d.id === noteId)?.deletedAt).toBeTruthy();

    // Restore
    useWorkspaceStore.getState().restoreItem(noteId);
    const restoredDoc = useWorkspaceStore.getState().documents.find((d) => d.id === noteId)!;
    expect(restoredDoc.deletedAt).toBeNull();
    expect(useWorkspaceStore.getState().activeDocumentId).toBe(noteId);
  });

  test('permanentDeleteItem removes item completely from store', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Ephemeral Note.md', null);
    const noteId = useWorkspaceStore.getState().activeDocumentId!;

    useWorkspaceStore.getState().permanentDeleteItem(noteId);
    expect(useWorkspaceStore.getState().documents.some((d) => d.id === noteId)).toBe(false);
  });

  test('emptyTrash wipes all soft-deleted documents and folders', () => {
    const store = useWorkspaceStore.getState();
    store.createEmptyDocument('Trash Me.md', null);
    const noteId = useWorkspaceStore.getState().activeDocumentId!;
    useWorkspaceStore.getState().deleteDocument(noteId);

    expect(useWorkspaceStore.getState().documents.some((d) => d.deletedAt)).toBe(true);
    useWorkspaceStore.getState().emptyTrash();
    expect(useWorkspaceStore.getState().documents.some((d) => d.deletedAt)).toBe(false);
  });
});

