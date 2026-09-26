import { shortcut } from '@ruimte/ui/shortcut';

/* The shortcuts `app-shortcuts.ts` binds, apart from the handler so the terminal keymap can read them without the stores. */
export const APP_SHORTCUTS = {
    palette: shortcut('Mod+K'),
    findInFiles: shortcut('Mod+Shift+F'),
    settings: shortcut('Mod+,'),
    // Only while the settings dialog is up, where it stands in for the canvas's find.
    settingsSearch: shortcut('Mod+F'),
    sidebar: shortcut('Mod+B')
} as const;

/*
 * What a browser tab never hands to a page, so the web client does not print them in its menu; the
 * row still works with a click. Checked in a tab only, and a browser may keep more.
 */
export const BROWSER_KEEPS = [shortcut('Mod+W'), shortcut('Mod+T'), shortcut('Mod+N')] as const;
