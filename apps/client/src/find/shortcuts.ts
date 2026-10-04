import { shortcut } from '@basmilius/desktop-ui';

/* The keys of the find field; they only act while it has the keyboard, like the arrows in a list. */
export const FIND_SHORTCUTS = {
    next: shortcut('Enter'),
    previous: shortcut('Shift+Enter'),
    close: shortcut('Escape'),
    /* In the replace field, where Enter replaces one. */
    replaceAll: shortcut('Mod+Enter')
} as const;
