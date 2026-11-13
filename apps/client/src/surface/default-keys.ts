import { shortcut } from '@adecore/ui';

/*
 * The key every rebindable row has out of the box, by row id. The id is a command id (`shell/command-table.ts`), and a
 * test holds that. Apart from the table so the terminal keymap can read the keys without loading the stores behind it.
 * The editor's and the language commands' keys are the platform's own, in the one table the editor binds (`editor-keymap.ts`).
 */
export const DEFAULT_KEYS = {
    palette: shortcut('Mod+K'),
    'find-in-files': shortcut('Mod+Shift+F'),
    settings: shortcut('Mod+,'),
    // The key beside the one of Settings.
    'project-settings': shortcut('Mod+;'),
    // Only while the settings dialog is up, where it stands in for the canvas's find.
    'settings-search': shortcut('Mod+F'),
    sidebar: shortcut('Mod+B'),
    // The desktop app's own; a browser keeps it for a private window.
    'window-new': shortcut('Mod+Shift+N'),
    // Alt+N alone is the canvas's note, and Mod+N a browser keeps for itself.
    'chat-new': shortcut('Mod+Alt+N'),
    dictation: shortcut('Mod+Shift+D'),
    'voice-control': shortcut('Mod+Shift+M'),
    'split-right': shortcut('Mod+\\'),
    'split-down': shortcut('Mod+Shift+\\'),
    'close-cell': shortcut('Mod+W'),
    'cell-maximize': shortcut('Mod+Shift+Enter'),
    'view-new': shortcut('Mod+T'),
    'panel-toggle': shortcut('Mod+Alt+B'),
    // S for schedule: Mod+Alt+R runs the chosen launch.
    routines: shortcut('Mod+Alt+S'),
    'flag-toggle': shortcut('Mod+Alt+F'),
    'launch-run': shortcut('Mod+Alt+R'),
    'launch-stop': shortcut('Mod+Alt+.'),
    prompts: shortcut('Mod+Shift+P'),
    'needs-you-next': shortcut('Mod+Alt+P'),
    'attention-queue': shortcut('Mod+Alt+Shift+P'),
    'tab-previous': shortcut('Ctrl+Shift+Tab'),
    'tab-next': shortcut('Ctrl+Tab'),
    'tab-move-left': shortcut('Mod+Alt+Shift+ArrowLeft'),
    'tab-move-right': shortcut('Mod+Alt+Shift+ArrowRight'),
    'view-previous': shortcut('Mod+Shift+['),
    'view-next': shortcut('Mod+Shift+]'),
    'camera-back': shortcut('Mod+Alt+['),
    'camera-forward': shortcut('Mod+Alt+]'),
    'edit-undo': shortcut('Mod+Z'),
    'edit-redo': shortcut('Mod+Shift+Z'),
    'group-selection': shortcut('Mod+G'),
    'zoom-reset': shortcut('Mod+0'),
    'chat-text-larger': shortcut('Mod++'),
    'chat-text-smaller': shortcut('Mod+-'),
    fit: shortcut('Shift+1'),
    'zoom-selection': shortcut('Shift+2'),
    'zoom-node': shortcut('Mod+Shift+2'),
    find: shortcut('Mod+F'),
    'find-replace': shortcut('Mod+Shift+H'),
    'chat-effort-up': shortcut('Mod+Shift+.'),
    'chat-effort-down': shortcut('Mod+Shift+,'),
    'focus-left': shortcut('Mod+Alt+ArrowLeft'),
    'focus-right': shortcut('Mod+Alt+ArrowRight'),
    'focus-up': shortcut('Mod+Alt+ArrowUp'),
    'focus-down': shortcut('Mod+Alt+ArrowDown'),
    'node-left': shortcut('Alt+ArrowLeft'),
    'node-right': shortcut('Alt+ArrowRight'),
    'node-up': shortcut('Alt+ArrowUp'),
    'node-down': shortcut('Alt+ArrowDown'),
    'add-terminal': shortcut('Alt+T'),
    'add-chat': shortcut('Alt+C'),
    'add-browser': shortcut('Alt+B'),
    'add-group': shortcut('Alt+G'),
    'add-note': shortcut('Alt+N')
} as const;

export type DefaultKeyId = keyof typeof DEFAULT_KEYS;

export function hasDefaultKey(id: string): id is DefaultKeyId {
    return Object.hasOwn(DEFAULT_KEYS, id);
}
