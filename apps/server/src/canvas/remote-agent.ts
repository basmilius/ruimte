import { isCanvasView } from '@ruimte/contracts';
import { checkCwd } from './project-paths.ts';
import { field, VerbRefusal, type CanvasHost } from './verb.ts';

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
 * The machine `--machine` names, by its id or its name. Only a machine this project is linked to and
 * that this machine can work in (a person linked the two machines) is one, so an agent never reaches
 * a machine nobody opened to it.
 */
export function resolveMachine(host: Pick<CanvasHost, 'remote'>, projectId: string, name: string): RemoteTarget {
    const machines = host.remote?.machines(projectId) ?? [];
    const byLabel = machines.filter((machine) => machine.label.toLowerCase() === name.toLowerCase());
    const found = machines.find((machine) => machine.machineId === name) ?? (byLabel.length === 1 ? byLabel[0] : undefined);
    if (byLabel.length > 1 && found === undefined) {
        throw new VerbRefusal('machine-ambiguous', `More than one machine is called ${name}; name it by its id`, machineLines(machines));
    }
    if (found === undefined) {
        throw new VerbRefusal('machine-not-linked', `${name} is not a machine this project is linked to`, machineLines(machines));
    }
    if (!found.ready) {
        throw new VerbRefusal(
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

/* What `--machine` cannot be combined with, said before anything is made. */
export function refuseRemoteStart(input: RemoteStartInput): void {
    if (input.cwd !== null) {
        throw new VerbRefusal(
            'machine-and-cwd',
            '--machine and --cwd both say where the agent starts; a folder here means nothing there. Give --worktree to start from your checkout'
        );
    }
    if (!input.task) {
        throw new VerbRefusal('machine-needs-task', '--machine gives a task to an agent there, whose result wakes you; add --task');
    }
    if (input.model) {
        throw new VerbRefusal('machine-and-model', '--machine takes no --model; the other machine picks the model it runs');
    }
    if (input.effort) {
        throw new VerbRefusal('machine-and-effort', '--machine takes no --effort; the other machine picks the effort it runs at');
    }
    if (input.base) {
        throw new VerbRefusal('machine-and-base', '--machine takes no --base; a worktree there is made from your checkout');
    }
    if (input.reads > 0) {
        throw new VerbRefusal('machine-and-reads', '--reads draws a line into the agent, and no line reaches an agent on another machine');
    }
    if (input.hidden) {
        throw new VerbRefusal('view-required', '--machine puts the agent on a canvas of yours; name one with --view');
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

/* What `--machine` means, said in the help of the verbs that take it. */
export const MACHINE_LINES: readonly string[] = [
    'machine\t--machine M runs the agent on another machine this project is linked to (a person links one from a node menu); M is its name or its id, and it needs --task',
    'machine\tThe node stands on your canvas as a node of that machine and is drawn from there; no line reaches it, so it reads nothing of yours and you read it only through its task result',
    'machine\tThe task is owed until that machine takes it: while it is away the node says the task has not started, and it starts by itself once the machine answers; task_list shows where it stands',
    'machine\tThat machine bounds the agent itself: its mode is the narrowest of yours, the one the link there allows and the one you ask, it runs at most 4 tasks of yours at a time, the rest wait and start as places free up, and a launch in it waits for a person there',
    'machine\t--worktree makes the worktree there from your checkout, with your uncommitted files; the work comes back as a branch you can merge when the task settles. Not with --cwd, --reads, --model, --effort or --base'
];
