import i18next from 'i18next';
import { defineBehaviors, takeKey } from '@/commands/behavior';
import { keepAwakeAvailable, setKeepAwake } from '@/controllers/keep-awake';
import { modelsDialog } from '@/models/dialog';
import { openOnboarding } from '@/onboarding/open';
import { projectSettingsAsk } from '@/project/dialogs';
import { newChat, newChatMachine, offersNewChat, useNewChat } from '@/project/new-chat';
import { stepMove, stepWindowTab, useWindowTabs } from '@/project/window-tabs';
import { canMoveToNewWindow, canOpenWindows, moveToNewWindow, openNewWindow } from '@/project/windows';
import { hasLocalMachine } from '@/state/local-machine';
import { openReleaseNotes } from '@/state/release-notes';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { useUi } from '@/state/ui';
import { isInNodeBody } from '@/surface/canvas/node-body';
import { usageDialog } from '@/usage/dialog';

function togglePalette(): void {
    const ui = useUi.getState();
    if (ui.paletteOpen) {
        ui.setPaletteOpen(false);
    } else {
        ui.openPalette();
    }
}

function toggleFullscreen(): void {
    if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
    } else {
        void document.documentElement.requestFullscreen().catch(() => undefined);
    }
}

function openSettings(patch: Parameters<ReturnType<typeof useUi.getState>['setSettings']>[0] = { open: true }): () => void {
    return () => useUi.getState().setSettings(patch);
}

/* The project tab on screen when the window has that strip and it can move that way, else null. */
function movableTab(step: 1 | -1): string | null {
    const { tabs } = useWindowTabs.getState();
    const key = tabs.active;
    if (useSettings.getState().projectNavigation !== 'tabs' || key === null || stepMove(tabs, key, step) === tabs) {
        return null;
    }

    return key;
}

export const WINDOW_BEHAVIORS = defineBehaviors({
    'chat-new': {
        run: newChat,
        offered: () => offersNewChat(newChatMachine(), useNewChat.getState().refused) && { hint: i18next.t('shell:chats.name') },
        key: (press) => takeKey(press, newChat)
    },
    // Find in files opens the palette, which searches whichever workspace has the focus.
    'find-in-files': {
        run: () => useUi.getState().openFindInFiles(),
        offered: (moment) => moment.folder !== null,
        key: (press) => takeKey(press, () => useUi.getState().openFindInFiles())
    },
    about: { run: openSettings({ open: true, section: 'about' }) },
    settings: { run: openSettings(), key: (press) => takeKey(press, openSettings()) },
    'settings-search': {
        run: () => useUi.getState().setSettings({ open: true, searchAt: useUi.getState().settings.searchAt + 1 }),
        // The key works only while the dialog is up, so the row shows none.
        offered: () => ({ shortcut: null }),
        key: (press) =>
            useUi.getState().settings.open &&
            takeKey(press, () => useUi.getState().setSettings({ open: true, searchAt: useUi.getState().settings.searchAt + 1 }))
    },
    'settings-keyboard': { run: openSettings({ open: true, section: 'keyboard' }) },
    'settings-editor': { run: openSettings({ open: true, section: 'editor' }) },
    'settings-machines': {
        run: openSettings({ open: true, section: 'machines' }),
        offered: () => ({ hint: i18next.t('shell:palette.hints.remote') })
    },
    'settings-computer': { run: openSettings({ open: true, section: 'agents', target: 'computer.enable' }) },
    'window-new': {
        run: openNewWindow,
        offered: () => canOpenWindows(),
        key: (press) => canOpenWindows() && takeKey(press, openNewWindow)
    },
    'window-move': {
        run: () => void moveToNewWindow(),
        offered: (moment) => moment.inWorkspace && canMoveToNewWindow()
    },
    'project-tab-move-left': {
        run: () => {
            const key = movableTab(-1);
            if (key !== null) {
                stepWindowTab(key, -1);
            }
        },
        offered: () => movableTab(-1) !== null
    },
    'project-tab-move-right': {
        run: () => {
            const key = movableTab(1);
            if (key !== null) {
                stepWindowTab(key, 1);
            }
        },
        offered: () => movableTab(1) !== null
    },
    sidebar: {
        run: () => useUi.getState().toggleSidebar(),
        offered: (moment) => moment.inWorkspace,
        // Ctrl+B is readline's backward-char and tmux's prefix, so off macOS it stays out of a node.
        key: (press) => (!press.apple && isInNodeBody(press.event.target) ? false : takeKey(press, () => useUi.getState().toggleSidebar()))
    },
    palette: { run: togglePalette, key: (press) => takeKey(press, togglePalette) },
    fullscreen: { run: toggleFullscreen },
    theme: { run: () => useTheme.getState().toggle() },
    'release-notes': { run: () => openReleaseNotes(null) },
    onboarding: { run: () => openOnboarding(), offered: () => hasLocalMachine() },
    usage: { run: () => usageDialog.set(true), offered: () => ({ hint: i18next.t('shell:palette.hints.usage') }) },
    models: { run: () => modelsDialog.set(true) },
    'open-folder': { run: () => useUi.getState().openFolderBrowser() },
    'project-settings': { run: () => projectSettingsAsk.set(true) },
    'keep-awake-off': { run: () => setKeepAwake({ keepAwake: 'off' }), offered: () => keepAwakeAvailable() },
    'keep-awake-working': { run: () => setKeepAwake({ keepAwake: 'working' }), offered: () => keepAwakeAvailable() },
    'keep-awake-always': { run: () => setKeepAwake({ keepAwake: 'always' }), offered: () => keepAwakeAvailable() },
    'panel-toggle': {
        run: () => useUi.getState().togglePanel(),
        key: (press) => takeKey(press, () => useUi.getState().togglePanel())
    }
});
