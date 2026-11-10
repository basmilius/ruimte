import { shortcut } from '@adecore/ui';

/*
 * What a browser tab never hands to a page, so the web client does not print them in its menu; the
 * row still works with a click. Checked in a tab only, and a browser may keep more.
 */
export const BROWSER_KEEPS = [shortcut('Mod+W'), shortcut('Mod+T'), shortcut('Mod+N'), shortcut('Mod+Shift+Delete')] as const;
