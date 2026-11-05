import type { RuntimeMode } from '@ruimte/contracts';
import type { CommandApprovals } from '../sessions/command-approvals.ts';
import { SessionError, type CommandGate } from '../sessions/manager.ts';
import { startCwdGuard } from '../tools/project-paths.ts';

interface AgentBoundsDeps {
    commandApprovals: Pick<CommandApprovals, 'has' | 'approve'>;
    /* The widest mode the lineage gives a node; null for no limit. */
    ceilingOf(nodeId: string): RuntimeMode | null;
    madeByAgent(nodeId: string): boolean;
    /* The folder of the project that places the node; null when no project this machine knows does. */
    folderOf(nodeId: string): string | null;
    worktreePaths(folder: string): Promise<string[]>;
}

/* What a terminal or a chat may start with: an approved command, a mode under its parent's and a cwd in its project. */
export interface AgentBounds {
    commands: CommandGate;
    modeCeiling(nodeId: string): RuntimeMode | null;
    checkCwd(nodeId: string, cwd: string): Promise<void>;
}

/* The one place the daemon's terminals and chats take their bounds from, so neither can be built without them. */
export function agentBounds(deps: AgentBoundsDeps): AgentBounds {
    return {
        // A node no project places yet has no folder to approve against, so its command waits for the save that adds it.
        commands: {
            approved: (nodeId, command, cwd) => {
                const folder = deps.folderOf(nodeId);

                return folder !== null && deps.commandApprovals.has(folder, nodeId, command, cwd);
            },
            approve: async (nodeId, command, cwd) => {
                const folder = deps.folderOf(nodeId);

                if (folder === null) {
                    throw new SessionError('session-not-found', `No project this machine knows places ${nodeId}`);
                }

                await deps.commandApprovals.approve(folder, nodeId, command, cwd);
            }
        },
        modeCeiling: (nodeId) => deps.ceilingOf(nodeId),
        checkCwd: startCwdGuard({ madeByAgent: deps.madeByAgent, folderOf: deps.folderOf, worktreePaths: deps.worktreePaths })
    };
}
