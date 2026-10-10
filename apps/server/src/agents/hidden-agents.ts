import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents/record-directory';
import { ProjectNodeSchema } from '@ruimte/contracts';
import { z } from 'zod';
import type { AgentLineageStore } from '@adecore/agents/lineage';
import type { TaskStore } from '@adecore/agents/tasks/task-store';
import type { OutboxStore } from '../outbox/outbox.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { SessionManager } from '../sessions/manager.ts';

const HiddenAgentSchema = z.object({
    projectId: z.string().min(1),
    openedBy: z.string().min(1),
    node: ProjectNodeSchema.extend({ kind: z.enum(['chat', 'terminal']) })
});

export type HiddenAgent = z.infer<typeof HiddenAgentSchema>;

/* The agents a caller holds open: a hidden one counts only while it still runs, has an open task or is owed work. */
export function openedAgentCount(
    deps: {
        lineage: AgentLineageStore;
        hiddenAgents: HiddenAgentStore;
        tasks: TaskStore;
        outbox: OutboxStore;
        chats: Pick<ChatManager, 'get'>;
        sessions: Pick<SessionManager, 'get'>;
    },
    caller: string
): number {
    return deps.lineage.openedCount(caller, (id) => {
        if (deps.hiddenAgents.get(id) === undefined) {
            return true;
        }
        const status = deps.chats.get(id)?.info.status;
        return (
            status === 'running' ||
            status === 'needs-you' ||
            deps.sessions.get(id)?.exited === false ||
            deps.tasks.involving(id).some((task) => task.childId === id && task.status === 'open') ||
            deps.outbox.list().some((entry) => entry.target === id)
        );
    });
}

// Hidden sessions belong to their parent chat, so they never enter a project's views or shared file.
export class HiddenAgentStore {
    private readonly records: RecordDirectory<HiddenAgent>;
    private loading: Promise<void> | null = null;
    onChange: ((projectId: string) => void) | null = null;

    constructor(home: string) {
        this.records = new RecordDirectory({ dir: join(home, 'hidden-agents'), schema: HiddenAgentSchema, idOf: (agent) => agent.node.id });
    }

    load(): Promise<void> {
        this.loading ??= this.records.load();
        return this.loading;
    }

    get(id: string): HiddenAgent | undefined {
        return this.records.get(id);
    }

    inProject(projectId: string): HiddenAgent[] {
        return this.records.all().filter((agent) => agent.projectId === projectId);
    }

    async put(agent: HiddenAgent): Promise<void> {
        await this.records.write(agent);
        this.onChange?.(agent.projectId);
    }

    async pruneOrphans(projectId: string, placed: ReadonlySet<string>): Promise<void> {
        const agents = this.inProject(projectId);
        const kept = new Set(placed);
        let added = true;
        while (added) {
            added = false;
            for (const agent of agents) {
                if (kept.has(agent.openedBy) && !kept.has(agent.node.id)) {
                    kept.add(agent.node.id);
                    added = true;
                }
            }
        }
        await this.records.prune((agent) => agent.projectId === projectId && !kept.has(agent.node.id));
        this.onChange?.(projectId);
    }
}
