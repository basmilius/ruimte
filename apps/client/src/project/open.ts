import { activateEndpoint } from '@/endpoint';
import { ensureMachine } from '@/endpoint/reach';
import { projectClient } from '@/project';
import { rememberProject, readLastProject, browserStorage } from '@/project/last-project';
import { useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';

/*
 * Opens a project on the machine it belongs to. The only way in: a project id means nothing without
 * the daemon that minted it, so picking one out of the union is also picking a machine. That machine
 * is reached before anything moves, the active one included, since no machine keeps a link while
 * nothing is open on it; one that does not answer leaves the project on screen where it was. The old
 * project is then flushed on its own endpoint's socket, which is what the order below is for.
 */
export const openProject = async (endpointId: string, projectId: string): Promise<void> => {
    try {
        const id = await ensureMachine(endpointId);
        if (id !== useEndpoints.getState().activeId) {
            // Written before the switch, so the machine that takes over boots into this project and not into what it had last.
            rememberProject(id, projectId);
            await activateEndpoint(id);
        }
        await projectClient.settled();
        const { current, currentEndpointId } = useProject.getState();
        if (current?.projectId !== projectId || currentEndpointId !== id) {
            await projectClient.openProject(projectId);
        }
    } catch (e) {
        useProject.getState().setError(e instanceof Error ? e.message : 'That project could not be opened');
        throw e;
    }
};

/* The pieces a test stands in for; every call site in the app passes none of them. */
export interface FolderDeps {
    ensure(endpointId: string): Promise<string>;
    activate(endpointId: string): Promise<void>;
    settle(): Promise<void>;
    openFolder(folder: string, createFolder: boolean): Promise<void>;
}

const REAL_FOLDER_DEPS: FolderDeps = {
    ensure: ensureMachine,
    activate: activateEndpoint,
    settle: () => projectClient.settled(),
    openFolder: (folder, createFolder) => projectClient.openFolder(folder, createFolder)
};

/*
 * The folder twin of `openProject`: a folder is a path on one machine, so opening one found while
 * browsing another daemon has to move the whole client there first. `createFolder` is browse mode's
 * offer to make a path that is not there, and the daemon makes the whole missing chain.
 */
export const openFolderOn = async (endpointId: string, folder: string, createFolder = false, deps: FolderDeps = REAL_FOLDER_DEPS): Promise<void> => {
    // The active machine too: with nothing open on it, it has no link to open the folder over.
    const id = await deps.ensure(endpointId);
    if (id === useEndpoints.getState().activeId) {
        await deps.openFolder(folder, createFolder);
        return;
    }
    await deps.activate(id);
    // The machine that took over may still be opening what it had last; a folder on top of that would race.
    await deps.settle();
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
