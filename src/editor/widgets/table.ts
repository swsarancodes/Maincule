import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { createBlockMenu } from './block-actions';

export type ColumnAlign = 'left' | 'center' | 'right';

export interface ParsedTable {
  headers: string[];
  alignments: ColumnAlign[];
  rows: string[][];
}

/**
 * Splits a markdown table row by pipes while respecting escaped pipes and inline code spans.
 */
export function splitTableRow(line: string): string[] {
  let clean = line.trim();
  if (clean.startsWith('|')) clean = clean.slice(1);
  if (clean.endsWith('|')) clean = clean.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let inCode = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
    } else if (ch === '\\' && i + 1 < clean.length && clean[i + 1] === '|') {
      current += '\\|';
      i++;
    } else if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseMarkdownTable(source: string): ParsedTable | null {
  const lines = source.trim().split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = splitTableRow(lines[0]);
  const alignRow = splitTableRow(lines[1]);
  if (headers.length === 0 || alignRow.length === 0) return null;

  const alignments: ColumnAlign[] = alignRow.map((a) => {
    const left = a.startsWith(':');
    const right = a.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  // Ensure alignments array matches headers length
  while (alignments.length < headers.length) alignments.push('left');

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = splitTableRow(lines[i]);
    // Normalize row length to match headers
    while (cells.length < headers.length) cells.push('');
    rows.push(cells.slice(0, headers.length));
  }

  return { headers, alignments: alignments.slice(0, headers.length), rows };
}

export function serializeMarkdownTable(table: ParsedTable): string {
  const { headers, alignments, rows } = table;
  const colCount = headers.length;
  if (colCount === 0) return '';

  // Compute column widths
  const widths: number[] = new Array(colCount).fill(3);
  for (let c = 0; c < colCount; c++) {
    widths[c] = Math.max(widths[c], (headers[c] || '').length);
    for (const row of rows) {
      widths[c] = Math.max(widths[c], (row[c] || '').length);
    }
  }

  // Header line
  const headerStr = '| ' + headers.map((h, i) => (h || '').padEnd(widths[i], ' ')).join(' | ') + ' |';

  // Delimiter line
  const delimiterStr =
    '| ' +
    alignments
      .map((align, i) => {
        const w = Math.max(3, widths[i]);
        if (align === 'center') return ':' + '-'.repeat(w - 2) + ':';
        if (align === 'right') return '-'.repeat(w - 1) + ':';
        return ':' + '-'.repeat(w - 1);
      })
      .join(' | ') +
    ' |';

  // Body lines
  const rowStrs = rows.map(
    (r) =>
      '| ' +
      r
        .map((cell, i) => {
          const w = widths[i];
          const align = alignments[i];
          const val = cell || '';
          if (align === 'center') {
            const padTotal = w - val.length;
            const padLeft = Math.floor(padTotal / 2);
            return ' '.repeat(padLeft) + val + ' '.repeat(padTotal - padLeft);
          }
          if (align === 'right') return val.padStart(w, ' ');
          return val.padEnd(w, ' ');
        })
        .join(' | ') +
      ' |'
  );

  return [headerStr, delimiterStr, ...rowStrs].join('\n');
}

interface TableWidgetState {
  widget: TableWidget;
  mode: 'visual' | 'split' | 'code';
  onDocUpdate: (newSource: string) => void;
}

export class TableWidget extends MarkdownWidget {
  override nodeName = 'Table';

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const state = (dom as any).__tableState as TableWidgetState | undefined;
    if (state) {
      state.widget = this;
      state.onDocUpdate(this.source);
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'as-table-container';

    let currentMode: 'visual' | 'split' | 'code' = 'visual';
    let currentSource = this.source;
    let parsed = parseMarkdownTable(currentSource);
    let isRebuildingDOM = false;

    // Helper: Safely commit active text from currently focused cell
    const commitActiveCell = () => {
      if (!parsed) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && visualWrapper.contains(activeEl)) {
        if (activeEl.tagName === 'TH' && activeEl.classList.contains('as-table-cell-header')) {
          const allTh = Array.from(visualWrapper.querySelectorAll('thead th.as-table-cell-header'));
          const colIdx = allTh.indexOf(activeEl);
          if (colIdx >= 0 && colIdx < parsed.headers.length) {
            const nextHeaders = [...parsed.headers];
            nextHeaders[colIdx] = (activeEl.textContent || '').replace(/\r?\n/g, ' ');
            parsed = { ...parsed, headers: nextHeaders };
          }
        } else if (activeEl.tagName === 'TD' && activeEl.classList.contains('as-table-cell-data')) {
          const allTr = Array.from(visualWrapper.querySelectorAll('tbody tr:not(.as-table-empty-tr)'));
          for (let rI = 0; rI < allTr.length; rI++) {
            const allTd = Array.from(allTr[rI].querySelectorAll('td.as-table-cell-data'));
            const colIdx = allTd.indexOf(activeEl);
            if (colIdx >= 0 && rI < parsed.rows.length && colIdx < parsed.rows[rI].length) {
              const text = (activeEl.textContent || '').replace(/\r?\n/g, ' ');
              const nextRows = parsed.rows.map((r, i) =>
                i === rI ? r.map((c, j) => (j === colIdx ? text : c)) : [...r]
              );
              parsed = { ...parsed, rows: nextRows };
              break;
            }
          }
        }
      }
    };

    // Helper: Centralized update dispatcher
    const dispatchUpdate = (newTable: ParsedTable) => {
      parsed = newTable;
      const serialized = serializeMarkdownTable(newTable);
      currentSource = serialized;
      textarea.value = serialized;
      stateObj.widget.replace(view, serialized, container);
    };

    // 1. Toolbar Header
    const bar = document.createElement('div');
    bar.className = 'as-table-toolbar';

    const left = document.createElement('div');
    left.className = 'as-table-badge-group';
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    left.style.position = 'relative';

    // Block menu badge: "Table ▾" -> Move up / Move down / Delete
    const self = this;
    const blockMenu = createBlockMenu({
      view,
      getWidget: () => self,
      dom: container,
      label: 'Table',
    });
    blockMenu.badgeBtn.classList.add('as-table-badge');
    left.appendChild(blockMenu.badgeBtn);
    left.appendChild(blockMenu.menu);

    // Mode Buttons: Visual | Split | Code
    const modeBtnGroup = document.createElement('div');
    modeBtnGroup.className = 'as-widget-btn-group';

    const visualBtn = document.createElement('button');
    visualBtn.className = 'as-widget-btn as-widget-btn-active';
    visualBtn.textContent = 'Visual';

    const splitBtn = document.createElement('button');
    splitBtn.className = 'as-widget-btn';
    splitBtn.textContent = 'Split';

    const codeBtn = document.createElement('button');
    codeBtn.className = 'as-widget-btn';
    codeBtn.textContent = 'Code';

    modeBtnGroup.appendChild(visualBtn);
    modeBtnGroup.appendChild(splitBtn);
    modeBtnGroup.appendChild(codeBtn);
    left.appendChild(modeBtnGroup);
    bar.appendChild(left);

    const actions = document.createElement('div');
    actions.className = 'as-table-actions';

    // Row / Col manipulation buttons
    const addRowBtn = document.createElement('button');
    addRowBtn.textContent = '+ Row';
    addRowBtn.className = 'as-widget-btn';
    addRowBtn.title = 'Add a new row at bottom';
    addRowBtn.onclick = (e) => {
      e.stopPropagation();
      commitActiveCell();
      if (!parsed) return;
      const updated: ParsedTable = {
        ...parsed,
        rows: [...parsed.rows, new Array(parsed.headers.length).fill('')],
      };
      dispatchUpdate(updated);
      renderVisualTable();
      setTimeout(() => {
        const lastRowFirstCell = visualWrapper.querySelector<HTMLElement>('tbody tr:last-child td.as-table-cell-data');
        lastRowFirstCell?.focus();
      }, 20);
    };
    actions.appendChild(addRowBtn);

    const removeRowBtn = document.createElement('button');
    removeRowBtn.textContent = '- Row';
    removeRowBtn.className = 'as-widget-btn as-widget-btn-subtle';
    removeRowBtn.title = 'Remove the bottom row';
    removeRowBtn.onclick = (e) => {
      e.stopPropagation();
      commitActiveCell();
      if (!parsed || parsed.rows.length === 0) return;
      const updated: ParsedTable = {
        ...parsed,
        rows: parsed.rows.slice(0, -1),
      };
      dispatchUpdate(updated);
      renderVisualTable();
    };
    actions.appendChild(removeRowBtn);

    const addColBtn = document.createElement('button');
    addColBtn.textContent = '+ Col';
    addColBtn.className = 'as-widget-btn';
    addColBtn.title = 'Add a new column at right';
    addColBtn.onclick = (e) => {
      e.stopPropagation();
      commitActiveCell();
      if (!parsed) return;
      const updated: ParsedTable = {
        headers: [...parsed.headers, `Col ${parsed.headers.length + 1}`],
        alignments: [...parsed.alignments, 'left'],
        rows: parsed.rows.map((r) => [...r, '']),
      };
      dispatchUpdate(updated);
      renderVisualTable();
    };
    actions.appendChild(addColBtn);

    const removeColBtn = document.createElement('button');
    removeColBtn.textContent = '- Col';
    removeColBtn.className = 'as-widget-btn as-widget-btn-subtle';
    removeColBtn.title = 'Remove the rightmost column';
    removeColBtn.onclick = (e) => {
      e.stopPropagation();
      commitActiveCell();
      if (!parsed || parsed.headers.length <= 1) return;
      const updated: ParsedTable = {
        headers: parsed.headers.slice(0, -1),
        alignments: parsed.alignments.slice(0, -1),
        rows: parsed.rows.map((r) => r.slice(0, -1)),
      };
      dispatchUpdate(updated);
      renderVisualTable();
    };
    actions.appendChild(removeColBtn);

    const formatBtn = document.createElement('button');
    formatBtn.textContent = 'Format';
    formatBtn.className = 'as-widget-btn as-widget-btn-subtle';
    formatBtn.title = 'Beautify and align table markdown columns';
    formatBtn.onclick = (e) => {
      e.stopPropagation();
      commitActiveCell();
      const currentParsed = parseMarkdownTable(textarea.value) || parsed;
      if (currentParsed) {
        dispatchUpdate(currentParsed);
        renderVisualTable();
      }
    };
    actions.appendChild(formatBtn);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.className = 'as-widget-btn as-widget-btn-subtle';
    copyBtn.title = 'Copy table Markdown to clipboard';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(currentSource);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    };
    actions.appendChild(copyBtn);

    bar.appendChild(actions);
    container.appendChild(bar);

    // 2. Main Content Wrapper (Supports Visual, Split, or Code)
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'as-table-content-wrapper';

    // Code Editor Wrapper
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'as-table-editor-wrapper';
    editorWrapper.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.className = 'as-table-textarea';
    textarea.value = currentSource;
    textarea.spellcheck = false;
    textarea.placeholder = '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |';

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    textarea.addEventListener('input', (e) => {
      e.stopPropagation();
      const rawText = textarea.value;
      currentSource = rawText;

      // Update parsed visual preview in real-time if in Split mode
      const maybeParsed = parseMarkdownTable(rawText);
      if (maybeParsed) {
        parsed = maybeParsed;
        renderVisualTable();
      }

      // Debounced writeback to CodeMirror buffer
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        stateObj.widget.replace(view, rawText, container);
      }, 350);
    });

    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        textarea.dispatchEvent(new Event('input'));
      } else if (e.key === 'Escape') {
        currentMode = 'visual';
        stateObj.mode = 'visual';
        updateModeUI();
        view.focus();
      }
    });

    editorWrapper.appendChild(textarea);
    contentWrapper.appendChild(editorWrapper);

    // Visual Table Area
    const visualWrapper = document.createElement('div');
    visualWrapper.className = 'as-table-visual-wrapper';
    contentWrapper.appendChild(visualWrapper);

    container.appendChild(contentWrapper);

    // Cell keyboard navigation helper
    const navigateCells = (currentEl: HTMLElement, shift: boolean) => {
      const allCells = Array.from(
        visualWrapper.querySelectorAll<HTMLElement>('th.as-table-cell-header[contenteditable="true"], td.as-table-cell-data[contenteditable="true"]')
      );
      const idx = allCells.indexOf(currentEl);
      if (idx === -1) return;

      if (shift) {
        if (idx > 0) {
          allCells[idx - 1].focus();
        }
      } else {
        if (idx < allCells.length - 1) {
          allCells[idx + 1].focus();
        }
      }
    };

    // Render HTML Table DOM from parsed structure
    const renderVisualTable = () => {
      isRebuildingDOM = true;
      visualWrapper.innerHTML = '';

      if (!parsed) {
        isRebuildingDOM = false;
        const errorBox = document.createElement('div');
        errorBox.className = 'as-table-fallback-note';
        errorBox.innerHTML = `
          <div style="padding: 16px; color: var(--as-text-muted); font-size: 13px;">
            Markdown table cannot be parsed. Switch to <strong>Code</strong> mode to edit raw syntax.
          </div>
        `;
        visualWrapper.appendChild(errorBox);
        return;
      }

      const tableEl = document.createElement('table');
      tableEl.className = 'as-table';

      // Header
      const thead = document.createElement('thead');
      const headerTr = document.createElement('tr');
      parsed.headers.forEach((h, colIdx) => {
        const th = document.createElement('th');
        th.className = 'as-table-cell-header';
        th.style.textAlign = parsed?.alignments[colIdx] || 'left';
        th.contentEditable = 'true';
        th.spellcheck = false;
        th.textContent = h;

        th.onblur = () => {
          if (isRebuildingDOM || !th.isConnected || !parsed) return;
          if (colIdx >= parsed.headers.length) return;
          const newText = (th.textContent || '').replace(/\r?\n/g, ' ');
          if (newText !== parsed.headers[colIdx]) {
            const nextHeaders = [...parsed.headers];
            nextHeaders[colIdx] = newText;
            dispatchUpdate({ ...parsed, headers: nextHeaders });
          }
        };

        th.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            // Move focus to first row cell in this column
            const targetTd = visualWrapper.querySelector<HTMLElement>(
              `tbody tr:first-child td.as-table-cell-data:nth-child(${colIdx + 1})`
            );
            if (targetTd) targetTd.focus();
            else th.blur();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const targetTd = visualWrapper.querySelector<HTMLElement>(
              `tbody tr:first-child td.as-table-cell-data:nth-child(${colIdx + 1})`
            );
            targetTd?.focus();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            navigateCells(th, e.shiftKey);
          }
        };

        headerTr.appendChild(th);
      });

      // Header action column
      const actionTh = document.createElement('th');
      actionTh.className = 'as-table-th-actions';
      actionTh.title = 'Row actions';
      headerTr.appendChild(actionTh);

      thead.appendChild(headerTr);
      tableEl.appendChild(thead);

      // Body
      const tbody = document.createElement('tbody');

      if (parsed.rows.length === 0) {
        const emptyTr = document.createElement('tr');
        emptyTr.className = 'as-table-empty-tr';
        const emptyTd = document.createElement('td');
        emptyTd.className = 'as-table-empty-td';
        emptyTd.colSpan = parsed.headers.length + 1;
        emptyTd.innerHTML = 'No rows yet. Click <strong>+ Row</strong> to add data.';
        emptyTr.appendChild(emptyTd);
        tbody.appendChild(emptyTr);
      } else {
        parsed.rows.forEach((row, rowIdx) => {
          const tr = document.createElement('tr');
          row.forEach((cell, colIdx) => {
            const td = document.createElement('td');
            td.className = 'as-table-cell-data';
            td.style.textAlign = parsed?.alignments[colIdx] || 'left';
            td.contentEditable = 'true';
            td.spellcheck = false;
            td.textContent = cell;

            td.onblur = () => {
              if (isRebuildingDOM || !td.isConnected || !parsed) return;
              if (!parsed.rows[rowIdx] || colIdx >= parsed.rows[rowIdx].length) return;
              const newText = (td.textContent || '').replace(/\r?\n/g, ' ');
              if (newText !== parsed.rows[rowIdx][colIdx]) {
                const nextRows = parsed.rows.map((r, rI) =>
                  rI === rowIdx ? r.map((c, cI) => (cI === colIdx ? newText : c)) : [...r]
                );
                dispatchUpdate({ ...parsed, rows: nextRows });
              }
            };

            td.onkeydown = (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                // Move to next row in same column if available
                const nextRowTd = visualWrapper.querySelector<HTMLElement>(
                  `tbody tr:nth-child(${rowIdx + 2}) td.as-table-cell-data:nth-child(${colIdx + 1})`
                );
                if (nextRowTd) {
                  nextRowTd.focus();
                } else {
                  td.blur();
                }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextRowTd = visualWrapper.querySelector<HTMLElement>(
                  `tbody tr:nth-child(${rowIdx + 2}) td.as-table-cell-data:nth-child(${colIdx + 1})`
                );
                nextRowTd?.focus();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (rowIdx === 0) {
                  const targetTh = visualWrapper.querySelector<HTMLElement>(
                    `thead tr th.as-table-cell-header:nth-child(${colIdx + 1})`
                  );
                  targetTh?.focus();
                } else {
                  const prevRowTd = visualWrapper.querySelector<HTMLElement>(
                    `tbody tr:nth-child(${rowIdx}) td.as-table-cell-data:nth-child(${colIdx + 1})`
                  );
                  prevRowTd?.focus();
                }
              } else if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const isLastCell = !parsed || (rowIdx === parsed.rows.length - 1 && colIdx === row.length - 1);
                if (!e.shiftKey && isLastCell && parsed) {
                  // Commit current cell text before appending new row
                  const currentText = (td.textContent || '').replace(/\r?\n/g, ' ');
                  const nextRows = parsed.rows.map((r, rI) =>
                    rI === rowIdx ? r.map((c, cI) => (cI === colIdx ? currentText : c)) : [...r]
                  );
                  const updated: ParsedTable = {
                    ...parsed,
                    rows: [...nextRows, new Array(parsed.headers.length).fill('')],
                  };
                  dispatchUpdate(updated);
                  renderVisualTable();
                  setTimeout(() => {
                    const newFirstCell = visualWrapper.querySelector<HTMLElement>('tbody tr:last-child td.as-table-cell-data');
                    newFirstCell?.focus();
                  }, 20);
                } else {
                  navigateCells(td, e.shiftKey);
                }
              }
            };

            tr.appendChild(td);
          });

          // Row action buttons cell
          const actionTd = document.createElement('td');
          actionTd.className = 'as-table-cell-actions';
          actionTd.contentEditable = 'false';

          const insertBelowBtn = document.createElement('button');
          insertBelowBtn.className = 'as-table-row-action-btn';
          insertBelowBtn.textContent = '+';
          insertBelowBtn.title = 'Insert row below';
          insertBelowBtn.onclick = (e) => {
            e.stopPropagation();
            commitActiveCell();
            if (!parsed) return;
            const nextRows = [...parsed.rows];
            nextRows.splice(rowIdx + 1, 0, new Array(parsed.headers.length).fill(''));
            dispatchUpdate({ ...parsed, rows: nextRows });
            renderVisualTable();
            setTimeout(() => {
              const targetCell = visualWrapper.querySelector<HTMLElement>(
                `tbody tr:nth-child(${rowIdx + 2}) td.as-table-cell-data`
              );
              targetCell?.focus();
            }, 20);
          };

          const delRowBtn = document.createElement('button');
          delRowBtn.className = 'as-table-row-action-btn as-table-row-action-del';
          delRowBtn.textContent = '✕';
          delRowBtn.title = 'Delete this row';
          delRowBtn.onclick = (e) => {
            e.stopPropagation();
            commitActiveCell();
            if (!parsed || parsed.rows.length === 0) return;
            const nextRows = parsed.rows.filter((_, i) => i !== rowIdx);
            dispatchUpdate({ ...parsed, rows: nextRows });
            renderVisualTable();
          };

          actionTd.appendChild(insertBelowBtn);
          actionTd.appendChild(delRowBtn);
          tr.appendChild(actionTd);

          tbody.appendChild(tr);
        });
      }

      tableEl.appendChild(tbody);
      visualWrapper.appendChild(tableEl);
      isRebuildingDOM = false;
    };

    // Update Mode UI
    const updateModeUI = () => {
      container.dataset.mode = currentMode;
      visualBtn.className = currentMode === 'visual' ? 'as-widget-btn as-widget-btn-active' : 'as-widget-btn';
      splitBtn.className = currentMode === 'split' ? 'as-widget-btn as-widget-btn-active' : 'as-widget-btn';
      codeBtn.className = currentMode === 'code' ? 'as-widget-btn as-widget-btn-active' : 'as-widget-btn';

      if (currentMode === 'visual') {
        editorWrapper.style.display = 'none';
        visualWrapper.style.display = 'block';
        contentWrapper.className = 'as-table-content-wrapper';
        parsed = parseMarkdownTable(currentSource);
        renderVisualTable();
      } else if (currentMode === 'code') {
        editorWrapper.style.display = 'flex';
        visualWrapper.style.display = 'none';
        contentWrapper.className = 'as-table-content-wrapper';
        textarea.value = currentSource;
        setTimeout(() => textarea.focus(), 50);
      } else if (currentMode === 'split') {
        editorWrapper.style.display = 'flex';
        visualWrapper.style.display = 'block';
        contentWrapper.className = 'as-table-content-wrapper as-table-split';
        textarea.value = currentSource;
        parsed = parseMarkdownTable(currentSource);
        renderVisualTable();
        setTimeout(() => textarea.focus(), 50);
      }
    };

    visualBtn.onclick = (e) => {
      e.stopPropagation();
      currentMode = 'visual';
      stateObj.mode = 'visual';
      updateModeUI();
    };

    splitBtn.onclick = (e) => {
      e.stopPropagation();
      currentMode = 'split';
      stateObj.mode = 'split';
      updateModeUI();
    };

    codeBtn.onclick = (e) => {
      e.stopPropagation();
      currentMode = 'code';
      stateObj.mode = 'code';
      updateModeUI();
    };

    // State object attached to container to support updateDOM
    const stateObj: TableWidgetState = {
      widget: this,
      mode: currentMode,
      onDocUpdate: (newSource: string) => {
        if (newSource !== currentSource) {
          currentSource = newSource;
          if (document.activeElement !== textarea && textarea.value !== currentSource) {
            textarea.value = currentSource;
          }
          const nextParsed = parseMarkdownTable(newSource);
          if (nextParsed) {
            parsed = nextParsed;
            const activeIsCell = visualWrapper.contains(document.activeElement);
            if (!activeIsCell) {
              renderVisualTable();
            }
          }
        }
      },
    };
    (container as any).__tableState = stateObj;

    // Initial render
    renderVisualTable();

    return container;
  }
}
