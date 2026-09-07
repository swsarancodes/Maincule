/**
 * Front-matter detection + single-key editing (pure, no React).
 *
 * B7 contract (docs/04-feature-spec.md):
 * - Detects `---` (YAML), `+++` (TOML), `{` (JSON) as the FIRST block only.
 * - Editing one key leaves every other byte untouched (line-scoped replace).
 * - Key order is never changed.
 * - A body `---` later in the document is never mistaken for front matter.
 * - Malformed blocks render as raw text (detection returns null).
 */

export type FrontmatterFormat = 'yaml' | 'toml' | 'json';

export interface FrontmatterKey {
  key: string;
  /** Display value (unquoted best-effort). */
  value: string;
  /** Absolute offsets of the whole source line (excludes line break). */
  lineFrom: number;
  lineTo: number;
  /** Absolute offsets of just the value token within the line. */
  valueFrom: number;
  valueTo: number;
}

export interface DetectedFrontmatter {
  format: FrontmatterFormat;
  /** Absolute offsets of the whole block (from 0, includes trailing newline). */
  from: number;
  to: number;
  raw: string;
  keys: FrontmatterKey[];
}

interface LineInfo {
  text: string;
  from: number;
  to: number;
}

/** Advance past one line break (LF or CRLF) at pos. */
function consumeNewline(text: string, pos: number): number {
  if (text[pos] === '\r' && text[pos + 1] === '\n') return pos + 2;
  if (text[pos] === '\n' || text[pos] === '\r') return pos + 1;
  return pos;
}

/** Split offset-0 text into lines with absolute offsets (handles LF + CRLF). */
function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    let line = parts[i];
    let nl = 1; // the '\n' we split on (present for every line but the last)
    if (i === parts.length - 1) nl = 0;
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    lines.push({ text: line, from: offset, to: offset + line.length });
    offset += parts[i].length + nl;
  }
  return lines;
}

function parseScalarKeys(
  lines: LineInfo[],
  startIdx: number,
  endIdx: number,
  sep: ':' | '=',
  format: FrontmatterFormat
): FrontmatterKey[] {
  const keys: FrontmatterKey[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const { text, from } = lines[i];
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sepIdx = text.indexOf(sep);
    // ':' must not be the URL-ish `http://` case — require it before any space-run value
    if (sepIdx <= 0) continue;
    const rawKey = text.slice(0, sepIdx).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(rawKey)) continue;
    let valueStart = sepIdx + 1;
    while (valueStart < text.length && (text[valueStart] === ' ' || text[valueStart] === '\t')) {
      valueStart++;
    }
    let valueEnd = text.length;
    while (valueEnd > valueStart && (text[valueEnd - 1] === ' ' || text[valueEnd - 1] === '\t')) {
      valueEnd--;
    }
    // Strip a trailing comment for display only (bytes preserved — edits keep it).
    const commentIdx = text.indexOf('#', valueStart);
    if (commentIdx !== -1 && commentIdx < valueEnd) {
      const before = text.slice(valueStart, commentIdx);
      if (/(^|\s)$/.test(before) || before.endsWith(' ') || before.endsWith('\t')) {
        valueEnd = commentIdx;
        while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd--;
      }
    }
    let value = text.slice(valueStart, valueEnd);
    // Unquote one layer for display.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    void format;
    keys.push({
      key: rawKey,
      value,
      lineFrom: from,
      lineTo: from + text.length,
      valueFrom: from + valueStart,
      valueTo: from + valueEnd,
    });
  }
  return keys;
}

