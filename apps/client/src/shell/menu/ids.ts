/* The commands only the menu has; `actions.ts` holds a handler for each. */
export const MENU_ACTION_IDS = [
    'about',
    'project-settings',
    'palette',
    'edit-undo',
    'edit-redo',
    'fullscreen',
    'terminal-clear',
    'close-cell',
    'split-right',
    'split-down',
    'panel-devices',
    'panel-toggle',
    'view-previous',
    'view-next',
    'focus-left',
    'focus-right',
    'focus-up',
    'focus-down',
    'prompts',
    'release-notes',
    'models',
    'view-fork',
    'view-open-in-chat',
    'view-open-in-terminal',
    'view-duplicate',
    'view-put-on-canvas',
    'view-reveal',
    'view-share',
    'view-settings'
] as const;

export type MenuActionId = (typeof MENU_ACTION_IDS)[number];

/* The commands the menu borrows from the palette (`appCommands()` in `shell/commands.ts`), run by the same row. */
export const PALETTE_IDS = [
    'open-folder',
    'reveal',
    'find',
    'find-in-files',
    'view-new',
    'view-new-drawing',
    'view-new-diagram',
    'view-new-file',
    'view-new-terminal',
    'view-new-browser',
    'view-new-separator',
    'view-new-subheader',
    'view-promote',
    'view-delete',
    'add-terminal',
    'add-chat',
    'add-browser',
    'add-group',
    'add-note',
    'add-file',
    'add-text',
    'group-selection',
    'layout-save',
    'lock',
    'fit',
    'zoom-selection',
    'zoom-reset',
    'diagram-open-json',
    'diagram-show-on-canvas',
    'diagram-copy-json',
    'diagram-copy-png',
    'diagram-save-png',
    'diagram-copy-svg',
    'diagram-save-svg',
    'drawing-show-on-canvas',
    'drawing-copy-png',
    'drawing-save-png',
    'drawing-copy-svg',
    'drawing-save-svg',
    'usage',
    'sidebar',
    'panel-files',
    'panel-git',
    'panel-processes',
    'theme',
    'settings',
    'settings-keyboard',
    'settings-machines'
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

/* The palette rows that exist once per agent CLI, layout or target view, and the menu's own row per view. */
export const PALETTE_PREFIXES = [
    'agent-chat-',
    'agent-terminal-',
    'agent-view-chat-',
    'agent-view-terminal-',
    'layout-apply-',
    'layout-delete-',
    'view-move-'
] as const;

export const GO_VIEW_PREFIX = 'go-view-';

export const isPaletteId = (id: string): boolean => (PALETTE_IDS as readonly string[]).includes(id) || PALETTE_PREFIXES.some((prefix) => id.startsWith(prefix));
