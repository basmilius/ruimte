import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { z } from 'zod';
import { RecordDirectory } from '@ruimte/agents/record-directory';

const ApprovalSchema = z.object({
    hash: z.string().min(1),
    approvedAt: z.number()
});

type Approval = z.infer<typeof ApprovalSchema>;

/* A hash rather than the command itself, so the folder does not keep a readable list of what ran where. */
const hashOf = (folder: string, nodeId: string, command: string): string =>
    createHash('sha256')
        .update(JSON.stringify([folder, nodeId, command]))
        .digest('hex');

/*
 * The commands a person on this machine let a terminal type, per project folder and node. Under
 * `$RUIMTE_HOME`, never in the project: a committed project file or an agent with a shell can put
 * any command on a node, and only a person's yes here makes the daemon type it.
 */
export class CommandApprovals {
    private readonly approvals: RecordDirectory<Approval>;

    constructor(home: string) {
        this.approvals = new RecordDirectory({ dir: join(home, 'command-approvals'), schema: ApprovalSchema, idOf: (approval) => approval.hash });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any session is made. */
    load(): Promise<void> {
        return this.approvals.load();
    }

    has(folder: string, nodeId: string, command: string): boolean {
        return this.approvals.has(hashOf(folder, nodeId, command));
    }

    async approve(folder: string, nodeId: string, command: string): Promise<void> {
        if (this.has(folder, nodeId, command)) {
            return;
        }
        await this.approvals.write({ hash: hashOf(folder, nodeId, command), approvedAt: Date.now() });
    }
}

export interface NodeCommand {
    nodeId: string;
    command: string;
}

/* The command of every terminal in these views, on a canvas or a view of its own, by node id. */
const commandsOf = (views: readonly ProjectView[]): Map<string, string> => {
    const commands = new Map<string, string>();
    for (const view of views) {
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                if (node.kind === 'terminal' && node.command) {
                    commands.set(node.id, node.command);
                }
            }
        } else if (view.kind === 'terminal' && view.node.command) {
            commands.set(view.id, view.node.command);
        }
    }
    return commands;
};

/* The commands a save sets or changes: what `after` has that `before` did not have for the same node. */
export const commandsSet = (before: readonly ProjectView[], after: readonly ProjectView[]): NodeCommand[] => {
    const had = commandsOf(before);
    return [...commandsOf(after)].filter(([nodeId, command]) => had.get(nodeId) !== command).map(([nodeId, command]) => ({ nodeId, command }));
};
