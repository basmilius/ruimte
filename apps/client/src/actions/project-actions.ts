import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import {
    isProjectIconName,
    isRecentProject,
    type ChatMovePayload,
    type ChatMoveResult,
    type ProjectClosingResult,
    type ProjectIconChoice,
    type ProjectIconName,
    type ProjectSummary
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { asksFirst } from '@/actions/developer-actions';
import { asRefusal, refusing } from '@/actions/refusal';
import { plural } from '@/actions/words';
import type { ProjectClient } from '@/clients/project/project-client';
import { sessionNodesOf } from '@/clients/project/project-sessions';
import type { SwitchOutcome } from '@/project/project-switch';
import { currentEndpointId } from '@/state/current-endpoint';
import type { DocumentState } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { windowWorkspace } from '@/workspace/window';

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
    setColor(project: ListedProject, color: string): Promise<void>;
    /* Null clears a picked icon, so the project wears its default again. */
    chooseIcon(project: ListedProject, icon: ProjectIconChoice | null): Promise<void>;
    uploadIcon(project: ListedProject, mime: string, base64: string): Promise<void>;
    useFolderIcon(project: ListedProject): Promise<void>;
    /* Moves a chat of Chats into a project, and shows it there. */
    moveChat(endpointId: string, payload: ChatMovePayload): Promise<ChatMoveResult>;
}

/* Every project of the union this window knows, with the name of its machine. */
export function listedProjects(): ListedProject[] {
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
}

type Elsewhere = (settings: typeof import('@/project/settings'), endpointId: string, projectId: string) => Promise<unknown>;

/* The project on screen writes its own file; any other is changed on its machine without opening it. */
async function changeProject(project: ListedProject, here: (projects: ProjectClient) => Promise<void>, elsewhere: Elsewhere): Promise<void> {
    const workspace = project.active ? windowWorkspace() : null;
    if (workspace !== null) {
        await here(workspace.connection.projects);
        return;
    }
    await elsewhere(await import('@/project/settings'), project.endpointId, project.projectId);
}

const LIVE_MACHINE: ProjectMachine = {
    projects: listedProjects,
    switching: async () => !['idle', 'failed'].includes((await import('@/project/open')).projectSwitch.store.getState().kind),
    open: async (endpointId, projectId) => (await import('@/project/open')).openProject(endpointId, projectId),
    openFolder: async (endpointId, folder, createFolder) => (await import('@/project/open')).openFolderOn(endpointId, folder, createFolder),
    closing: async (endpointId, summary, local) => (await import('@/project/open')).closingProject(endpointId, summary, local),
    close: async (endpointId, summary) => (await import('@/project/open')).closeProjectOn(endpointId, summary),
    remove: async (endpointId, projectId, removeFiles) => (await import('@/project/open')).deleteProject(endpointId, projectId, removeFiles),
    rename: (project, name) =>
        changeProject(
            project,
            (here) => here.rename(name),
            (there, ...ids) => there.setProjectIdentity(...ids, { name })
        ),
    setColor: (project, color) =>
        changeProject(
            project,
            (here) => here.setColor(color),
            (there, ...ids) => there.setProjectIdentity(...ids, { color })
        ),
    chooseIcon: (project, icon) =>
        changeProject(
            project,
            (here) => here.setChosenIcon(icon),
            (there, ...ids) => there.setProjectIdentity(...ids, { icon })
        ),
    uploadIcon: (project, mime, base64) =>
        changeProject(
            project,
            (here) => here.uploadIcon(mime, base64),
            (there, ...ids) => there.uploadProjectIcon(...ids, mime, base64)
        ),
    useFolderIcon: (project) =>
        changeProject(
            project,
            (here) => here.useFolderIcon(),
            (there, ...ids) => there.setProjectFolderIcon(...ids)
        ),
    moveChat: async (endpointId, payload) => (await import('@/project/move-chat')).moveChatOn(endpointId, payload)
};

/* In the words the close dialog uses, so Voice asks what a person reads. */
function closeConsequences(answer: ProjectClosingResult | null): string[] {
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
}

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
            const local = project.active && windowWorkspace() !== null ? sessionNodesOf(document.getState().exportViews()).length : null;
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
        'chat.move': async ({ endpointId, chatId, to, ownFiles }) => {
            const result = await refusing(machine.moveChat(endpointId, { chatId, to, ownFiles }));
            return { output: { project: result.summary.name, projectId: result.summary.projectId, viewId: result.viewId } };
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
            await refusing(machine.remove(endpointId, projectId, removeFiles === true));
            return { output: projectOutput(project) };
        },
        'project.setAppearance': async ({ endpointId, projectId, name, icon, image, color }) => {
            const project = listed(endpointId, projectId);
            if (name == null && icon == null && image == null && color == null) {
                throw new ActionRefusal('nothing-to-change', 'Give a name, an icon, an image or a color.');
            }
            if (icon != null && image != null) {
                throw new ActionRefusal('two-icons', 'Give an icon or an image, not both.');
            }
            if (icon != null && icon !== 'folder' && icon !== 'none' && !isProjectIconName(icon)) {
                throw new ActionRefusal('unknown-icon', `“${icon}” is not one of the Lucide names the picker has.`);
            }
            try {
                if (name != null && name !== project.name) {
                    await machine.rename(project, name);
                }
                if (color != null && color !== project.summary.color) {
                    await machine.setColor(project, color);
                }
                if (image != null) {
                    await machine.uploadIcon(project, image.mime, image.base64);
                } else if (icon === 'folder') {
                    await machine.useFolderIcon(project);
                } else if (icon === 'none') {
                    await machine.chooseIcon(project, null);
                } else if (icon != null) {
                    await machine.chooseIcon(project, { kind: 'lucide', value: icon as ProjectIconName });
                }
            } catch (error: unknown) {
                throw asRefusal(error);
            }
            const now = listed(endpointId, projectId);
            return {
                output: {
                    ...projectOutput(now),
                    project: name ?? now.name,
                    icon: image != null ? 'image' : icon == null || icon === 'none' ? now.summary.icon.kind : icon
                }
            };
        }
    };
}
