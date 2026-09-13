import { isOpenableView, type ProjectShowViewEvent } from '@ruimte/contracts';
import { callerName, showViewNotice } from '@/project/show-view';
import { useSettings } from '@/state/settings';
import { useToasts, type ToastAction } from '@/state/toasts';
import { pool } from '@/transport';
import { listWorkspaces, type Workspace } from '@/transport/connections';

/*
 * One workspace's answer to the event. Every workspace with this project acts on its own focused
 * cell, so two of them side by side each move the cell the person was last in, and a workspace on
 * another project ignores the whole thing.
 */
const showInWorkspace = (workspace: Workspace, payload: ProjectShowViewEvent): void => {
    const documents = workspace.stores.document;
    const state = documents.getState();
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
    const shown = follow ? documents.getState().showView(payload.viewId) : null;
    /* Nothing to go back to when the grid was empty, which is a project whose views all went. */
    const button: ToastAction | null =
        notice.action === 'go-there'
            ? { label: 'Go there', run: () => documents.getState().setActiveView(payload.viewId) }
            : notice.action === 'back' && shown !== null
              ? { label: 'Back', run: () => documents.getState().undoShowView(shown) }
              : null;
    useToasts.getState().show({
        /* One card per workspace: an agent that shows three views in a row leaves the last of them
           on screen, not a stack nobody asked for. */
        id: `show-view:${workspace.id}`,
        kind: notice.stays ? 'notice' : 'success',
        title: notice.title,
        description: notice.description,
        ...(button === null ? {} : { action: button })
    });
};

const onShowView = (endpointId: string, payload: ProjectShowViewEvent): void => {
    for (const workspace of listWorkspaces()) {
        // The same project may be open on two machines at once, so the machine has to match as well.
        if (workspace.connection.endpointId === endpointId && workspace.stores.project.getState().current?.projectId === payload.projectId) {
            showInWorkspace(workspace, payload);
        }
    }
};

/*
 * `ruimte-context open` on any machine this client is holding a socket to. The daemon only sends it
 * to the clients that have that project open, and this side still checks which workspace it is
 * about: one window may hold several, and the event is about one of them.
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
