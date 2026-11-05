import type { KeyLike } from '@adecore/ui';
import { useEffect } from 'react';
import { isInNodeBody } from '@/canvas/node-body';
import { isApplePlatform } from '@/desktop/bridge';
import { runActionShortcut } from '@/extensions/action-shortcuts';
import { newChat } from '@/project/new-chat';
import { canOpenWindows, openNewWindow } from '@/project/windows';
import { commandForKey, type WindowCommandId } from '@/shell/command-table';
import { countCommand } from '@/shell/command-usage';
import { useUi } from '@/state/ui';

// Window shortcuts also work on the start screen; project shortcuts are bound by the workspace.
type AppShortcut = WindowCommandId;

interface ShortcutContext {
    /* The keyboard is inside a node's content, which is what keeps Ctrl+B out of readline's way off macOS. */
    inNode: boolean;
    apple: boolean;
    settingsOpen: boolean;
    /* The shell opens windows of its own; only the desktop app does. */
    windows?: boolean;
}

/*
 * Which window shortcut a keystroke is, or null for every other key: the command table's rows this
 * listener binds. There is no guard on what has the focus: these work from anywhere, a node's content or
 * a text field included. A focused terminal is the exception, and it stops the shortcuts it owns before
 * this listener (`terminal/keymap.ts`).
 */
export function appShortcutFor(e: KeyLike, { inNode, apple, settingsOpen, windows = false }: ShortcutContext): AppShortcut | null {
    const command = commandForKey('window', e, apple);
    if ((command === 'settings-search' && !settingsOpen) || (command === 'window-new' && !windows)) {
        return null;
    }
    // Ctrl+B is readline's backward-char and tmux's prefix, so off macOS it stays out of a node.
    if (command === 'sidebar' && !apple && inNode) {
        return null;
    }
    return command;
}

function togglePalette(): void {
    const ui = useUi.getState();
    if (ui.paletteOpen) {
        ui.setPaletteOpen(false);
    } else {
        ui.openPalette();
    }
}

const WINDOW_SHORTCUTS: Record<AppShortcut, () => void> = {
    palette: togglePalette,
    // Find in files opens the palette, which searches whichever workspace has the focus.
    'find-in-files': () => useUi.getState().openFindInFiles(),
    settings: () => useUi.getState().setSettings({ open: true }),
    'settings-search': () => useUi.getState().setSettings({ open: true, searchAt: useUi.getState().settings.searchAt + 1 }),
    'window-new': openNewWindow,
    'chat-new': newChat,
    sidebar: () => useUi.getState().toggleSidebar()
};

/* What a window shortcut does, for the key and for a button that offers the same thing. */
export function runAppShortcut(shortcut: AppShortcut): void {
    WINDOW_SHORTCUTS[shortcut]();
}

/* Mounted once by the app; a second listener would toggle the palette open and shut again. */
export function useAppShortcuts(): void {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            // A key something on the page already acted on is that thing's, such as Run all in a database console.
            if (e.defaultPrevented) {
                return;
            }
            const shortcut = appShortcutFor(e, {
                inNode: isInNodeBody(e.target),
                apple: isApplePlatform(),
                settingsOpen: useUi.getState().settings.open,
                windows: canOpenWindows()
            });
            if (shortcut === null) {
                // Ruimte's own first, so an extension never takes a key from it.
                runActionShortcut(e, isApplePlatform());

                return;
            }
            e.preventDefault();
            runAppShortcut(shortcut);
            countCommand(shortcut, 'shortcut');
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
