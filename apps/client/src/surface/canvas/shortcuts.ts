import { shortcut, type Shortcut } from '@adecore/ui';
import type { NodeKind } from '@/state/canvas';
import type { DefaultKeyId } from '@/surface/default-keys';

/*
 * The keys of the workspace that no one rebinds, in a module of their own so a menu, the palette, the Keyboard pane and
 * the terminal keymap can print or test them without loading the stores behind the handler. A key a person may rebind is
 * a row of the command table (`commands/registry.ts`) with its default in `surface/default-keys.ts`.
 */
export const CANVAS_SHORTCUTS = {
    browserBack: shortcut('Mod+['),
    browserForward: shortcut('Mod+]'),
    selectAll: shortcut('Mod+A'),
    deleteSelection: shortcut('Backspace'),
    zoomIn: shortcut('+'),
    zoomOut: shortcut('-'),
    previousMessage: shortcut('Alt+ArrowUp'),
    nextMessage: shortcut('Alt+ArrowDown')
} as const;

/* The row whose key adds a node of each kind. */
export const ADD_NODE_ROWS = {
    terminal: 'add-terminal',
    chat: 'add-chat',
    browser: 'add-browser',
    group: 'add-group',
    note: 'add-note'
} as const satisfies Partial<Record<NodeKind, DefaultKeyId>>;

export const VIEW_SHORTCUTS: readonly Shortcut[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => shortcut(`Mod+${number}`));

/* The shortcut of the view at a zero-based index, or undefined past the ninth. */
export function viewShortcut(index: number): Shortcut | undefined {
    return VIEW_SHORTCUTS[index];
}
