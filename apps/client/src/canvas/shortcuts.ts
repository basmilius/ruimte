import type { SplitDirection } from '@/shell/split';
import type { NodeKind } from '@/state/canvas';
import { shortcut, type Shortcut } from '@/ui/shortcut';

/*
 * The shortcuts `canvas-shortcuts.ts` binds, in a module of their own so a menu, the palette, the Keyboard
 * pane and the terminal keymap can print or test them without loading the stores behind the handler.
 */
export const CANVAS_SHORTCUTS = {
    splitRight: shortcut('Mod+\\'),
    splitDown: shortcut('Mod+Shift+\\'),
    closeCell: shortcut('Mod+W'),
    newView: shortcut('Mod+T'),
    togglePanel: shortcut('Mod+Alt+B'),
    previousView: shortcut('Mod+Shift+['),
    nextView: shortcut('Mod+Shift+]'),
    undo: shortcut('Mod+Z'),
    redo: shortcut('Mod+Shift+Z'),
    group: shortcut('Mod+G'),
    selectAll: shortcut('Mod+A'),
    zoomReset: shortcut('Mod+0'),
    fitAll: shortcut('Shift+1'),
    zoomSelection: shortcut('Shift+2'),
    deleteSelection: shortcut('Backspace'),
    zoomIn: shortcut('+'),
    zoomOut: shortcut('-')
} as const;

export const ADD_NODE_SHORTCUTS = {
    terminal: shortcut('Alt+T'),
    chat: shortcut('Alt+C'),
    browser: shortcut('Alt+B'),
    group: shortcut('Alt+G'),
    note: shortcut('Alt+N')
} as const satisfies Partial<Record<NodeKind, Shortcut>>;

export const FOCUS_SHORTCUTS: Record<SplitDirection, Shortcut> = {
    left: shortcut('Mod+Alt+ArrowLeft'),
    right: shortcut('Mod+Alt+ArrowRight'),
    up: shortcut('Mod+Alt+ArrowUp'),
    down: shortcut('Mod+Alt+ArrowDown')
};

export const VIEW_SHORTCUTS: readonly Shortcut[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => shortcut(`Mod+${number}`));

/* The shortcut of the view at a zero-based index, or undefined past the ninth. */
export const viewShortcut = (index: number): Shortcut | undefined => VIEW_SHORTCUTS[index];
