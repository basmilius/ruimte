import { isOpenableView, type ProjectShowViewEvent } from '@ruimte/contracts';
import { callerName, showViewNotice } from '@/project/show-view';
import { useSettings } from '@/state/settings';
import { pool } from '@/transport';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';

/* The answer of the open project, on the cell the person was last in. */
const showInWorkspace = (payload: ProjectShowViewEvent): void => {
    const state = useDocument.getState();
    const view = state.views.find((candidate) => candidate.id === payload.viewId);
    if (!view || !isOpenableView(view)) {
        return;
    }
    const follow = useSettings.getState().agentsShowViews;
    const notice = showViewNotice({
        agent: callerName(state.views, payload.by),
        view: view.name ?? payload.viewId,
        follow,
        alreadyThere: state.activeViewId === payload.viewId
    });
    /* The grid moves first, so the way back is recorded against the grid as it stands after the move
       and a second `view open` undoes the second one rather than the first. */
    const shown = notice.action === 'back' ? useDocument.getState().showView(payload.viewId) : null;
    /* One banner: an agent that shows three views in a row leaves the last of them on
       screen, not a stack nobody asked for. Nothing to go back to when the grid was empty, which is a
       project whose views all went, so that one only reports. */
    useDocument.getState().showNotice({
        message: notice.message,
        action: notice.action === 'go' ? { kind: 'go', viewId: payload.viewId } : shown === null ? null : { kind: 'back', shown }
    });
};

const onShowView = (endpointId: string, payload: ProjectShowViewEvent): void => {
    // The same project id may be open on another machine, so the machine has to match as well.
    if (windowWorkspace()?.connection.endpointId === endpointId && useProject.getState().current?.projectId === payload.projectId) {
        showInWorkspace(payload);
    }
};

/*
 * `ruimte-context view open` on any machine this client is holding a socket to. The daemon only sends it
 * to the clients that have that project open, and this side still checks it is about the project
 * on screen: the socket may outlive a switch to another project.
 */
export const startShowViewWatch = (): (() => void) => {
    const watching = new Map<string, () => void>();

    const sync = (): void => {
        const ids = new Set(pool.ids());
        for (const [endpointId, stop] of watching) {
            if (!ids.has(endpointId)) {
                stop();
                watching.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            const link = watching.has(endpointId) ? null : pool.peek(endpointId);
            if (link) {
                watching.set(
                    endpointId,
                    link.on('project.showView', (payload) => onShowView(endpointId, payload))
                );
            }
        }
    };

    sync();
    const off = pool.subscribe(sync);
    return () => {
        off();
        for (const stop of watching.values()) {
            stop();
        }
        watching.clear();
    };
};
