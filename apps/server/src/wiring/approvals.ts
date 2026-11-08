import { chatRequests } from '@adecore/agents/coordination';
import { launchDigest } from '../launches/store.ts';
import { commandDigest, type ApprovalPorts } from '../tunnels/approvals.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProjectsBundle } from './projects.ts';
import type { RoutinesBundle } from './routines.ts';

interface ApprovalsInput {
    stores: Pick<AgentStores, 'modeApprovals'>;
    agents: Pick<AgentsBundle, 'chats' | 'sessions'>;
    projects: ProjectsBundle;
    launches: Pick<LaunchesBundle, 'store' | 'agentHost'>;
    routines: Pick<RoutinesBundle, 'routines'>;
}

/* What waits for a person, and the answers a person's yes from the app would give. Only a credential with the approvals box reaches these. */
export function approvalPorts({ stores, agents, projects, launches, routines }: ApprovalsInput): ApprovalPorts {
    const requests = chatRequests(agents.chats);

    return {
        content: (projectId) => projects.store.read(projectId),
        folderOf: (projectId) => projects.store.index.folderOf(projectId),
        chatApprovals: (chatId) =>
            requests
                .waiting(chatId)
                .flatMap((item) => (item.kind === 'approval' ? [{ requestId: item.requestId, toolName: item.toolName, description: item.description }] : [])),
        answerChat: (chatId, requestId, decision) => agents.chats.approve(chatId, requestId, decision),
        heldCommands: () =>
            agents.sessions
                .list()
                .flatMap((session) =>
                    session.exited || session.heldCommand === undefined ? [] : [{ sessionId: session.sessionId, command: session.heldCommand }]
                ),
        approveCommand: async (sessionId, digest) => {
            // No await between the look and the call, so the command that is run is the one the digest names.
            const held = agents.sessions.list().find((session) => session.sessionId === sessionId && !session.exited);

            if (held?.heldCommand === undefined || commandDigest(held.heldCommand) !== digest) {
                return false;
            }

            await agents.sessions.runHeld(sessionId);

            return true;
        },
        unapprovedLaunches: async (projectId) =>
            (await launches.store.resolveAll(projectId))
                .filter((entry) => !entry.approved && entry.launch.kind !== 'group')
                .map((entry) => ({
                    launchId: entry.launch.id,
                    name: entry.launch.name,
                    command: entry.command,
                    folder: entry.cwd,
                    digest: launchDigest(entry)
                })),
        approveLaunch: (projectId, launchId, digest) => launches.store.approveIfUnchanged(projectId, launchId, digest),
        unapprovedRoutines: async (projectId) =>
            (await routines.routines.list(projectId)).routines
                .filter((entry) => !entry.approved)
                .map((entry) => ({ routineId: entry.routine.id, name: entry.routine.title, digest: entry.digest })),
        answerRoutine: async (projectId, routineId, digest, approve) => {
            if (approve) {
                await routines.routines.approve(projectId, routineId, digest);
            } else {
                await routines.routines.decline(projectId, routineId, digest);
            }
        },
        approvedMode: (folder, nodeId) => stores.modeApprovals.modeOf(folder, nodeId),
        approveMode: (folder, nodeId, mode) => stores.modeApprovals.approve(folder, nodeId, mode)
    };
}
