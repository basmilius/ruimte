import { isRecentProject, type ProjectAgentAskEvent, type ProjectAgentFolderEvent, type ProjectClosingResult, type ProjectSummary } from '@ruimte/contracts';
import i18next from 'i18next';
import { create } from 'zustand';
import { closingProject, isOpenHere, openProject } from '@/project/open';
import type { SwitchOutcome } from '@/project/project-switch';
import { showMoveToast } from '@/project/show-toast';
import { callerName } from '@/project/show-view';
import { nodesOfView } from '@/project/view-nodes';
import { useDocument } from '@/state/document';
import { useProjectList } from '@/state/project-list';
import { useSettings } from '@/state/settings';
import { watchPool } from '@/transport/pool-watch';

/* The confirmation an agent's `project_close` raised, with what the machine said closing would end. */
export interface AgentCloseAsk extends ProjectClosingResult {
    endpointId: string;
    projectId: string;
    name: string;
    agent: string;
}

export const useAgentCloseAsk = create<{ ask: AgentCloseAsk | null }>(() => ({ ask: null }));

/* The folder an agent's `project_open` asked to make a project; only the person's own open of it makes one. */
export interface AgentFolderAsk {
    endpointId: string;
    folder: string;
    agent: string;
}

export const useAgentFolderAsk = create<{ ask: AgentFolderAsk | null }>(() => ({ ask: null }));

/* What the watch reaches outside the event; a test hands in a fake of each. */
export interface AgentProjectDeps {
    showing(endpointId: string, projectId: string): boolean;
    listed(endpointId: string, projectId: string): ProjectSummary | null;
    follow(): boolean;
    open(endpointId: string, projectId: string): Promise<SwitchOutcome>;
    closing(endpointId: string, summary: ProjectSummary): Promise<ProjectClosingResult | null>;
}

const LIVE: AgentProjectDeps = {
    showing: isOpenHere,
    listed: (endpointId, projectId) =>
        useProjectList.getState().projects.find((row) => row.endpointId === endpointId && row.summary.projectId === projectId)?.summary ?? null,
    follow: () => useSettings.getState().agentsShowViews,
    open: openProject,
    // Another project than the one on screen, so the machine counts its sessions.
    closing: (endpointId, summary) => closingProject(endpointId, summary, null)
};

function agentOf(payload: Pick<ProjectAgentAskEvent, 'by'>): string {
    return callerName(useDocument.getState().views, nodesOfView, payload.by) ?? i18next.t('project:showView.someone');
}

/*
 * `project_activate`, as `view_open` for a whole project: with "Let agents switch views" on the window
 * opens it, with a toast back to where the person was; off, the toast offers to go there. A project
 * another window has comes forward in that window, which then needs no toast here.
 */
export async function activateProject(endpointId: string, payload: ProjectAgentAskEvent, deps: AgentProjectDeps = LIVE): Promise<void> {
    const summary = deps.listed(endpointId, payload.projectId);
    if (!deps.showing(endpointId, payload.fromProjectId) || summary === null) {
        return;
    }
    const agent = agentOf(payload);
    if (!deps.follow()) {
        showMoveToast(i18next.t('project:showProject.go', { agent, project: summary.name }), {
            label: 'goThere',
            run: () => void deps.open(endpointId, payload.projectId)
        });
        return;
    }
    if ((await deps.open(endpointId, payload.projectId)) !== 'done' || !deps.showing(endpointId, payload.projectId)) {
        return;
    }
    showMoveToast(i18next.t('project:showProject.follow', { agent, project: summary.name }), {
        label: 'back',
        run: () => void deps.open(endpointId, payload.fromProjectId)
    });
}

/* `project_close` raises the confirmation a person sees when they close the project themselves; only their answer closes it. */
export async function askToClose(endpointId: string, payload: ProjectAgentAskEvent, deps: AgentProjectDeps = LIVE): Promise<void> {
    const summary = deps.listed(endpointId, payload.projectId);
    if (!deps.showing(endpointId, payload.fromProjectId) || summary === null || isRecentProject(summary)) {
        return;
    }
    const agent = agentOf(payload);
    const answer = await deps.closing(endpointId, summary);
    if (answer === null) {
        return;
    }
    useAgentCloseAsk.setState({ ask: { endpointId, projectId: payload.projectId, name: summary.name, agent, ...answer } });
}

/* `project_open` of a folder without a project raises a confirmation; the person's answer is their own open of the folder. */
export function askToOpenFolder(endpointId: string, payload: ProjectAgentFolderEvent, deps: Pick<AgentProjectDeps, 'showing'> = LIVE): void {
    if (!deps.showing(endpointId, payload.fromProjectId)) {
        return;
    }

    useAgentFolderAsk.setState({ ask: { endpointId, folder: payload.folder, agent: agentOf(payload) } });
}

/* The daemon tells only the clients with the agent's project open; this side still checks it is the one on screen. */
export function startAgentProjectWatch(): () => void {
    return watchPool((link, endpointId) => ({
        subscriptions: [
            link.on('project.activate', (payload) => void activateProject(endpointId, payload)),
            link.on('project.askClose', (payload) => void askToClose(endpointId, payload)),
            link.on('project.askOpen', (payload) => askToOpenFolder(endpointId, payload))
        ]
    }));
}
