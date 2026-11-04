import {
    clearTerminalAction,
    closeCellAction,
    duplicateViewAction,
    focusCellAction,
    historyAction,
    placeViewOnCanvasAction,
    splitAction
} from '@/actions/client-actions';
import { focusPromptStack } from '@/canvas/prompt-stack';
import { openForkDialog } from '@/chat/open-fork';
import { countCommand } from '@/desktop/usage';
import { chooseAfterSettle, chooseLaunch, chosenLaunchId, runChosenLaunch, showLaunchOutput, stopAllLaunches, stopChosenLaunch } from '@/launches/actions';
import { useLaunches } from '@/launches/state';
import { undoLatestDeletion } from '@/project/view-trash';
import { askViewSettings, openSessionInKind, setViewShared, showView, stepView, viewAtIndex } from '@/project/views';
import { runAppShortcut } from '@/shell/app-shortcuts';
import type { CommandId, MenuOnlyCommandId } from '@/shell/command-table';
import { activeViewFacts } from '@/shell/menu/context';
import { AFTER_SETTLE_PREFIX, CHAT_MOVE_PREFIX, GO_VIEW_PREFIX, isPaletteId, LAUNCH_CHOOSE_PREFIX } from '@/shell/menu/ids';
import type { SplitDirection } from '@/shell/split';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { openReleaseNotes } from '@/state/release-notes';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';

function focusTowards(direction: SplitDirection) {
    return (): void => focusCellAction(direction);
}

/* Runs against the view with the focus, and does nothing once it is gone. */
function withActiveView(run: (facts: NonNullable<ReturnType<typeof activeViewFacts>>) => void) {
    return (): void => {
        const facts = activeViewFacts();
        if (facts !== null) {
            run(facts);
        }
    };
}

function toggleFullscreen(): void {
    if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
    } else {
        void document.documentElement.requestFullscreen().catch(() => undefined);
    }
}

/*
 * What a menu row runs itself: every row the palette has none of, and the few whose palette row only
 * exists in a moment the menu does not wait for (a view with the focus, a loaded launches file).
 */
const MENU_ACTIONS: Record<MenuOnlyCommandId, () => void> & Partial<Record<CommandId, () => void>> = {
    about: () => useUi.getState().setSettings({ open: true, section: 'about' }),
    'project-settings': () => useUi.getState().askProjectSettings(true),
    palette: () => runAppShortcut('palette'),
    'edit-undo': () => {
        if (!undoLatestDeletion(useDocument)) {
            historyAction('undo');
        }
    },
    'edit-redo': () => historyAction('redo'),
    fullscreen: toggleFullscreen,
    'terminal-clear': withActiveView(({ view }) => clearTerminalAction(view.id)),
    'close-cell': () => closeCellAction(),
    'split-right': () => splitAction('right'),
    'split-down': () => splitAction('down'),
    'panel-devices': () => useUi.getState().togglePanel('devices'),
    'panel-toggle': () => useUi.getState().togglePanel(),
    'view-previous': () => stepView(-1),
    'view-next': () => stepView(1),
    'focus-left': focusTowards('left'),
    'focus-right': focusTowards('right'),
    'focus-up': focusTowards('up'),
    'focus-down': focusTowards('down'),
    prompts: () => void focusPromptStack(),
    'release-notes': () => openReleaseNotes(null),
    'view-fork': withActiveView(({ view, forkTurn }) => {
        if (forkTurn !== null) {
            openForkDialog(view.id, forkTurn);
        }
    }),
    'view-open-in-chat': withActiveView(({ view, asChat }) => {
        if (asChat !== null) {
            void openSessionInKind(view.id, 'chat', asChat);
        }
    }),
    'view-open-in-terminal': withActiveView(({ view, asTerminal }) => {
        if (asTerminal !== null) {
            void openSessionInKind(view.id, 'terminal', asTerminal);
        }
    }),
    'view-duplicate': withActiveView(({ view }) => duplicateViewAction(view.id)),
    'view-put-on-canvas': withActiveView(({ view }) => placeViewOnCanvasAction(view.id)),
    'view-reveal': withActiveView(({ workingFolder }) => {
        if (workingFolder !== null) {
            void transportFor(currentEndpointId())
                ?.request('fs.reveal', { path: workingFolder })
                .catch(() => undefined);
        }
    }),
    'view-share': withActiveView(({ view, shared }) => void setViewShared(view.id, !shared)),
    'view-settings': withActiveView(({ view }) => askViewSettings(view.id)),
    'launch-run': runChosenLaunch,
    'launch-stop': stopChosenLaunch,
    'launches-stop-all': stopAllLaunches,
    'launches-output': () => showLaunchOutput(),
    'launches-edit': () => useLaunches.getState().setDialog({ kind: 'edit', launchId: chosenLaunchId() }),
    'launches-after-settle-off': () => void chooseAfterSettle(null)
};

function isMenuActionId(id: string): id is keyof typeof MENU_ACTIONS {
    return Object.hasOwn(MENU_ACTIONS, id);
}

/* The palette's commands reach the editor, drawings and databases, so they load with the first click that needs one. */
export async function runPaletteCommand(id: string): Promise<void> {
    const { appCommands } = await import('@/shell/commands');
    appCommands()
        .find((command) => command.id === id)
        ?.run();
}

/* A click in the application menu. The palette's rows run through the palette, so both do the same thing. */
export function runMenuCommand(id: string): void {
    countCommand(id, 'menu');
    if (isMenuActionId(id)) {
        MENU_ACTIONS[id]?.();
        return;
    }
    if (id.startsWith(GO_VIEW_PREFIX)) {
        const view = viewAtIndex(Number(id.slice(GO_VIEW_PREFIX.length)));
        if (view) {
            showView(view.id);
        }
        return;
    }
    if (id.startsWith(LAUNCH_CHOOSE_PREFIX)) {
        chooseLaunch(id.slice(LAUNCH_CHOOSE_PREFIX.length));
        return;
    }
    if (id.startsWith(AFTER_SETTLE_PREFIX)) {
        void chooseAfterSettle(id.slice(AFTER_SETTLE_PREFIX.length));
        return;
    }
    if (id.startsWith(CHAT_MOVE_PREFIX)) {
        const facts = activeViewFacts();
        if (facts !== null && facts.offers.moveToProject && !facts.working) {
            useUi.getState().setMoveChatDialog({ chatId: facts.view.id, mode: 'pick', projectId: id.slice(CHAT_MOVE_PREFIX.length) });
        }
        return;
    }
    if (isPaletteId(id)) {
        void runPaletteCommand(id);
    }
}
