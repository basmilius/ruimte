import i18next from 'i18next';
import { formatDuration } from '@adecore/ui/format';
import type { LaunchStatus } from '@ruimte/contracts';
import { showLaunchOutput, startLaunch } from '@/launches/actions';
import { useLaunches } from '@/launches/state';
import { defaultProjectStore } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { watchPool } from '@/transport/pool-watch';

function readDocument(endpointId: string, projectId: string): void {
    void transportFor(endpointId)
        ?.request('launches.read', { projectId })
        .then((document) => useLaunches.getState().setDocument(endpointId, projectId, document))
        .catch(() => undefined);
}

function openProject(): { endpointId: string; projectId: string } | null {
    const { current, currentEndpointId } = defaultProjectStore.getState();
    return current === null || currentEndpointId === null ? null : { endpointId: currentEndpointId, projectId: current.projectId };
}

const FAILED_TOAST = 'launch-failed:';

function launchName(endpointId: string, status: LaunchStatus): string {
    const document = useLaunches.getState().documents[`${endpointId}:${status.projectId}`];
    return document?.launches.find((launch) => launch.id === status.launchId)?.name ?? status.launchId;
}

/* Only a launch that went down by itself says so; one a person or an agent stopped is expected to end. */
function announceFailure(endpointId: string, previous: LaunchStatus | undefined, status: LaunchStatus): void {
    const failed = status.state === 'exited' && previous?.state !== 'exited' && !status.stopped && status.exitCode !== 0;
    const open = openProject();
    if (!failed || open === null || open.endpointId !== endpointId || open.projectId !== status.projectId) {
        return;
    }
    const title = i18next.t('launches:failed.title', {
        name: launchName(endpointId, status)
    });
    const description = i18next.t('launches:failed.description', {
        code: status.exitCode ?? '?',
        duration: formatDuration((status.endedAt ?? Date.now()) - status.startedAt)
    });
    const owner = { endpointId, projectId: status.projectId };
    const id = `${FAILED_TOAST}${endpointId}:${status.projectId}:${status.launchId}`;
    const show = (): void => showLaunchOutput(status.launchId, owner);
    const again = (): void => {
        useToasts.getState().dismiss(id);
        void startLaunch(status.launchId, { owner });
    };
    useToasts.getState().show({
        id,
        kind: 'error',
        title,
        description,
        actions: [
            { label: i18next.t('launches:showOutput'), run: show },
            { label: i18next.t('launches:failed.again'), run: again }
        ]
    });
    if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }
    const notification = new Notification(title, {
        body: description,
        tag: `ruimte-launch-${endpointId}-${status.projectId}-${status.launchId}`
    });
    notification.onclick = () => {
        window.focus();
        show();
        notification.close();
    };
}

/*
 * What runs on every machine this client holds a socket for, and the launches of the project on
 * screen. The daemon pushes each change to every socket; a socket that opens asks once, since what
 * changed while it was closed was pushed to nobody.
 */
export function startLaunchWatch(): () => void {
    const offPool = watchPool((link, endpointId) => ({
        onOpen: () => {
            // A daemon from before launches does not know the request and simply runs none.
            link.request('launch.list', {})
                .then((result) => useLaunches.getState().setList(endpointId, result.launches))
                .catch(() => undefined);
            const open = openProject();
            if (open !== null && open.endpointId === endpointId) {
                readDocument(endpointId, open.projectId);
            }
        },
        subscriptions: [
            link.on('launch.status', (status) => {
                const previous = useLaunches.getState().statuses[`${endpointId}:${status.projectId}`]?.[status.launchId];
                useLaunches.getState().setStatus(endpointId, status);
                announceFailure(endpointId, previous, status);
            }),
            link.on('launches.changed', (payload) => useLaunches.getState().setDocument(endpointId, payload.projectId, payload.document))
        ]
    }));
    let last: string | null = null;
    const follow = (): void => {
        const open = openProject();
        const key = open === null ? null : `${open.endpointId}:${open.projectId}`;
        if (key === last) {
            return;
        }
        last = key;
        // What was asked or offered about the project before acts on nothing once this one is on screen.
        useLaunches.getState().setAsk(null);
        for (const toast of useToasts.getState().toasts) {
            if (toast.id.startsWith(FAILED_TOAST)) {
                useToasts.getState().dismiss(toast.id);
            }
        }
        if (open !== null) {
            readDocument(open.endpointId, open.projectId);
        }
    };
    follow();
    const offProject = defaultProjectStore.subscribe(follow);
    return () => {
        offPool();
        offProject();
    };
}
