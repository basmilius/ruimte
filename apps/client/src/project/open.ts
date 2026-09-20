import i18next from 'i18next';
import { useStore } from 'zustand';
import { ensureMachine } from '@/endpoint/reach';
import { dropClientLocal } from '@/project/client-local';
import { browserStorage, readLastProject, type LastProjectStorage } from '@/project/last-project';
import { listProjects } from '@/project/list';
import { ProjectSwitch, type SwitchOutcome, type SwitchRun, type SwitchState, type SwitchTarget } from '@/project/project-switch';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine, isRealMachine } from '@/state/local-machine';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { useWindow, windowWorkspace } from '@/state/window';
import { enterWorkspace, leaveWorkspace, machineFor, showStart, type OpenRequest } from '@/transport/connections';

/* Where the window is going: a project, a folder, or a new project without a folder. */
export type SwitchPlan =
    | { kind: 'project'; endpointId: string; projectId: string }
    | { kind: 'folder'; endpointId: string; folder: string; createFolder: boolean }
    | { kind: 'new'; endpointId: string; name: string };

/* The project the window had open when a switch began, which is what going back opens again. */
export interface Whereabouts {
    endpointId: string;
    projectId: string;
}

/* The pieces a test stands in for; every call site in the app passes none of them. */
export interface SwitchDeps {
    ensure(endpointId: string, signal: AbortSignal): Promise<string>;
    /* The project on screen, or null on the start screen. */
    current(): Whereabouts | null;
    leave(): Promise<void>;
    enter(endpointId: string, request: OpenRequest): Promise<void>;
    toStart(): void;
}

const REAL_DEPS: SwitchDeps = {
    ensure: ensureMachine,
    current: () => {
        const { current, currentEndpointId } = useProject.getState();
        return windowWorkspace() && current && currentEndpointId ? { endpointId: currentEndpointId, projectId: current.projectId } : null;
    },
    leave: leaveWorkspace,
    enter: enterWorkspace,
    toStart: showStart
};

const requestOf = (plan: SwitchPlan): OpenRequest => {
    switch (plan.kind) {
        case 'project':
            return { projectId: plan.projectId };
        case 'folder':
            return { folder: plan.folder, createFolder: plan.createFolder };
        case 'new':
            return { name: plan.name };
    }
};

/*
 * The steps of one switch. The machine is reached before anything moves, since no machine keeps a
 * link while nothing is open on it; one that does not answer leaves the window where it was. Then
 * the open project is left (written and released) and the next one is built in a workspace of its
 * own. A run remembers what it left and what it entered, so going back undoes exactly that.
 */
export const switchRun = (plan: SwitchPlan, deps: SwitchDeps = REAL_DEPS): SwitchRun => {
    let left: Whereabouts | null = null;
    let entered = false;
    return {
        async steps({ signal, opening }) {
            const id = await deps.ensure(plan.endpointId, signal);
            if (signal.aborted) {
                return;
            }
            opening();
            const here = deps.current();
            if (plan.kind === 'project' && here?.endpointId === id && here.projectId === plan.projectId) {
                return;
            }
            if (here) {
                await deps.leave();
                left = here;
            }
            if (signal.aborted) {
                return;
            }
            await deps.enter(id, requestOf(plan));
            entered = true;
        },
        async back() {
            if (entered) {
                await deps.leave();
            }
            if (left === null) {
                if (entered) {
                    deps.toStart();
                }
                return;
            }
            try {
                await deps.ensure(left.endpointId, new AbortController().signal);
                await deps.enter(left.endpointId, { projectId: left.projectId });
            } catch {
                // The project that was open cannot come back, and a window never shows a workspace without one.
                deps.toStart();
            }
        }
    };
};

export const projectSwitch = new ProjectSwitch();

export const useProjectSwitch = <T>(selector: (state: SwitchState) => T): T => useStore(projectSwitch.store, selector);

const targetOf = (plan: SwitchPlan): SwitchTarget => ({
    endpointId: plan.endpointId,
    summary:
        plan.kind === 'project'
            ? (useProjectList.getState().projects.find((row) => row.endpointId === plan.endpointId && row.summary.projectId === plan.projectId)?.summary ??
              null)
            : null,
    folder: plan.kind === 'folder' ? plan.folder : null,
    name: plan.kind === 'new' ? plan.name : null
});

/* Every way into a project passes here, so the window can say what it is waiting on. */
const begin = (plan: SwitchPlan): Promise<SwitchOutcome> => projectSwitch.start(targetOf(plan), () => switchRun(plan));

/*
 * Opens a project on the machine it belongs to. The only way in: a project id means nothing without
 * the daemon that minted it, so picking one out of the union is also picking a machine.
 */
export const openProject = (endpointId: string, projectId: string): Promise<SwitchOutcome> => begin({ kind: 'project', endpointId, projectId });

/*
 * The folder twin of `openProject`: a folder is a path on one machine, so opening one found while
 * browsing another daemon moves the window there. `createFolder` is browse mode's offer to make a
 * path that is not there, and the daemon makes the whole missing chain.
 */
export const openFolderOn = (endpointId: string, folder: string, createFolder = false): Promise<SwitchOutcome> =>
    begin({ kind: 'folder', endpointId, folder, createFolder });

/* A project stored in the app rather than in a folder, on one machine. */
export const createProjectOn = (endpointId: string, name: string): Promise<SwitchOutcome> => begin({ kind: 'new', endpointId, name });

/* Puts the open project away and goes back to the start screen. Its sessions end, and it moves to Recent. */
export const closeProject = async (): Promise<void> => {
    const workspace = windowWorkspace();
    if (!workspace) {
        return;
    }
    await workspace.connection.projects.closeProject();
    showStart();
};

/* Removes a project from its machine. The open one is closed first, so its sessions end with it. */
export const deleteProject = async (endpointId: string, projectId: string, removeFiles: boolean): Promise<void> => {
    const { current, currentEndpointId } = useProject.getState();
    if (windowWorkspace() && current?.projectId === projectId && currentEndpointId === endpointId) {
        await closeProject();
    }
    const machine = machineFor(endpointId);
    if (!machine) {
        throw new Error(i18next.t('project:error.machineGone'));
    }
    await machine.transport.request('project.delete', { projectId, removeFiles });
    // After the close, which wrote this client's copy on its way out.
    dropClientLocal(browserStorage(), endpointId, projectId);
    await listProjects(endpointId).catch(() => undefined);
};

/*
 * The cold start: the last project the window had open, through the same switch as any other, so a
 * machine that takes a while reads as waiting and one that does not answer says why. Anything else
 * (nothing remembered, a machine this client no longer knows, the idle row of the web client) is
 * the start screen straight away.
 */
export const bootWindow = async (
    storage: LastProjectStorage | null = browserStorage(),
    open: (endpointId: string, projectId: string) => Promise<SwitchOutcome> = openProject,
    local = hasLocalMachine()
): Promise<SwitchOutcome | null> => {
    const last = readLastProject(storage);
    const known =
        last !== null && isRealMachine(last.endpointId, local) && useEndpoints.getState().endpoints.some((endpoint) => endpoint.id === last.endpointId);
    try {
        if (!known) {
            return null;
        }
        const outcome = await open(last.endpointId, last.projectId);
        if (outcome === 'failed') {
            const state = projectSwitch.state;
            useWindow.getState().setBootFailure({ ...last, reason: state.kind === 'failed' ? state.reason : i18next.t('project:error.openFailed') });
        }
        return outcome;
    } finally {
        useWindow.getState().setBooting(false);
    }
};
