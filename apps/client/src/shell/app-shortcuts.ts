import { useEffect } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { isInNodeBody } from '@/canvas/node-body';
import { newChat } from '@/project/new-chat';
import { canOpenWindows, openNewWindow } from '@/project/windows';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useUi } from '@/state/ui';
import { matchesShortcut, type KeyLike } from '@basmilius/desktop-ui';

// Window shortcuts also work on the start screen; project shortcuts are bound by the workspace.
export type AppShortcut = 'palette' | 'find-in-files' | 'settings' | 'settings-search' | 'sidebar' | 'new-window' | 'new-chat';

export interface ShortcutContext {
    /* The keyboard is inside a node's content, which is what keeps Ctrl+B out of readline's way off macOS. */
    inNode: boolean;
    apple: boolean;
    settingsOpen: boolean;
    /* The shell opens windows of its own; only the desktop app does. */
    windows?: boolean;
}

/*
 * Which window shortcut a keystroke is, or null for every other key. There is no guard on what has the
 * focus: these work from anywhere, a node's content or a text field included. A focused terminal is the
 * exception, and it stops the shortcuts it owns before this listener (`terminal/keymap.ts`).
 */
export function appShortcutFor(e: KeyLike, { inNode, apple, settingsOpen, windows = false }: ShortcutContext): AppShortcut | null {
    if (matchesShortcut(APP_SHORTCUTS.palette, e, apple)) {
        return 'palette';
    }
    if (matchesShortcut(APP_SHORTCUTS.findInFiles, e, apple)) {
        return 'find-in-files';
    }
    if (matchesShortcut(APP_SHORTCUTS.settings, e, apple)) {
        return 'settings';
    }
    if (settingsOpen && matchesShortcut(APP_SHORTCUTS.settingsSearch, e, apple)) {
        return 'settings-search';
    }
    if (windows && matchesShortcut(APP_SHORTCUTS.newWindow, e, apple)) {
        return 'new-window';
    }
    if (matchesShortcut(APP_SHORTCUTS.newChat, e, apple)) {
        return 'new-chat';
    }
    // Ctrl+B is readline's backward-char and tmux's prefix, so off macOS it stays out of a node.
    if (matchesShortcut(APP_SHORTCUTS.sidebar, e, apple) && (apple || !inNode)) {
        return 'sidebar';
    }
    return null;
}

/* What a window shortcut does, for the key and for a button that offers the same thing. */
export function runAppShortcut(shortcut: AppShortcut): void {
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
    if (shortcut === 'settings-search') {
        ui.setSettings({ open: true, searchAt: ui.settings.searchAt + 1 });
        return;
    }
    if (shortcut === 'new-window') {
        openNewWindow();
        return;
    }
    if (shortcut === 'new-chat') {
        newChat();
        return;
    }
    ui.toggleSidebar();
}

/* Mounted once by the app; a second listener would toggle the palette open and shut again. */
export function useAppShortcuts(): void {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const shortcut = appShortcutFor(e, {
                inNode: isInNodeBody(e.target),
                apple: isApplePlatform(),
                settingsOpen: useUi.getState().settings.open,
                windows: canOpenWindows()
            });
            if (shortcut === null) {
                return;
            }
            e.preventDefault();
            runAppShortcut(shortcut);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
