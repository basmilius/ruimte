import { isOpenableView, type ProjectShowViewEvent } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { callerName, showViewNotice } from '@/project/show-view';
import { showViewOnceThere } from '@/project/show-view-once';
import { useSettings } from '@/state/settings';
import { watchPool } from '@/transport/pool-watch';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';

/* The answer of the open project, on the cell the person was last in. */
function showInWorkspace(payload: ProjectShowViewEvent): void {
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
    /* One banner. An agent that shows three views in a row leaves the last of them on
       screen, not a stack nobody asked for. Nothing to go back to when the grid was empty, which is a
       project whose views all went, so that one only reports. */
    useDocument.getState().showNotice({
        message: notice.message,
        action: notice.action === 'go' ? { kind: 'go', viewId: payload.viewId } : shown === null ? null : { kind: 'back', shown }
    });
}

function onShowView(endpointId: string, payload: ProjectShowViewEvent): void {
    // The same project id may be open on another machine, so the machine has to match as well.
    if (windowWorkspace()?.connection.endpointId === endpointId && useProject.getState().current?.projectId === payload.projectId) {
        showInWorkspace(payload);
    }
}

/*
 * `ruimte-context view open` on any machine this client is holding a socket to. The daemon only sends it
 * to the clients that have that project open, and this side still checks it is about the project
 * on screen, since the socket may outlive a switch to another project.
 */
export function startShowViewWatch(): () => void {
    const stopLinks = watchPool((link, endpointId) => ({
        subscriptions: [link.on('project.showView', (payload) => onShowView(endpointId, payload))]
    }));
    // Another window of the app, raising this one for a view of the project it has: a new chat, for one.
    const stopShell = desktop()?.onShowView?.((viewId) => showViewOnceThere(viewId)) ?? (() => undefined);
    return () => {
        stopLinks();
        stopShell();
    };
}
