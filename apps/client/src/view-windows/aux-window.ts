import { auxWindowKey } from '@ruimte/desktop-bridge';
import { provideCommandRelay } from '@/commands/behavior';
import { desktop } from '@/desktop/bridge';
import { viewIdsIn } from '@/layout/split';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { provideViewHomes } from '@/state/view-homes';
import { auxWindowId } from '@/state/window-target';
import { fireAndForget } from '@/transport-api/transport';
import { leaveWorkspace } from '@/workspace/connections';
import { AUX_COMMAND_RELAY } from './aux-commands';
import { idOf, placeItems } from './items';
import { ownWindowKey, postToWindow, projectKey, readWindowMessage } from './messages';
import { usePendingViews } from './pending-views';
import { writeAuxViews } from './registry';
import { answerWindow, grant, isGranted, isOfProject, resetWindows, ungrant } from './windows';

interface AuxWindowDeps {
    /* Replaced in a test, which has no window to lose. */
    close(): void;
}

const REAL_DEPS: AuxWindowDeps = { close: () => window.close() };

/* Loose views are left out: they are no views of the project, so two windows may show the same one. */
function ownViewIds(): string[] {
    const { layout, views } = useDocument.getState();

    return layout === null ? [] : viewIdsIn(layout).filter((id) => views.some((view) => view.id === id));
}

/*
 * An auxiliary window shows only the views it was handed. For any other view the window that has the
 * project comes to the front. It tells the other windows which views it has, and closes with its last one.
 */
export function startAuxWindow(overrides: Partial<AuxWindowDeps> = {}): () => void {
    const deps = { ...REAL_DEPS, ...overrides };
    const shell = desktop();
    const project = projectKey();
    const own = ownWindowKey();
    const aux = auxWindowId();

    if (project === null || own === null || aux === null) {
        return () => undefined;
    }

    let closing = false;

    const close = (): void => {
        if (closing) {
            return;
        }

        closing = true;
        writeAuxViews(own, null);
        deps.close();
    };

    provideCommandRelay(AUX_COMMAND_RELAY);
    provideViewHomes({
        elsewhere: (viewId) => !isGranted(viewId),
        // The window that has the project shows the view, or raises the auxiliary window that has it.
        reach: (viewId) => shell?.openWindow?.(project, viewId)
    });

    const first = useDocument.getState().layout;
    let standing = first === null ? [] : viewIdsIn(first);
    let filled = standing.length > 0;
    // A view made a moment ago lands only once the project's change does, and the grid is empty until then.
    let expecting = false;
    /*
     * The views of a drag that is still under way, which this window shows already. The window they
     * are dragged out of keeps them until the drag ends, so the other windows do not hear of them here.
     */
    const previewing = new Set<string>();
    let waiting = 0;

    const follow = (): void => {
        const { layout, loading } = useDocument.getState();

        if (loading || useProject.getState().current === null) {
            return;
        }

        const now = layout === null ? [] : viewIdsIn(layout);
        // A view that left this grid needs a new grant to come back.
        ungrant(standing.filter((id) => !now.includes(id)));
        standing = now;
        writeAuxViews(
            own,
            ownViewIds().filter((id) => !previewing.has(id))
        );

        if (now.length > 0) {
            filled = true;
        } else if (filled) {
            close();
        }
    };

    const declined = (): void => {
        waiting -= 1;

        if (waiting === 0 && !filled && !expecting) {
            close();
        }
    };

    /* The window that opened this one has its views, and this one does not know which that is. It asks them all, and closes when none has any. */
    const askForViews = async (): Promise<void> => {
        const others = (await shell?.auxWindows?.(project).catch(() => [])) ?? [];
        const targets = [project, ...others.filter((id) => id !== aux).map((id) => auxWindowKey(project, id))];
        waiting = targets.length;

        for (const target of targets) {
            if (!(await postToWindow(target, { type: 'ready' }))) {
                declined();
            }
        }
    };

    follow();

    if (!filled) {
        void fireAndForget('askForViews', askForViews());
    }

    const stops = [
        useDocument.subscribe(follow),
        shell?.onWindowMessage?.((from, text) => {
            const message = isOfProject(from, project) ? readWindowMessage(text) : null;

            if (message?.type === 'give' || message?.type === 'wait') {
                expecting = true;
            }

            if (message?.type === 'wait') {
                // Shown at once, so the window is full by the time the drag lets go. They are not this window's yet.
                const ids = message.items.map(idOf);
                ids.forEach((id) => previewing.add(id));
                usePendingViews.getState().set(message.items);
                grant(ids);
                placeItems(message.items, null);

                return;
            }

            if (message?.type === 'give') {
                message.items.forEach((item) => previewing.delete(idOf(item)));
            }

            if (message === null || answerWindow(from, message)) {
                // A view that was shown ahead of the drag's end moves nothing in the grid when it is given, so the list is written here.
                follow();

                return;
            }

            if (message.type === 'none') {
                declined();
            } else if (message.type === 'leave') {
                // The window that closes the project waits until this one is gone, so the machine hears of the leave first.
                void fireAndForget('leaveWorkspace', leaveWorkspace().finally(close));
            }
        })
    ];

    return () => {
        for (const stop of stops) {
            stop?.();
        }

        provideCommandRelay(null);
        provideViewHomes(null);
        resetWindows();
    };
}