function parseJsonKeys(lines: LineInfo[], startIdx: number, endIdx: number): FrontmatterKey[] {
  const keys: FrontmatterKey[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const { text, from } = lines[i];
    const m = text.match(/^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*/);
    if (!m) continue;
    const valueStart = from + m[0].length;
    const rest = text.slice(m[0].length);
    // Scalar on one line: string / number / true / false / null.
    const vm = rest.match(/^("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
    if (!vm) continue;
    let value = vm[1];
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    }
    keys.push({
      key: m[2],
      value,
      lineFrom: from,
      lineTo: from + text.length,
      valueFrom: valueStart,
      valueTo: valueStart + vm[1].length,
    });
  }
  return keys;
}

/**
 * Detect a front-matter block at the very start of the document.
 * Returns null for malformed blocks (caller renders raw text).
 */
export function detectFrontmatter(text: string): DetectedFrontmatter | null {
  if (!text) return null;
  // Limit the scan: front matter lives at the top; cap work on huge docs.
  const head = text.length > 8192 ? text.slice(0, 8192) : text;
  const lines = splitLines(head);
  if (lines.length === 0) return null;
  const first = lines[0].text;

  if (first.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].text.trim();
      if (t === '---' || t === '...') {
        const to = consumeNewline(text, lines[i].to);
        return {
          format: 'yaml',
          from: 0,
          to,
          raw: text.slice(0, to),
          keys: parseScalarKeys(lines, 1, i, ':', 'yaml'),
        };
      }
    }
    return null; // unclosed -> raw text
  }

  if (first.trim() === '+++') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].text.trim() === '+++') {
        const to = consumeNewline(text, lines[i].to);
        return {
          format: 'toml',
          from: 0,
          to,
          raw: text.slice(0, to),
          keys: parseScalarKeys(lines, 1, i, '=', 'toml'),
        };
      }
    }
    return null;
  }

  if (first.trimStart().startsWith('{')) {
    // JSON front matter: first line opens `{`, a later line is exactly `}`.
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].text.trim();
      if (t === '}' || t === '};') {
        const to = consumeNewline(text, lines[i].to);
        const raw = text.slice(0, to);
        try {
          JSON.parse(raw);
        } catch {
          return null; // malformed -> raw text
        }
        return { format: 'json', from: 0, to, raw, keys: parseJsonKeys(lines, 0, i + 1) };
      }
    }
    return null;
  }

  return null;
}

/**
 * Format a replacement value for a detected key, preserving quote style.
 * Exported so widgets can dispatch span-scoped transactions (ADR-007).
 */
export function formatFrontmatterValue(
  fm: DetectedFrontmatter,
  entry: FrontmatterKey,
  newValue: string
): string {
  const line = fm.raw.slice(entry.lineFrom - fm.from, entry.lineTo - fm.from);
  const relFrom = entry.valueFrom - entry.lineFrom;
  const relTo = entry.valueTo - entry.lineFrom;
  const current = line.slice(relFrom, relTo);
  if (fm.format === 'json') return JSON.stringify(newValue);
  if (current.startsWith('"') && current.endsWith('"') && current.length >= 2) {
    return `"${newValue.replace(/"/g, '\\"')}"`;
  }
  if (current.startsWith("'") && current.endsWith("'") && current.length >= 2) {
    return `'${newValue.replace(/'/g, "''")}'`;
  }
  return newValue;
}

/**
 * Replace a single key's value, preserving every other byte:
 * indentation, quoting style, trailing comments, key order, line endings.
 * Returns the original text when the key is missing or not scalar-editable.
 */
export function updateFrontmatterKey(text: string, key: string, newValue: string): string {
  const fm = detectFrontmatter(text);
  if (!fm) return text;
  const entry = fm.keys.find((k) => k.key === key);
  if (!entry) return text;
  const replacement = formatFrontmatterValue(fm, entry, newValue);
  const line = text.slice(entry.lineFrom, entry.lineTo);
  const relFrom = entry.valueFrom - entry.lineFrom;
  const relTo = entry.valueTo - entry.lineFrom;
  const newLine = line.slice(0, relFrom) + replacement + line.slice(relTo);
  return text.slice(0, entry.lineFrom) + newLine + text.slice(entry.lineTo);
}

/** Offset just past the front-matter block, or 0 when absent. */
export function frontmatterEnd(text: string): number {
  return detectFrontmatter(text)?.to ?? 0;
}
