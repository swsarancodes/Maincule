import { EditorView } from '@codemirror/view';
import { MarkdownWidget } from './base';
import { createBlockMenu } from './block-actions';

export class HRWidget extends MarkdownWidget {
  override nodeName = 'HorizontalRule';

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const state = (dom as any).__hrState as { widget: HRWidget } | undefined;
    if (state) {
      state.widget = this;
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'as-hr-wrap';
    container.style.position = 'relative';

    const hr = document.createElement('hr');
    hr.className = 'as-hr-divider';
    container.appendChild(hr);

    // Hover block menu: "― Divider ▾" -> Move up / Move down / Delete
    const self = this;
    const blockMenu = createBlockMenu({
      view,
      getWidget: () => self,
      dom: container,
      label: '― Divider',
    });
    blockMenu.badgeBtn.classList.add('as-hr-badge');
    container.appendChild(blockMenu.badgeBtn);
    container.appendChild(blockMenu.menu);

    (container as any).__hrState = { widget: this };
    return container;
  }
}
