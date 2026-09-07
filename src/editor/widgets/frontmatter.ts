import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { detectFrontmatter, formatFrontmatterValue } from '../../core/markdown/frontmatter';

/**
 * Front-matter panel (B7). Renders the doc-leading `---` / `+++` / `{...}`
 * block as a summary + per-key inputs. Stateless per ADR-007: every edit
 * dispatches a span-scoped transaction touching only that key's value bytes.
 */
export class FrontmatterWidget extends MarkdownWidget {
  override nodeName = 'Frontmatter';

  eq(other: FrontmatterWidget): boolean {
    return super.eq(other);
  }

  updateDOM(): boolean {
    // Inputs commit on change/blur; rebuild on external doc edits is safe.
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'as-frontmatter';
    container.setAttribute('contenteditable', 'false');
    Object.assign(container.style, {
      border: '1px solid var(--as-border)',
      borderRadius: 'var(--as-radius-sm, 6px)',
      backgroundColor: 'var(--as-bg-subtle)',
      margin: '8px 0',
      fontSize: '13px',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);

    const fm = detectFrontmatter(view.state.doc.toString());
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      color: 'var(--as-text-muted)',
      borderBottom: fm && fm.keys.length > 0 ? '1px solid var(--as-border)' : 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const badge = document.createElement('span');
    badge.textContent = fm ? fm.format.toUpperCase() : 'FRONTMATTER';
    Object.assign(badge.style, {
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.06em',
      padding: '2px 6px',
      borderRadius: '4px',
      backgroundColor: 'var(--as-bg-surface)',
      border: '1px solid var(--as-border)',
    } satisfies Partial<CSSStyleDeclaration>);
    header.appendChild(badge);

    const sub = document.createElement('span');
    const count = fm?.keys.length ?? 0;
    sub.textContent = count === 1 ? '1 key' : `${count} keys`;
    header.appendChild(sub);
    container.appendChild(header);

    if (fm) {
      for (const entry of fm.keys) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px',
        } satisfies Partial<CSSStyleDeclaration>);

        const label = document.createElement('span');
        label.textContent = entry.key;
        Object.assign(label.style, {
          minWidth: '90px',
          maxWidth: '40%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--as-text-muted)',
          fontFamily: 'var(--as-font-mono)',
          fontSize: '12px',
        } satisfies Partial<CSSStyleDeclaration>);
        row.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = entry.value;
        input.setAttribute('aria-label', `Front matter key ${entry.key}`);
        Object.assign(input.style, {
          flex: '1',
          minWidth: '0',
          backgroundColor: 'var(--as-bg-surface)',
          color: 'var(--as-text)',
          border: '1px solid var(--as-border)',
          borderRadius: '4px',
          padding: '3px 8px',
          fontSize: '13px',
          fontFamily: 'inherit',
          outline: 'none',
        } satisfies Partial<CSSStyleDeclaration>);

        const commit = () => {
          const next = input.value;
          if (next === entry.value) return;
          // Re-resolve against live doc state (offsets shift as the user types).
          const liveText = view.state.doc.toString();
          const live = detectFrontmatter(liveText);
          const liveEntry = live?.keys.find((k) => k.key === entry.key);
          if (!live || !liveEntry) return;
          view.dispatch({
            changes: {
              from: liveEntry.valueFrom,
              to: liveEntry.valueTo,
              insert: formatFrontmatterValue(live, liveEntry, next),
            },
          });
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            (e.target as HTMLInputElement).value = entry.value;
            (e.target as HTMLInputElement).blur();
          }
        });
        row.appendChild(input);
        container.appendChild(row);
      }
    }

    return container;
  }
}
