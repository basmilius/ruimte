import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isCanvasView, RuntimeModeSchema, type AgentKind, type ProjectView, type RuntimeMode } from '@ruimte/contracts';
import { z } from 'zod';
import { RecordDirectory } from '@adecore/agents/record-directory';
import { launchedMode } from '../providers/launch.ts';

const ApprovalSchema = z.object({
    hash: z.string().min(1),
    mode: RuntimeModeSchema,
    approvedAt: z.number()
});

type Approval = z.infer<typeof ApprovalSchema>;

function hashOf(folder: string, nodeId: string): string {
    return createHash('sha256')
        .update(JSON.stringify([folder, nodeId]))
        .digest('hex');
}

/*
 * The permission mode a person on this machine gave each terminal agent, per project folder and node.
 * Under `$RUIMTE_HOME` for the reason command approvals are: an agent with a shell can rewrite the mode
 * in `.ruimte/private/project.json`, and only a person's save may widen what a node starts in.
 */
export class ModeApprovals {
    private readonly approvals: RecordDirectory<Approval>;

    constructor(home: string) {
        this.approvals = new RecordDirectory({ dir: join(home, 'mode-approvals'), schema: ApprovalSchema, idOf: (approval) => approval.hash });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any session is made. */
    load(): Promise<void> {
        return this.approvals.load();
    }

    /* What a person's save gave this node; null for a node no save named since the daemon kept these. */
    modeOf(folder: string, nodeId: string): RuntimeMode | null {
        return this.approvals.get(hashOf(folder, nodeId))?.mode ?? null;
    }

    async approve(folder: string, nodeId: string, mode: RuntimeMode): Promise<void> {
        if (this.modeOf(folder, nodeId) === mode) {
            return;
        }
        await this.approvals.write({ hash: hashOf(folder, nodeId), mode, approvedAt: Date.now() });
    }
}

export interface NodeMode {
    nodeId: string;
    mode: RuntimeMode;
}

function startsIn(kind: AgentKind, runtimeMode: RuntimeMode | undefined, resume: string | undefined): RuntimeMode {
    return launchedMode({ kind, ...(runtimeMode ? { runtimeMode } : {}), ...(resume ? { resume } : {}) });
}

/* The mode every terminal agent in these views starts in, by node id, read the way the launch line is. */
function modesOf(views: readonly ProjectView[]): Map<string, RuntimeMode> {
    const modes = new Map<string, RuntimeMode>();
    for (const view of views) {
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                if (node.kind === 'terminal' && node.provider) {
                    modes.set(node.id, startsIn(node.provider, node.runtimeMode, node.resume));
                }
            }
        } else if (view.kind === 'terminal' && view.node.provider) {
            modes.set(view.id, startsIn(view.node.provider, view.node.runtimeMode, view.node.resume));
        }
    }
    return modes;
}

/*
 * The modes a save sets or changes. A mode an outside edit put on a node is in `before` as well, since
 * the daemon took that edit in, so a client that only saves it back approves nothing.
 */
export function modesSet(before: readonly ProjectView[], after: readonly ProjectView[]): NodeMode[] {
    const had = modesOf(before);
    return [...modesOf(after)].filter(([nodeId, mode]) => had.get(nodeId) !== mode).map(([nodeId, mode]) => ({ nodeId, mode }));
}

/*
 * The widest mode a terminal agent no agent opened may start in: what a person's save gave it, or
 * for a node no save named yet the terminal mode the person picks now, and the strictest without either.
 */
export function personModeOf(approved: RuntimeMode | null, preference: RuntimeMode | undefined): RuntimeMode {
    return approved ?? preference ?? 'supervised';
}
