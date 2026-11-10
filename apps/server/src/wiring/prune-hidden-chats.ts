import type { AgentLineageStore, TaskStore } from '@adecore/agents/coordination';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { HiddenAgentStore } from '../projects/hidden-agents.ts';
import type { ProjectIndex } from '../projects/project-index.ts';

// How long a hidden agent's chat stays after its task settled; its parent keeps the task's result.
export const HIDDEN_CHAT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface HiddenChatPruning {
    hiddenAgents: Pick<HiddenAgentStore, 'all' | 'remove'>;
    index: Pick<ProjectIndex, 'has' | 'placed'>;
    tasks: Pick<TaskStore, 'involving'>;
    lineage: Pick<AgentLineageStore, 'descendants'>;
    chats: Pick<ChatManager, 'dropStored'>;
    now: () => number;
}

/*
 * The hidden agent chats nobody can reach any more: every task it was given settled before `now`
 * less the keep, no view of any project holds it, and no agent it opened lives on. A chat of a
 * project the daemon could not read stays, since one of that project's views may hold it.
 */
function prunableHiddenChats(deps: Omit<HiddenChatPruning, 'chats' | 'now'>, now: number): Set<string> {
    const settledBefore = now - HIDDEN_CHAT_KEEP_MS;
    const settledLongAgo = (id: string): boolean => {
        const given = deps.tasks.involving(id).filter((task) => task.childId === id);
        return given.length > 0 && given.every((task) => task.status !== 'open' && task.settledAt !== null && task.settledAt < settledBefore);
    };
    const prunable = new Set(
        deps.hiddenAgents
            .all()
            .filter(
                (agent) => agent.node.kind === 'chat' && deps.index.has(agent.projectId) && !deps.index.placed(agent.node.id) && settledLongAgo(agent.node.id)
            )
            .map((agent) => agent.node.id)
    );
    // A child that stays keeps every chat above it, so this runs until nothing more drops out.
    let dropped = true;
    while (dropped) {
        dropped = false;
        for (const id of prunable) {
            if (deps.lineage.descendants(id).some((child) => !prunable.has(child))) {
                prunable.delete(id);
                dropped = true;
            }
        }
    }
    return prunable;
}

/*
 * Runs once as the daemon starts, never on a clock. Each chat goes with its record and what is kept
 * for it; forgetting the hidden agent then prunes its lineage, outbox entries and tasks the way a
 * deleted node does. Returns the ids it removed.
 */
export async function pruneHiddenChats(deps: HiddenChatPruning): Promise<string[]> {
    const removed = new Set<string>();
    for (const id of prunableHiddenChats(deps, deps.now())) {
        if (await deps.chats.dropStored(id)) {
            removed.add(id);
        }
    }
    if (removed.size > 0) {
        await deps.hiddenAgents.remove(removed);
    }
    return [...removed];
}
