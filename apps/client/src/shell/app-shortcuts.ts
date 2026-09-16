import { useEffect } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { focusedCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { matchesShortcut, type KeyLike } from '@/ui/shortcut';

/*
 * The shortcuts that belong to the window rather than to a project. Each opens a surface that floats
 * over the workspace and the start screen alike (the palette, the settings, the window's own sidebar),
 * so they are bound once on `window` and are the same key wherever the focus sits.
 *
 * Everything a shortcut can do to the project (switch views, add a node, undo, zoom, the panel beside
 * it) is not in here: those live in `canvas/canvas-shortcuts.ts`, which the workspace binds, so the
 * start screen has none of them.
 */
export type AppShortcut = 'palette' | 'find-in-files' | 'settings' | 'sidebar';

export interface ShortcutContext {
    /* The keyboard is inside a node, which is what keeps Ctrl+B out of readline's way off macOS. */
    inNode: boolean;
    apple: boolean;
}

/*
 * Which window shortcut a keystroke is, or null for every other key. There is no guard on what has the
 * focus: these work from anywhere, a focused node or a text field included. A focused terminal is the
 * exception, and it stops the shortcuts it owns before this listener (`terminal/keymap.ts`).
 */
export const appShortcutFor = (e: KeyLike, { inNode, apple }: ShortcutContext): AppShortcut | null => {
    if (matchesShortcut(APP_SHORTCUTS.palette, e, apple)) {
        return 'palette';
    }
    if (matchesShortcut(APP_SHORTCUTS.findInFiles, e, apple)) {
        return 'find-in-files';
    }
    if (matchesShortcut(APP_SHORTCUTS.settings, e, apple)) {
        return 'settings';
    }
    // Ctrl+B is readline's backward-char and tmux's prefix, so off macOS it stays out of a node.
    if (matchesShortcut(APP_SHORTCUTS.sidebar, e, apple) && (apple || !inNode)) {
        return 'sidebar';
    }
    return null;
};

/* What a window shortcut does, for the key and for a button that offers the same thing. */
export const runAppShortcut = (shortcut: AppShortcut): void => {
    const ui = useUi.getState();
    if (shortcut === 'palette') {
        if (ui.paletteOpen) {
            ui.setPaletteOpen(false);
        } else {
            ui.openPalette();
        }
        return;
    }
    if (shortcut === 'find-in-files') {
        // Find in files opens the palette, which searches whichever workspace has the focus.
        ui.openFindInFiles();
        return;
    }
    if (shortcut === 'settings') {
        ui.setSettings({ open: true });
        return;
    }
    ui.toggleSidebar();
};

/* Mounted once by the app; a second listener would toggle the palette open and shut again. */
export const useAppShortcuts = (): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const shortcut = appShortcutFor(e, { inNode: focusedCanvas().getState().mode.kind === 'node', apple: isApplePlatform() });
            if (shortcut === null) {
                return;
            }
            e.preventDefault();
            runAppShortcut(shortcut);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
};
