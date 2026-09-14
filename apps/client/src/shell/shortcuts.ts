import { shortcut } from '@/ui/shortcut';

/* The shortcuts `app-shortcuts.ts` binds, apart from the handler so the terminal keymap can read them without the stores. */
export const APP_SHORTCUTS = {
    palette: shortcut('Mod+K'),
    findInFiles: shortcut('Mod+Shift+F'),
    settings: shortcut('Mod+,'),
    sidebar: shortcut('Mod+B')
} as const;
