import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { isRecentProject, PROJECT_ICON_NAMES, type ProjectClosingResult, type ProjectIconChoice, type ProjectSummary } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { asksFirst, asRefusal } from '@/actions/developer-actions';
import type { SwitchOutcome } from '@/project/project-switch';
import { sessionNodesOf } from '@/project/project-sessions';
import type { DocumentState } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { windowWorkspace } from '@/state/window';
export interface ListedProject {
    endpointId: string;
    projectId: string;
    name: string;
    machine: string;
    folder: string;
    recent: boolean;
    active: boolean;
    available: boolean;
    summary: ProjectSummary;
}

/* What the project actions reach outside the document; a test hands in a fake of each. */
export interface ProjectMachine {
    projects(): ListedProject[];
    /* True while a switch runs, which a second switch must not overtake. */
    switching(): Promise<boolean>;
    open(endpointId: string, projectId: string): Promise<SwitchOutcome>;
    openFolder(endpointId: string, folder: string, createFolder: boolean): Promise<SwitchOutcome>;
    /* What closing would end, asked of the machine; null for a machine that cannot be reached. */
    closing(endpointId: string, summary: ProjectSummary, local: number | null): Promise<ProjectClosingResult | null>;
    close(endpointId: string, summary: ProjectSummary): Promise<void>;
    remove(endpointId: string, projectId: string, removeFiles: boolean): Promise<void>;
    rename(project: ListedProject, name: string): Promise<void>;
    chooseIcon(project: ListedProject, icon: ProjectIconChoice): Promise<void>;
    uploadIcon(project: ListedProject, mime: string, base64: string): Promise<void>;
    useFolderIcon(project: ListedProject): Promise<void>;
}

/* Every project of the union this window knows, with the name of its machine. */
export const listedProjects = (): ListedProject[] => {
    const current = useProject.getState();
    const endpoints = useEndpoints.getState().endpoints;
    return useProjectList.getState().projects.map(({ endpointId, summary }) => ({
        endpointId,
        projectId: summary.projectId,
        name: summary.name,
        machine: endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? endpointId,
        folder: summary.folder,
        recent: isRecentProject(summary),
        active: current.currentEndpointId === endpointId && current.current?.projectId === summary.projectId,
        available: summary.available,
        summary
    }));
};

const isHere = (project: ListedProject): boolean => project.active && windowWorkspace() !== null;

const LIVE_MACHINE: ProjectMachine = {
    projects: listedProjects,
    switching: async () => !['idle', 'failed'].includes((await import('@/project/open')).projectSwitch.store.getState().kind),
    open: async (endpointId, projectId) => (await import('@/project/open')).openProject(endpointId, projectId),
    openFolder: async (endpointId, folder, createFolder) => (await import('@/project/open')).openFolderOn(endpointId, folder, createFolder),
    closing: async (endpointId, summary, local) => (await import('@/project/open')).closingProject(endpointId, summary, local),
    close: async (endpointId, summary) => (await import('@/project/open')).closeProjectOn(endpointId, summary),
    remove: async (endpointId, projectId, removeFiles) => (await import('@/project/open')).deleteProject(endpointId, projectId, removeFiles),
    // The project on screen writes its own file; any other is changed on its machine without opening it.
    rename: async (project, name) => {
        if (isHere(project)) {
            await windowWorkspace()!.connection.projects.rename(name);
            return;
        }
        await (await import('@/project/settings')).setProjectIdentity(project.endpointId, project.projectId, { name });
    },
    chooseIcon: async (project, icon) => {
        if (isHere(project)) {
            await windowWorkspace()!.connection.projects.setChosenIcon(icon);
            return;
        }
        await (await import('@/project/settings')).setProjectIdentity(project.endpointId, project.projectId, { icon });
    },
    uploadIcon: async (project, mime, base64) => {
        if (isHere(project)) {
            await windowWorkspace()!.connection.projects.uploadIcon(mime, base64);
            return;
        }
        await (await import('@/project/settings')).uploadProjectIcon(project.endpointId, project.projectId, mime, base64);
    },
    useFolderIcon: async (project) => {
        if (isHere(project)) {
            await windowWorkspace()!.connection.projects.useFolderIcon();
            return;
        }
        await (await import('@/project/settings')).setProjectFolderIcon(project.endpointId, project.projectId);
    }
};

const plural = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;

/* In the words the close dialog uses, so Voice asks what a person reads. */
const closeConsequences = (answer: ProjectClosingResult | null): string[] => {
    if (answer === null) {
        return ['Its machine cannot be reached, so only this window lets go of it.'];
    }
    if (answer.otherClients > 0) {
        return [
            `${plural(answer.otherClients, 'other client')} still ${answer.otherClients === 1 ? 'has' : 'have'} it open, so nothing stops running. It moves to Recent here only.`
        ];
    }
    return answer.sessions === 0
        ? ['Nothing in it is running. It moves to Recent just as it was left.']
        : [
              `${plural(answer.sessions, 'running session')} ${answer.sessions === 1 ? 'ends' : 'end'}: a terminal loses its scrollback and an agent stops. The rest moves to Recent.`
          ];
};

