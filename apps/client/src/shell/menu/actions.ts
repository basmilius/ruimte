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
import { askViewSettings, openSessionInKind, setViewShared, showView, stepView, viewAtIndex } from '@/project/views';
import { undoLatestDeletion } from '@/project/view-trash';
import { runAppShortcut } from '@/shell/app-shortcuts';
import { appCommands } from '@/shell/commands';
import { activeViewFacts } from '@/shell/menu/context';
import { GO_VIEW_PREFIX, isPaletteId, type MenuActionId } from '@/shell/menu/ids';
import type { SplitDirection } from '@/shell/split';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { openReleaseNotes } from '@/state/release-notes';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';

const focusTowards = (direction: SplitDirection) => (): void => focusCellAction(direction);

/* Runs against the view with the focus, and does nothing once it is gone. */
const withActiveView = (run: (facts: NonNullable<ReturnType<typeof activeViewFacts>>) => void) => (): void => {
    const facts = activeViewFacts();
    if (facts !== null) {
        run(facts);
    }
};

const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
    } else {
        void document.documentElement.requestFullscreen().catch(() => undefined);
    }
};

const MENU_ACTIONS: Record<MenuActionId, () => void> = {
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
    models: () => useUi.getState().setModelsOpen(true),
    'view-fork': withActiveView(({ view, forkTurn }) => {
        if (forkTurn !== null) {
            useUi.getState().setForkDialog({ chatId: view.id, turnId: forkTurn });
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
    'view-settings': withActiveView(({ view }) => askViewSettings(view.id))
};

const isMenuActionId = (id: string): id is MenuActionId => Object.hasOwn(MENU_ACTIONS, id);

/* A click in the application menu. The palette's rows run through the palette, so both do the same thing. */
export const runMenuCommand = (id: string): void => {
    if (isMenuActionId(id)) {
        MENU_ACTIONS[id]();
        return;
    }
    if (id.startsWith(GO_VIEW_PREFIX)) {
        const view = viewAtIndex(Number(id.slice(GO_VIEW_PREFIX.length)));
        if (view) {
            showView(view.id);
        }
        return;
    }
    if (isPaletteId(id)) {
        appCommands()
            .find((command) => command.id === id)
            ?.run();
    }
};
