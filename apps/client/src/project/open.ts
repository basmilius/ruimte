import { useStore } from 'zustand';
import { activateEndpoint } from '@/endpoint';
import { ensureMachine } from '@/endpoint/reach';
import { projectClient } from '@/project';
import { rememberProject, readLastProject, browserStorage } from '@/project/last-project';
import { ProjectSwitch, type SwitchOutcome, type SwitchRun, type SwitchState, type SwitchTarget } from '@/project/project-switch';
import { useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';

/* Where the client is going: a project, a folder, or only a machine (the welcome screen of the web client). */
export type SwitchPlan =
    | { kind: 'project'; endpointId: string; projectId: string }
    | { kind: 'folder'; endpointId: string; folder: string; createFolder: boolean }
    | { kind: 'machine'; endpointId: string };

/* Where the client stood when a switch began, which is where a cancel returns to. */
export interface Whereabouts {
    endpointId: string;
    projectId: string | null;
}

/* The pieces a test stands in for; every call site in the app passes none of them. */
export interface SwitchDeps {
    ensure(endpointId: string, signal: AbortSignal): Promise<string>;
    activeId(): string;
    current(): { projectId: string | null; endpointId: string | null };
    activate(endpointId: string): Promise<void>;
    settle(): Promise<void>;
    openProject(projectId: string): Promise<void>;
    openFolder(folder: string, createFolder: boolean): Promise<void>;
    remembered(endpointId: string): string | null;
    remember(endpointId: string, projectId: string | null): void;
}

const REAL_DEPS: SwitchDeps = {
    ensure: ensureMachine,
    activeId: () => useEndpoints.getState().activeId,
    current: () => {
        const { current, currentEndpointId } = useProject.getState();
        return { projectId: current?.projectId ?? null, endpointId: currentEndpointId };
    },
    activate: activateEndpoint,
    settle: () => projectClient.settled(),
    openProject: (projectId) => projectClient.openProject(projectId),
    openFolder: (folder, createFolder) => projectClient.openFolder(folder, createFolder),
    remembered: (endpointId) => readLastProject(browserStorage(), null).byEndpoint[endpointId] ?? null,
    remember: (endpointId, projectId) => rememberProject(endpointId, projectId)
};

/*
 * The steps of one switch. The machine is reached before anything moves, the active one included,
 * since no machine keeps a link while nothing is open on it; one that does not answer leaves the
 * client where it was. The old project is then flushed on its own endpoint's socket, which is what the
 * order below is for. A run remembers whether it moved the client, so going back undoes exactly that.
 */
export const switchRun = (plan: SwitchPlan, previous: Whereabouts, deps: SwitchDeps = REAL_DEPS): SwitchRun => {
    let moved: { endpointId: string; remembered: string | null } | null = null;
    return {
        async steps({ signal, opening }) {
            const id = await deps.ensure(plan.endpointId, signal);
            if (signal.aborted) {
                return;
            }
            opening();
            if (id !== deps.activeId()) {
                moved = { endpointId: id, remembered: deps.remembered(id) };
                if (plan.kind === 'project') {
                    // Written before the switch, so the machine that takes over boots into this project and not into what it had last.
                    deps.remember(id, plan.projectId);
                }
                await deps.activate(id);
                // The machine that took over may still be opening what it had last; anything opened on top of that would race.
                await deps.settle();
            } else if (plan.kind === 'project') {
                await deps.settle();
            }
            if (signal.aborted) {
                return;
            }
            if (plan.kind === 'project') {
                const current = deps.current();
                if (current.projectId !== plan.projectId || current.endpointId !== id) {
                    await deps.openProject(plan.projectId);
                }
            } else if (plan.kind === 'folder') {
                await deps.openFolder(plan.folder, plan.createFolder);
            }
        },
        async back() {
            if (moved !== null) {
                deps.remember(moved.endpointId, moved.remembered);
                if (previous.projectId !== null) {
                    deps.remember(previous.endpointId, previous.projectId);
                }
                // The machine before boots into what it remembered, which is the project that was on screen.
                await deps.activate(previous.endpointId);
                await deps.settle();
                return;
            }
            const current = deps.current();
            if (previous.projectId !== null && previous.endpointId === deps.activeId() && current.projectId !== previous.projectId) {
                await deps.openProject(previous.projectId);
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
    folder: plan.kind === 'folder' ? plan.folder : null
});

/* Every way into a project passes here, so the main column can say what the client is waiting on. */
const begin = (plan: SwitchPlan): Promise<SwitchOutcome> => {
    const { current, currentEndpointId } = useProject.getState();
    const previous: Whereabouts = { endpointId: currentEndpointId ?? useEndpoints.getState().activeId, projectId: current?.projectId ?? null };
    return projectSwitch.start(targetOf(plan), () => switchRun(plan, previous));
};

/*
 * Opens a project on the machine it belongs to. The only way in: a project id means nothing without
 * the daemon that minted it, so picking one out of the union is also picking a machine.
 */
export const openProject = (endpointId: string, projectId: string): Promise<SwitchOutcome> => begin({ kind: 'project', endpointId, projectId });

/*
 * The folder twin of `openProject`: a folder is a path on one machine, so opening one found while
 * browsing another daemon has to move the whole client there first. `createFolder` is browse mode's
 * offer to make a path that is not there, and the daemon makes the whole missing chain.
 */
export const openFolderOn = (endpointId: string, folder: string, createFolder = false): Promise<SwitchOutcome> =>
    begin({ kind: 'folder', endpointId, folder, createFolder });

/* A machine with nothing picked on it yet: it boots into what it remembered, if anything. */
export const openMachine = (endpointId: string): Promise<SwitchOutcome> => begin({ kind: 'machine', endpointId });

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
