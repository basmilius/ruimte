import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { isCanvasView, type ProjectView, type StandaloneNode } from '@ruimte/contracts';
import { z } from 'zod';

const ApprovalSchema = z.object({
    hash: z.string().min(1),
    approvedAt: z.number()
});

type Approval = z.infer<typeof ApprovalSchema>;

/* A hash rather than the command itself, so the folder does not keep a readable list of what ran where. */
export function approvalHash(...parts: string[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/* Every terminal of these views, on a canvas or a view of its own, by the id its session runs under. */
export function terminalsOf(views: readonly ProjectView[]): Array<{ id: string; node: StandaloneNode }> {
    return views.flatMap((view) => {
        if (isCanvasView(view)) {
            return view.nodes.flatMap((node) => (node.kind === 'terminal' ? [{ id: node.id, node }] : []));
        }

        return view.kind === 'terminal' ? [{ id: view.id, node: view.node }] : [];
    });
}

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

    /* `cwd` is where a terminal types the command; a launch or a routine binds its own in the digest it passes as `command`. */
    has(folder: string, nodeId: string, command: string, cwd?: string): boolean {
        return this.approvals.has(hashOf(folder, nodeId, command, cwd));
    }

    async approve(folder: string, nodeId: string, command: string, cwd?: string): Promise<void> {
        if (this.has(folder, nodeId, command, cwd)) {
            return;
        }
        await this.approvals.write({ hash: hashOf(folder, nodeId, command, cwd), approvedAt: Date.now() });
    }
}

// A terminal in its project folder hashes as it did before the cwd was bound, so the approvals made then still hold.
function hashOf(folder: string, nodeId: string, command: string, cwd: string | undefined): string {
    if (cwd === undefined || resolve(cwd) === resolve(folder)) {
        return approvalHash(folder, nodeId, command);
    }

    return approvalHash(folder, nodeId, command, resolve(cwd));
}

interface NodeCommand {
    nodeId: string;
    command: string;
    // The node's own cwd; without one the terminal runs in the project folder.
    cwd?: string;
}

function commandsOf(views: readonly ProjectView[]): Map<string, NodeCommand> {
    return new Map(
        terminalsOf(views).flatMap(({ id, node }) =>
            node.command ? [[id, { nodeId: id, command: node.command, ...(node.cwd ? { cwd: node.cwd } : {}) }] as const] : []
        )
    );
}

/* The commands a save sets or changes: what `after` has that `before` did not have for the same node, its cwd included. */
export function commandsSet(before: readonly ProjectView[], after: readonly ProjectView[]): NodeCommand[] {
    const had = commandsOf(before);

    return [...commandsOf(after).values()].filter((set) => {
        const old = had.get(set.nodeId);

        return old?.command !== set.command || old.cwd !== set.cwd;
    });
}
