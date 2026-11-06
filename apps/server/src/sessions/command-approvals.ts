import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { Serializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { isCanvasView, type ProjectView, type StandaloneNode } from '@ruimte/contracts';
import { z } from 'zod';
import { writeJsonDocument } from '../projects/project-files.ts';

const ApprovalSchema = z.object({
    hash: z.string().min(1),
    approvedAt: z.number()
});

type Approval = z.infer<typeof ApprovalSchema>;

const UnboundSchema = z.object({ hashes: z.array(z.string()) });

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
    private readonly unboundPath: string;
    /* Approvals written before the cwd was bound, which a terminal with a cwd of its own may still carry over once. */
    private unbound = new Set<string>();
    // One change to the ledger at a time, so an older snapshot of `unbound` never lands after a newer one.
    private readonly ledger = new Serializer();
    private readonly writeDocument: (path: string, text: string) => Promise<void>;

    constructor(
        home: string,
        options: { writeDocument?: (path: string, text: string) => Promise<void>; writeRecord?: (path: string, text: string) => Promise<void> } = {}
    ) {
        this.approvals = new RecordDirectory({
            dir: join(home, 'command-approvals'),
            schema: ApprovalSchema,
            idOf: (approval) => approval.hash,
            ...(options.writeRecord ? { write: options.writeRecord } : {})
        });
        this.unboundPath = join(home, 'command-approvals-unbound.json');
        this.writeDocument = options.writeDocument ?? ((path, text) => writeJsonDocument(path, text, (same) => same).then(() => undefined));
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any session is made. */
    async load(): Promise<void> {
        await this.approvals.load();

        try {
            this.unbound = new Set(UnboundSchema.parse(JSON.parse(await readFile(this.unboundPath, 'utf8'))).hashes);
        } catch (error) {
            if (!isNotFound(error)) {
                return;
            }

            // The first run that binds the cwd: everything already approved was approved without one.
            this.unbound = new Set(this.approvals.all().map((approval) => approval.hash));
            await this.saveUnbound();
        }
    }

    /* `cwd` is where a terminal types the command; a launch or a routine binds its own in the digest it passes as `command`. */
    has(folder: string, nodeId: string, command: string, cwd?: string): boolean {
        return this.approvals.has(hashOf(folder, nodeId, command, cwd));
    }

    /*
     * Whether a terminal starting now may type its command. An approval from before the cwd was bound moves,
     * at the first start after the update, to the cwd the node has then, and from then on holds only there,
     * so a cwd a commit sets later is asked for again. It answers only once that move is on disk.
     */
    admit(folder: string, nodeId: string, command: string, cwd?: string): Promise<boolean> {
        return this.ledger.run(async () => {
            const hash = hashOf(folder, nodeId, command, cwd);
            const unbound = approvalHash(folder, nodeId, command);

            if (!this.unbound.has(unbound)) {
                return this.approvals.has(hash);
            }

            const carried = this.approvals.has(unbound);

            // Spent first, so a crash in between only ever asks again and never carries the approval twice.
            this.unbound.delete(unbound);

            try {
                await this.saveUnbound();
            } catch {
                this.unbound.add(unbound);

                return false;
            }

            if (hash === unbound || !carried) {
                return this.approvals.has(hash);
            }

            const had = this.approvals.has(hash);

            try {
                await this.approvals.remove(unbound);

                return await this.approvals.write({ hash, approvedAt: Date.now() });
            } catch {
                // The directory holds a record in memory before its file lands; a write that failed must not leave a yes there.
                if (!had) {
                    await this.approvals.remove(hash).catch(() => undefined);
                }

                return false;
            }
        });
    }

    /* A person's yes for this cwd also spends an approval from before the cwd was bound, so it never carries over to another one. */
    approve(folder: string, nodeId: string, command: string, cwd?: string): Promise<void> {
        return this.ledger.run(async () => {
            const hash = hashOf(folder, nodeId, command, cwd);
            const unbound = approvalHash(folder, nodeId, command);

            if (this.unbound.has(unbound)) {
                this.unbound.delete(unbound);

                try {
                    await this.saveUnbound();
                } catch (e) {
                    this.unbound.add(unbound);
                    throw e;
                }

                // Kept only where it already holds: a node in its project folder hashes the same as before.
                if (hash !== unbound) {
                    await this.approvals.remove(unbound);
                }
            }

            if (this.approvals.has(hash)) {
                return;
            }

            await this.approvals.write({ hash, approvedAt: Date.now() });
        });
    }

    private async saveUnbound(): Promise<void> {
        await this.writeDocument(this.unboundPath, JSON.stringify({ hashes: [...this.unbound] }));
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
