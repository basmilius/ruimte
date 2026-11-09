import { isInFloatingLayer } from '@adecore/ui';
import { isSessionView, isCanvasView } from '@ruimte/contracts';
import i18next from 'i18next';
import { createViewAction, duplicateViewAction, placeViewOnCanvasAction, toggleFlagAction } from '@/action-port/person-actions';
import { defineBehaviors, takeKey, type CommandBehavior, type KeyHandler } from '@/commands/behavior';
import { viewDialog } from '@/project/dialogs';
import { askDeleteView, askViewSettings, newSubheaderView, openSessionInKind, setViewShared, showView, viewAtIndex } from '@/project/views';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { VIEW_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { transportFor } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { withActiveView } from '@/views/active-view';

function creating(kind: Parameters<typeof createViewAction>[0]): CommandBehavior {
    return { run: () => void createViewAction(kind), offered: (moment) => moment.inWorkspace };
}

function activeViewId(): string | null {
    return useDocument.getState().activeViewId;
}

export const VIEW_BEHAVIORS = defineBehaviors({
    'view-new': { ...creating('canvas'), key: (press) => takeKey(press, () => void createViewAction('canvas')) },
    'view-new-drawing': creating('drawing'),
    'view-new-diagram': creating('diagram'),
    'view-new-terminal': creating('terminal'),
    'view-new-separator': creating('separator'),
    'view-new-subheader': { run: () => void newSubheaderView(), offered: (moment) => moment.inWorkspace },
    'view-new-file': {
        run: () => useUi.getState().openFilePicker({ kind: 'view' }),
        offered: (moment) => moment.inWorkspace && moment.folder !== null
    },
    'view-new-browser': {
        run: () => viewDialog.set({ kind: 'new-browser' }),
        offered: (moment) => moment.inWorkspace
    },
    'view-put-on-canvas': { run: withActiveView(({ view }) => placeViewOnCanvasAction(view.id)) },
    // The palette's own way to the same thing as Put on Canvas, for a session view only.
    'view-demote': {
        run: () => {
            const id = activeViewId();
            if (id !== null) {
                placeViewOnCanvasAction(id);
            }
        },
        offered: (moment) => {
            const view = moment.activeView;

            return moment.inWorkspace && view !== null && isSessionView(view) && moment.document.views.some(isCanvasView) && { hint: view.name ?? '' };
        }
    },
    'view-reveal': {
        run: withActiveView(({ workingFolder }) => {
            if (workingFolder !== null) {
                void fireAndForget('fs.reveal', transportFor(currentEndpointId())?.request('fs.reveal', { path: workingFolder }));
            }
        })
    },
    'view-share': { run: withActiveView(({ view, shared }) => void setViewShared(view.id, !shared)) },
    'flag-toggle': {
        run: toggleFlagAction,
        offered: (moment) => moment.inWorkspace && moment.document.activeViewId !== null && { hint: i18next.t('shell:palette.hints.toggleFlag') },
        // From anywhere but a popup, so a flag goes on a chat view while its composer has the keyboard.
        key: (press) => {
            if (!isInFloatingLayer(press.event.target)) {
                takeKey(press, toggleFlagAction);
            }

            return true;
        }
    },
    'view-settings': {
        run: () => {
            const id = activeViewId();
            if (id !== null) {
                askViewSettings(id);
            }
        },
        offered: (moment) => moment.inWorkspace && moment.document.activeViewId !== null
    },
    'view-delete': {
        run: () => {
            const id = activeViewId();
            if (id !== null) {
                askDeleteView(id);
            }
        },
        offered: (moment) => moment.inWorkspace && moment.document.activeViewId !== null
    },
    'view-duplicate': { run: withActiveView(({ view }) => duplicateViewAction(view.id)) },
    'view-open-in-chat': {
        run: withActiveView(({ view, asChat }) => {
            if (asChat !== null) {
                void openSessionInKind(view.id, 'chat', asChat);
            }
        })
    },
    'view-open-in-terminal': {
        run: withActiveView(({ view, asTerminal }) => {
            if (asTerminal !== null) {
                void openSessionInKind(view.id, 'terminal', asTerminal);
            }
        })
    }
});

/* The views answer from anywhere, a focused node included: they are how you leave one. */
export const VIEW_KEY_HANDLERS: readonly KeyHandler[] = [
    (press) => {
        const index = VIEW_SHORTCUTS.findIndex((candidate) => press.is(candidate));
        if (index === -1) {
            return false;
        }
        press.event.preventDefault();
        const view = viewAtIndex(index + 1);
        if (view) {
            showView(view.id);
        }

        return true;
    }
];
