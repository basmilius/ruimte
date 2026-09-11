import { activateEndpoint } from '@/endpoint';
import { projectClient } from '@/project';
import { rememberProject, readLastProject, browserStorage } from '@/project/last-project';
import { useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import type { Transport } from '@/transport/transport';

/*
 * Long enough for a machine that is up to answer, short enough that a machine that is asleep says
 * so instead of leaving the menu waiting.
 */
const CONNECT_TIMEOUT_MS = 5000;

const waitForOpen = (transport: Transport, timeoutMs: number): Promise<void> =>
    new Promise((resolve, reject) => {
        if (transport.status === 'open') {
            resolve();
            return;
        }
        let off: (() => void) | null = null;
        const timer = setTimeout(() => {
            off?.();
            reject(new Error('That machine is not answering'));
        }, timeoutMs);
        off = transport.subscribeStatus((status) => {
            if (status !== 'open') {
                return;
            }
            clearTimeout(timer);
            off?.();
            resolve();
        });
    });

/*
 * Opens a project on the machine it belongs to. The only way in: a project id means nothing without
 * the daemon that minted it, so picking one out of the union is also picking a machine. The old
 * project is flushed on its own endpoint's socket before anything moves, which is what the order
 * below is for.
 */
export const openProject = async (endpointId: string, projectId: string): Promise<void> => {
    if (endpointId === useEndpoints.getState().activeId) {
        await projectClient.openProject(projectId);
        return;
    }
    if (!useEndpoints.getState().endpoints.some((endpoint) => endpoint.id === endpointId)) {
        return;
    }
    // Written before the switch, so the machine that takes over boots into this project and not into what it had last.
    rememberProject(endpointId, projectId);
    await activateEndpoint(endpointId);
    const transport = transportFor(endpointId);
    if (!transport) {
        return;
    }
    try {
        await waitForOpen(transport, CONNECT_TIMEOUT_MS);
        await projectClient.settled();
        const { current, currentEndpointId } = useProject.getState();
        if (current?.projectId !== projectId || currentEndpointId !== endpointId) {
            await projectClient.openProject(projectId);
        }
    } catch (e) {
        useProject.getState().setError(e instanceof Error ? e.message : 'That project could not be opened');
        throw e;
    }
};

/*
 * The machine the person was last on, which is what a cold boot lands on. The endpoint list
 * remembers which machine was active, but only a project that was opened says where the work was.
 */
export const restoreLastEndpoint = (storage = browserStorage()): void => {
    const { last } = readLastProject(storage, null);
    const endpoints = useEndpoints.getState();
    if (!last || last.endpointId === endpoints.activeId) {
        return;
    }
    if (endpoints.endpoints.some((endpoint) => endpoint.id === last.endpointId)) {
        endpoints.setActive(last.endpointId);
    }
};
