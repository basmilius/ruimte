import type { SplitDirection } from '@/shell/split';
import type { NodeKind } from '@/state/canvas';
import { shortcut, type Shortcut } from '@basmilius/desktop-ui';

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
    launchRun: shortcut('Mod+Alt+R'),
    launchStop: shortcut('Mod+Alt+.'),
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
    findReplace: shortcut('Mod+Shift+H'),
    nextProblem: shortcut('Alt+F8'),
    previousProblem: shortcut('Alt+Shift+F8'),
    // Mod+Alt+Up and Down are the grid's, so stepping through problems and uses of a name takes a function key.
    nextHighlight: shortcut('Alt+F3'),
    previousHighlight: shortcut('Alt+Shift+F3'),
    codeActions: shortcut('Mod+.'),
    quickInfo: shortcut('Mod+J'),
    triggerCompletion: shortcut('Ctrl+Space'),
    parameterInfo: shortcut('Ctrl+Shift+Space'),
    historyBack: shortcut('Mod+['),
    historyForward: shortcut('Mod+]'),
    recentLocations: shortcut('Mod+E'),
    goToDefinition: shortcut('Alt+Shift+D'),
    goToTypeDefinition: shortcut('Alt+Shift+T'),
    goToImplementation: shortcut('Alt+Shift+I'),
    goToSymbol: shortcut('Mod+Shift+O'),
    peekReferences: shortcut('Alt+F7'),
    rename: shortcut('Alt+Shift+R'),
    organizeImports: shortcut('Alt+Shift+O'),
    formatDocument: shortcut('Alt+Shift+F'),
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
export function viewShortcut(index: number): Shortcut | undefined {
    return VIEW_SHORTCUTS[index];
}
