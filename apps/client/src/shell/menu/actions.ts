import { focusPromptStack } from '@/canvas/prompt-stack';
import {
    askViewSettings,
    duplicateViewOf,
    openSessionInKind,
    putOnCanvas,
    setViewShared,
    showView,
    splitFocusedCell,
    stepView,
    viewAtIndex
} from '@/project/views';
import { runAppShortcut } from '@/shell/app-shortcuts';
import { appCommands } from '@/shell/commands';
import { activeViewFacts } from '@/shell/menu/context';
import { GO_VIEW_PREFIX, isPaletteId, type MenuActionId } from '@/shell/menu/ids';
import { cellCount, type SplitDirection } from '@/shell/split';
import { focusedCanvas } from '@/state/canvas';
import { focusedDiagram } from '@/state/diagram';
import { activeViewOf, useDocument } from '@/state/document';
import { focusedDrawing } from '@/state/drawing';
import { currentEndpointId } from '@/state/keys';
import { openReleaseNotes } from '@/state/release-notes';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { sessionClient } from '@/terminal';

const focusTowards = (direction: SplitDirection) => (): void => useDocument.getState().focusTowards(direction);

/* Runs against the view with the focus, and does nothing once it is gone. */
const withActiveView = (run: (facts: NonNullable<ReturnType<typeof activeViewFacts>>) => void) => (): void => {
    const facts = activeViewFacts();
    if (facts !== null) {
        run(facts);
    }
};

/* The history of the surface on screen: a canvas, a drawing and a diagram each keep their own. */
const history = (step: 'undo' | 'redo') => (): void => {
    const view = activeViewOf(useDocument.getState());
    if (view?.kind === 'canvas') {
        focusedCanvas().getState()[step]();
    } else if (view?.kind === 'drawing') {
        focusedDrawing().getState()[step]();
    } else if (view?.kind === 'diagram') {
        focusedDiagram().getState()[step]();
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
    'edit-undo': history('undo'),
    'edit-redo': history('redo'),
    fullscreen: toggleFullscreen,
    'terminal-clear': withActiveView(({ view }) => sessionClient.clear(view.id)),
    'close-cell': () => {
        const layout = useDocument.getState().layout;
        if (layout !== null && cellCount(layout) > 1) {
            useDocument.getState().closeCellAt(layout.focus);
        }
    },
    'split-right': () => splitFocusedCell('right'),
    'split-down': () => splitFocusedCell('down'),
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
            useUi.getState().setForkDialog({ chatId: view.id, turnId: forkTurn });
        }
    }),
    'view-open-in-chat': withActiveView(({ view, asChat }) => {
        if (asChat !== null) {
            openSessionInKind(view.id, 'chat', asChat);
        }
    }),
    'view-open-in-terminal': withActiveView(({ view, asTerminal }) => {
        if (asTerminal !== null) {
            openSessionInKind(view.id, 'terminal', asTerminal);
        }
    }),
    'view-duplicate': withActiveView(({ view }) => void duplicateViewOf(view.id)),
    'view-put-on-canvas': withActiveView(({ view }) => void putOnCanvas(view.id)),
    'view-reveal': withActiveView(({ workingFolder }) => {
        if (workingFolder !== null) {
            void transportFor(currentEndpointId())
                ?.request('fs.reveal', { path: workingFolder })
                .catch(() => undefined);
        }
    }),
    'view-share': withActiveView(({ view, shared }) => setViewShared(view.id, !shared)),
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