/*
 * What a person does to a project from the project menu, the start screen and the palette. Opening
 * one and closing it are this window's; the machine keeps a project and its sessions for as long as
 * another client has it open, and only the last one out ends them.
 */
export function projectActions(document: StoreApi<DocumentState>, overrides: Partial<ProjectMachine> = {}): ActionHandlers<void> {
    const machine: ProjectMachine = { ...LIVE_MACHINE, ...overrides };

    const listed = (endpointId: string, projectId: string): ListedProject => {
        const project = machine.projects().find((row) => row.endpointId === endpointId && row.projectId === projectId);
        if (!project) {
            throw new ActionRefusal('unknown-project', 'That project is not in the list of this window. Read project.list for the ids.');
        }
        return project;
    };

    const switched = (outcome: SwitchOutcome, what: string): void => {
        if (outcome !== 'done') {
            throw new ActionRefusal('project-switch-failed', `Opening ${what} ended ${outcome}. Do not claim it is open.`);
        }
    };

    const projectOutput = (project: ListedProject) => ({ project: project.name, endpointId: project.endpointId, projectId: project.projectId });

    return {
        'project.list': () => ({ output: { projects: machine.projects().map(({ summary: _summary, ...row }) => row) } }),
        'project.switch': async ({ endpointId, projectId }) => {
            const project = listed(endpointId, projectId);
            if (!project.available) {
                throw new ActionRefusal('project-unavailable', `The folder of “${project.name}” is gone from its machine.`);
            }
            if (await machine.switching()) {
                throw new ActionRefusal('project-switching', 'Another project switch is in progress. Wait for it to finish.');
            }
            switched(await machine.open(endpointId, projectId), `“${project.name}”`);
            return { output: projectOutput(project) };
        },
        'project.close': async ({ endpointId, projectId }, call) => {
            const project = listed(endpointId, projectId);
            if (project.recent) {
                throw new ActionRefusal('already-closed', `“${project.name}” is already under Recent.`);
            }
            // Only the project on screen has a document here to count; every other one is its machine's to answer.
            const local = isHere(project) ? sessionNodesOf(document.getState().exportViews()).length : null;
            const answer = await machine.closing(endpointId, project.summary, local);
            if (asksFirst(call)) {
                return { confirmation: { title: `Close “${project.name}”?`, consequences: closeConsequences(answer) } };
            }
            await machine.close(endpointId, project.summary);
            return { output: { ...projectOutput(project), sessions: answer?.sessions ?? null, otherClients: answer?.otherClients ?? null } };
        },
        'project.create': async ({ endpointId, folder, createFolder }) => {
            switched(await machine.openFolder(endpointId, folder, createFolder === true), folder);
            return { output: { project: useProject.getState().current?.name ?? folder, endpointId: currentEndpointId(), folder } };
        },
        'project.delete': async ({ endpointId, projectId, removeFiles }, { confirmed }) => {
            const project = listed(endpointId, projectId);
            if (!confirmed) {
                return {
                    confirmation: {
                        title: `Delete “${project.name}”?`,
                        consequences: [
                            `It leaves the list of ${project.machine}${project.active ? ', and closes here first so its sessions end' : ''}.`,
                            removeFiles === true
                                ? `Its canvas file in ${project.folder} is removed too; every other file in the folder stays.`
                                : `The folder ${project.folder} and every file in it stay.`
                        ]
                    }
                };
            }
            try {
                await machine.remove(endpointId, projectId, removeFiles === true);
            } catch (error: unknown) {
                throw asRefusal(error);
            }
            return { output: projectOutput(project) };
        },
        'project.setAppearance': async ({ endpointId, projectId, name, icon, image }) => {
            const project = listed(endpointId, projectId);
            if (name == null && icon == null && image == null) {
                throw new ActionRefusal('nothing-to-change', 'Give a name, an icon or an image.');
            }
            if (icon != null && image != null) {
                throw new ActionRefusal('two-icons', 'Give an icon or an image, not both.');
            }
            if (icon != null && icon !== 'folder' && !(PROJECT_ICON_NAMES as readonly string[]).includes(icon)) {
                throw new ActionRefusal('unknown-icon', `“${icon}” is not one of the Lucide names the picker has.`);
            }
            try {
                if (name != null && name !== project.name) {
                    await machine.rename(project, name);
                }
                if (image != null) {
                    await machine.uploadIcon(project, image.mime, image.base64);
                } else if (icon === 'folder') {
                    await machine.useFolderIcon(project);
                } else if (icon != null) {
                    await machine.chooseIcon(project, { kind: 'lucide', value: icon as (typeof PROJECT_ICON_NAMES)[number] });
                }
            } catch (error: unknown) {
                throw asRefusal(error);
            }
            const now = listed(endpointId, projectId);
            return { output: { ...projectOutput(now), project: name ?? now.name, icon: image != null ? 'image' : (icon ?? now.summary.icon.kind) } };
        }
    };
}
