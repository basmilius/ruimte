import { shortcut } from '@ruimte/ui/shortcut';

/* The keys of the find field; they only act while it has the keyboard, like the arrows in a list. */
export const FIND_SHORTCUTS = {
    next: shortcut('Enter'),
    previous: shortcut('Shift+Enter'),
    close: shortcut('Escape')
} as const;
