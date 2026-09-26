import type { SplitDirection } from '@/shell/split';
import type { NodeKind } from '@/state/canvas';
import { shortcut, type Shortcut } from '@ruimte/ui/shortcut';

/*
 * The shortcuts `canvas-shortcuts.ts` binds, in a module of their own so a menu, the palette, the Keyboard
 * pane and the terminal keymap can print or test them without loading the stores behind the handler.
 */
export const CANVAS_SHORTCUTS = {
    dictation: shortcut('Mod+Shift+D'),
    voiceControl: shortcut('Mod+Shift+M'),
    splitRight: shortcut('Mod+\\'),
    splitDown: shortcut('Mod+Shift+\\'),
    closeCell: shortcut('Mod+W'),
    maximizeCell: shortcut('Mod+Shift+Enter'),
    newView: shortcut('Mod+T'),
    togglePanel: shortcut('Mod+Alt+B'),
    toggleFlag: shortcut('Mod+Alt+F'),
    focusPrompts: shortcut('Mod+Shift+P'),
    previousView: shortcut('Mod+Shift+['),
    nextView: shortcut('Mod+Shift+]'),
    browserBack: shortcut('Mod+['),
    browserForward: shortcut('Mod+]'),
    undo: shortcut('Mod+Z'),
    redo: shortcut('Mod+Shift+Z'),
    group: shortcut('Mod+G'),
    selectAll: shortcut('Mod+A'),
    zoomReset: shortcut('Mod+0'),
    fitAll: shortcut('Shift+1'),
    zoomSelection: shortcut('Shift+2'),
    deleteSelection: shortcut('Backspace'),
    zoomIn: shortcut('+'),
    zoomOut: shortcut('-'),
    find: shortcut('Mod+F'),
    previousMessage: shortcut('Alt+ArrowUp'),
    nextMessage: shortcut('Alt+ArrowDown')
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
