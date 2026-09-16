import type { ChatInfo, SessionInfo } from '@ruimte/contracts';
import { isInside } from '../canvas/project-paths.ts';
import type { WorktreeAgent, WorktreeAgents } from './worktree-merge.ts';

export interface WorktreeAgentSources {
    chats(): readonly ChatInfo[];
    sessions(): readonly SessionInfo[];
    /* Stops a node the way a person stopping it does, ending the agents it opened as well. */
    stopNode(nodeId: string, reason: string): Promise<void>;
}

const STOP_REASON = 'the worktree this agent worked in was merged or removed';

/*
 * The chats and terminals working in a worktree, as the daemon sees them: every one whose folder is
 * inside it, and the node the worktree was made for wherever its folder is now. A chat is in a turn
 * while it has one, a terminal while the hooks of its live agent say it runs.
 */
export const worktreeAgents = (sources: WorktreeAgentSources): WorktreeAgents => ({
    in(path, nodeId) {
        const found: WorktreeAgent[] = [];
        for (const chat of sources.chats()) {
            if (chat.chatId === nodeId || isInside(path, chat.cwd)) {
                found.push({ nodeId: chat.chatId, working: chat.activeTurnId !== null, live: chat.running });
            }
        }
        for (const session of sources.sessions()) {
            if (session.sessionId === nodeId || isInside(path, session.cwd)) {
                const agent = session.agent;
                found.push({ nodeId: session.sessionId, working: agent?.live === true && agent.status === 'running', live: !session.exited });
            }
        }
        return found;
    },
    stop: (nodeId) => sources.stopNode(nodeId, STOP_REASON)
});
