import { chatIsWorking } from '@ruimte/contracts';
import { StartClaims } from '../actions/start-claims.ts';
import type { ComputerUse } from '../computer/computer-use.ts';
import { errorText } from '../error-text.ts';
import { isTrackedPath } from '../git/ignore.ts';
import { DiagramStore } from '../projects/diagram-store.ts';
import { DrawingStore } from '../projects/drawing-store.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { commandsSet } from '../sessions/command-approvals.ts';
import { modesSet } from '../sessions/mode-approvals.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { DatabasesBundle } from './databases.ts';
import type { LanguageBundle } from './language.ts';
import type { LaunchesBundle } from './launches.ts';
import type { TemplatesBundle } from './templates.ts';

/* The projects of this machine and the drawing and diagram files beside them. */
export interface ProjectsBundle {
    store: ProjectStore;
    /* What a retried `agent --request-id` answers with. */
    startClaims: StartClaims;
    drawings: DrawingStore;
    diagrams: DiagramStore;
    /*
     * Ends the shell or the CLI behind a node. A node that has never been shown has no session, and a
     * project going down is not the place to fail over one, so an id neither manager knows is
     * already ended as far as the caller goes.
     */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
}

interface ProjectsInput {
    home: string;
    machineId: string;
    stores: AgentStores;
    agents: AgentsBundle;
    computer: ComputerUse;
    later: {
        launches(): LaunchesBundle;
        work(): AgentWorkBundle;
        databases(): DatabasesBundle;
        language(): LanguageBundle;
        templates(): TemplatesBundle;
    };
}

export async function wireProjects({ home, machineId, stores, agents, computer, later }: ProjectsInput): Promise<ProjectsBundle> {
    const { sessions, chats } = agents;
    const endSession = async (kind: 'terminal' | 'chat', nodeId: string): Promise<void> => {
        computer.nodeClosed(nodeId);
        later.launches().secrets.nodeClosed(nodeId);
        agents.proposals.forget(nodeId);
        await later.work().endChildren.owe(nodeId);
        await (kind === 'terminal' ? sessions.kill(nodeId) : chats.kill(nodeId)).catch(() => undefined);
    };
    const store = new ProjectStore(home, {
        tracked: isTrackedPath,
        endSession,
        personSaved: async (folder, before, after) => {
            for (const { nodeId, command } of commandsSet(before, after)) {
                try {
                    await stores.commandApprovals.approve(folder, nodeId, command);
                } catch (e) {
                    // Not approved is only asked again; the save itself already landed.
                    console.error(`Approving the command of ${nodeId} failed:`, errorText(e));
                    continue;
                }
                sessions.runApproved(nodeId, command);
            }
            for (const { nodeId, mode } of modesSet(before, after)) {
                // Not written down narrows the node to the mode its person picks for new terminals, which is safe to retry.
                await stores.modeApprovals
                    .approve(folder, nodeId, mode)
                    .catch((e: unknown) => console.error(`Approving the mode of ${nodeId} failed:`, errorText(e)));
            }
        },
        launches: {
            opened: (projectId) => void later.launches().runner.opened(projectId),
            running: (projectId) => later.launches().runner.running(projectId),
            end: (projectId) => later.launches().runner.end(projectId)
        },
        language: { end: (projectId) => later.language().host.end(projectId) },
        provenance: { forget: (projectId) => later.language().provenance.forget(projectId) },
        databases: {
            closeProject: (projectId) => {
                later.databases().connections.closeProject(projectId);
                later.databases().agents.letGo(projectId);
            },
            forgetProject: (projectId) => later.databases().snapshots.forgetProject(projectId)
        },
        templates: { closeProject: (projectId) => later.templates().store.closeProject(projectId) },
        bindings: {
            machineId,
            started: async (nodeId) => sessions.get(nodeId) !== undefined || stores.lineage.madeBy(nodeId) !== null || (await chats.readChat(nodeId)) !== null
        },
        viewFiles: () => [drawings, diagrams],
        chatWorking: (chatId) => {
            const session = chats.get(chatId);

            return session !== undefined && (session.busy || chatIsWorking(session.info));
        }
    });
    await store.hiddenAgents.load();
    await store.remote.load();
    await store.peers.load();
    const startClaims = new StartClaims(home);
    await startClaims.load();
    const drawings = new DrawingStore(store);
    const diagrams = new DiagramStore(store);
    return { store, startClaims, drawings, diagrams, endSession };
}
