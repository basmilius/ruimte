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
 * Dials a machine and waits for its socket, with the budget every switch in the app uses. The pool
 * opens sockets lazily, so a machine that is not connected is usually one nothing has asked for yet.
 */
export const reachEndpoint = async (endpointId: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> => {
    const transport = transportFor(endpointId);
    if (!transport) {
        throw new Error('That machine is no longer in the list');
    }
    await waitForOpen(transport, timeoutMs);
};

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

/* The pieces a test stands in for; every call site in the app passes none of them. */
export interface FolderDeps {
    activate(endpointId: string): Promise<void>;
    reach(endpointId: string): Promise<void>;
    openFolder(folder: string, createFolder: boolean): Promise<void>;
}

const REAL_FOLDER_DEPS: FolderDeps = {
    activate: activateEndpoint,
    reach: async (endpointId) => {
        await reachEndpoint(endpointId);
        // The machine that took over may still be opening what it had last; a folder on top of that would race.
        await projectClient.settled();
    },
    openFolder: (folder, createFolder) => projectClient.openFolder(folder, createFolder)
};

/*
 * The folder twin of `openProject`: a folder is a path on one machine, so opening one found while
 * browsing another daemon has to move the whole client there first. `createFolder` is browse mode's
 * offer to make a path that is not there, and the daemon makes the whole missing chain.
 */
export const openFolderOn = async (endpointId: string, folder: string, createFolder = false, deps: FolderDeps = REAL_FOLDER_DEPS): Promise<void> => {
    if (endpointId === useEndpoints.getState().activeId) {
        await deps.openFolder(folder, createFolder);
        return;
    }
    if (!useEndpoints.getState().endpoints.some((endpoint) => endpoint.id === endpointId)) {
        throw new Error('That machine is no longer in the list');
    }
    await deps.activate(endpointId);
    await deps.reach(endpointId);
    await deps.openFolder(folder, createFolder);
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
