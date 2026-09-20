import type { FlowNoticeEvent } from '@ruimte/contracts';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { watchPool } from '@/transport/pool-watch';
import { windowWorkspace } from '@/state/window';

const onNotice = (endpointId: string, payload: FlowNoticeEvent): void => {
    // The same project id may be open on another machine, so the machine has to match as well.
    if (windowWorkspace()?.connection.endpointId !== endpointId || useProject.getState().current?.projectId !== payload.projectId) {
        return;
    }
    useToasts.getState().show({
        // One toast per flow: a flow that says something twice replaces what it said, it does not stack.
        id: `flow-${payload.viewId}`,
        title: payload.flow,
        description: payload.text,
        kind: 'success',
        persist: true
    });
};

/* What the show a notification card puts on screen, wherever the flow ran. */
export const startFlowNoticeWatch = (): (() => void) =>
    watchPool((link, endpointId) => ({
        subscriptions: [link.on('flow.notice', (payload) => onNotice(endpointId, payload))]
    }));
