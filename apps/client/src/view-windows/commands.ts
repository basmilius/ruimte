import { defineBehaviors } from '@/commands/behavior';
import { useDocument } from '@/state/document';
import { auxWindowId } from '@/state/window-target';
import { fireAndForget } from '@/transport-api/transport';
import { canMoveViews } from './messages';
import { isWholeWindow, moveToMainWindow, moveToNewWindow } from './windows';

/* The only view of an auxiliary window has a window of its own already. */
export function canMoveToNewWindow(viewId: string | null): viewId is string {
    return viewId !== null && canMoveViews() && !(auxWindowId() !== null && isWholeWindow([viewId]));
}

export function canMoveToMainWindow(viewId: string | null): viewId is string {
    return viewId !== null && canMoveViews() && auxWindowId() !== null;
}

export function moveViewToNewWindow(viewId: string): void {
    void fireAndForget('moveToNewWindow', moveToNewWindow([viewId]));
}

export function moveViewToMainWindow(viewId: string): void {
    void fireAndForget('moveToMainWindow', moveToMainWindow([viewId]));
}

function focusedView(): string | null {
    return useDocument.getState().activeViewId;
}

export const VIEW_WINDOW_BEHAVIORS = defineBehaviors({
    'view-window-new': {
        run: () => {
            const viewId = focusedView();

            if (canMoveToNewWindow(viewId)) {
                moveViewToNewWindow(viewId);
            }
        },
        offered: (moment) => moment.inWorkspace && canMoveToNewWindow(focusedView())
    },
    'view-window-main': {
        run: () => {
            const viewId = focusedView();

            if (canMoveToMainWindow(viewId)) {
                moveViewToMainWindow(viewId);
            }
        },
        offered: (moment) => moment.inWorkspace && canMoveToMainWindow(focusedView())
    }
});
