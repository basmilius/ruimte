import { ToolRefusal } from '@adecore/agents/context';
import { AgentKindSchema, RuntimeModeSchema, isCanvasView } from '@ruimte/contracts';
import { z } from 'zod';
import { field, type CanvasHost } from './host.ts';
import { checkCwd } from './project-paths.ts';

/* Where and how a task runs on another machine; the target of its outbox entry is the node here that stands for the agent. */
export const StartRemoteAgentPayloadSchema = z.object({
    machineId: z.string().min(1),
    // The project there that the link names.
    remoteProjectId: z.string().min(1),
    taskId: z.string().min(1),
    node: z.enum(['chat', 'terminal']),
    provider: AgentKindSchema,
    // The node here that gave the task, which that machine counts its agents under.
    parentId: z.string().min(1),
    // What the tool asked and the mode its parent has; that machine narrows both again.
    mode: RuntimeModeSchema.optional(),
    ceiling: RuntimeModeSchema,
    depth: z.number().int().min(0),
    // With a worktree there: the checkout here that is sent over, and the branch it becomes. Both or neither.
    source: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    // Set before `peer.taskStart` goes out and cleared on a refusal, so dropping the entry knows whether an agent may run there.
    sent: z.boolean().optional()
});

export type StartRemoteAgentPayload = z.infer<typeof StartRemoteAgentPayloadSchema>;

interface RemoteTarget {
    machineId: string;
    label: string;
    remoteProjectId: string;
}

/* The machines a project is linked to, as the lines a refusal prints under it. */
function machineLines(machines: ReturnType<NonNullable<CanvasHost['remote']>['machines']>): string[] {
    return machines.length === 0
        ? ['note\tNo machine is linked to this project; a person links one from a node menu']
        : machines.map((machine) => `machine\t${machine.machineId}\t${field(machine.label)}\t${machine.ready ? 'ready' : 'not connected'}`);
}

/*
 * The machine `machine` names, by its id or its name. Only a machine this project is linked to and
 * that this machine can work in (a person linked the two machines) is one, so an agent never reaches
 * a machine nobody opened to it.
 */
export function resolveMachine(host: Pick<CanvasHost, 'remote'>, projectId: string, name: string): RemoteTarget {
    const machines = host.remote?.machines(projectId) ?? [];
    const byLabel = machines.filter((machine) => machine.label.toLowerCase() === name.toLowerCase());
    const found = machines.find((machine) => machine.machineId === name) ?? (byLabel.length === 1 ? byLabel[0] : undefined);
    if (byLabel.length > 1 && found === undefined) {
        throw new ToolRefusal('machine-ambiguous', `More than one machine is called ${name}; name it by its id`, machineLines(machines));
    }
    if (found === undefined) {
        throw new ToolRefusal('machine-not-linked', `${name} is not a machine this project is linked to`, machineLines(machines));
    }
    if (!found.ready) {
        throw new ToolRefusal(
            'machine-not-linked',
            `${found.label} is linked to this project, but this machine cannot work in it yet; a person connects the two machines from a node menu`,
            machineLines(machines)
        );
    }
    return { machineId: found.machineId, label: found.label, remoteProjectId: found.remoteProjectId };
}

interface RemoteStartInput {
    cwd: string | null;
    task: boolean;
    model: boolean;
    effort: boolean;
    base: boolean;
    reads: number;
    hidden: boolean;
}

/* What `machine` cannot be combined with, said before anything is made. */
export function refuseRemoteStart(input: RemoteStartInput): void {
    if (input.cwd !== null) {
        throw new ToolRefusal(
            'machine-and-cwd',
            'machine and cwd both say where the agent starts; a folder here means nothing there. Give worktree to start from your checkout'
        );
    }
    if (!input.task) {
        throw new ToolRefusal('machine-needs-task', 'machine gives a task to an agent there, whose result wakes you; add task');
    }
    if (input.model) {
        throw new ToolRefusal('machine-and-model', 'machine takes no model; the other machine picks the model it runs');
    }
    if (input.effort) {
        throw new ToolRefusal('machine-and-effort', 'machine takes no effort; the other machine picks the effort it runs at');
    }
    if (input.base) {
        throw new ToolRefusal('machine-and-base', 'machine takes no base; a worktree there is made from your checkout');
    }
    if (input.reads > 0) {
        throw new ToolRefusal('machine-and-reads', 'reads draws a line into the agent, and no line reaches an agent on another machine');
    }
    if (input.hidden) {
        throw new ToolRefusal('view-required', 'machine puts the agent on a canvas of yours; name one with view');
    }
}

/* The checkout a worktree on another machine is made from: the folder the caller works in, else the project's. */
export async function sourceCheckout(
    host: Pick<CanvasHost, 'projects' | 'checkouts'>,
    place: { folder: string; projectId: string },
    caller: string
): Promise<string> {
    const content = await host.projects.read(place.projectId);
    const cwd = content.views.flatMap((view) => (isCanvasView(view) ? view.nodes : [])).find((node) => node.id === caller)?.cwd;
    if (cwd === undefined) {
        return place.folder;
    }
    return await checkCwd(place.folder, cwd, (folder) => host.checkouts.paths(folder)).catch(() => place.folder);
}
