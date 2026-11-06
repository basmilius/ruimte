import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { isWithin } from '@adecore/utils/path';
import type { ActionHandlers, ActionInput } from '@ruimte/actions';
import { ROUTINE_LIMITS, RoutineSchema, type Routine, type RoutineEntry, type RoutineKind } from '@ruimte/contracts';
import { nameOf, requireInstalled } from '../canvas/agents.ts';
import { field, orNote } from '../canvas/host.ts';
import { selectionForOpening } from '../canvas/model.ts';
import { providerFor } from '../providers/registry.ts';
import type { RoutineAgentHost } from '../routines/agent-host.ts';
import { hostService, type ServerActionContext } from './context.ts';
import { launchHostOf, named } from './launch-actions.ts';
import { freeSlug, slugOf } from './slug.ts';

type RoutineFields = Omit<ActionInput<'routine.edit'>, 'routineId'>;

/* The fields that belong to one kind only, so a call that names another kind's field is told so. */
const KIND_FIELDS: Record<RoutineKind, readonly (keyof RoutineFields)[]> = {
    agent: ['prompt', 'provider', 'model', 'mode', 'perRun'],
    command: ['command', 'cwd'],
    launch: ['launch']
};

const FIELD_OF: Partial<Record<keyof RoutineFields, string>> = { perRun: 'per_run', provider: 'agent' };

function fieldOf(name: keyof RoutineFields): string {
    return FIELD_OF[name] ?? name;
}

export function routinesOf(context: ServerActionContext): RoutineAgentHost {
    return hostService(context, 'routines', 'unavailable', 'This machine keeps no routines');
}

function routineLines(entries: readonly RoutineEntry[]): string[] {
    return orNote(
        entries.map((entry) => `routine\t${entry.routine.id}\t${field(entry.routine.title)}`),
        'This project has no routines yet; routine_new adds one'
    );
}

export function entryOf(entries: readonly RoutineEntry[], routineId: string): RoutineEntry {
    const entry = entries.find((candidate) => candidate.routine.id === routineId);
    if (entry === undefined) {
        throw new ToolRefusal('routine-not-found', `This project has no routine ${routineId}`, routineLines(entries));
    }
    return entry;
}

function refuseOtherKinds(kind: RoutineKind, input: RoutineFields): void {
    for (const [other, names] of Object.entries(KIND_FIELDS)) {
        if (other === kind) {
            continue;
        }
        const given = names.find((name) => input[name] !== undefined);
        if (given !== undefined) {
            throw new ToolRefusal('wrong-kind', `${fieldOf(given)} is for a routine of kind ${other}, and this one is ${kind}`);
        }
    }
}

/* A folder inside the project, kept relative and POSIX the way the routine file holds it. */
function cwdIn(folder: string, cwd: string): string | undefined {
    const path = isAbsolute(cwd) ? cwd : resolve(folder, cwd);
    if (!isWithin(folder, path)) {
        throw new ToolRefusal('cwd-outside-project', `${cwd} is outside the project folder; a routine's command runs inside it`);
    }
    const inside = relative(folder, path).split(sep).join('/');
    return inside === '' ? undefined : inside;
}

/*
 * The routine an agent's call makes: the fields it gave over what the routine was, or over the defaults
 * of a new one. A kind that changes keeps only the title, the schedule and the key.
 */
async function routineFrom(context: ServerActionContext, caller: string, id: string, input: RoutineFields, before: Routine | null): Promise<Routine> {
    const kind = input.kind ?? before?.kind ?? 'agent';
    refuseOtherKinds(kind, input);
    const same = before !== null && before.kind === kind ? before : null;
    const title = input.title ?? before?.title ?? '';
    const base = {
        id,
        title,
        schedule: input.schedule ?? before?.schedule,
        outputKey: input.key ?? before?.outputKey ?? slugOf(title, 'routine')
    };
    const { host, place } = context;
    let routine: unknown;
    if (kind === 'agent') {
        const agent = same?.kind === 'agent' ? same : null;
        const prompt = input.prompt ?? agent?.prompt;
        if (prompt === undefined) {
            throw new ToolRefusal('prompt-required', 'An agent routine needs prompt: what the agent of every run is asked');
        }
        const provider = input.provider ?? agent?.provider ?? host.starts.accountOf?.(caller)?.kind;
        if (provider === undefined) {
            throw new ToolRefusal('agent-required', 'Name the CLI of the agent with agent; this session runs none to take after');
        }
        if (input.provider !== undefined || agent === null) {
            requireInstalled(await host.starts.installedAgents(), provider);
            if (!providerFor(provider).capabilities.chat) {
                throw new ToolRefusal('agent-needs-chat', `${nameOf(provider)} has no chat, and a routine runs its agent as a chat`);
            }
        }
        const selection =
            input.model !== undefined || (input.provider !== undefined && input.provider !== agent?.provider)
                ? selectionForOpening(provider, true, input.model, undefined, host.starts.preferredSelection(provider))
                : agent?.selection;
        const { selection: _selection, ...kept } = agent ?? {};
        routine = {
            ...kept,
            ...base,
            kind,
            prompt,
            provider,
            ...(selection === undefined ? {} : { selection }),
            mode: input.mode ?? agent?.mode ?? 'supervised',
            perRun: input.perRun ?? agent?.perRun ?? 'new'
        };
    } else if (kind === 'command') {
        const command = same?.kind === 'command' ? same : null;
        const text = input.command ?? command?.command;
        if (text === undefined) {
            throw new ToolRefusal('command-required', 'A command routine needs command: what a shell runs in the project folder');
        }
        const cwd = input.cwd === undefined ? command?.cwd : cwdIn(place.folder, input.cwd);
        const { cwd: _cwd, ...kept } = command ?? {};
        routine = { ...kept, ...base, kind, command: text, ...(cwd === undefined ? {} : { cwd }) };
    } else {
        const launch = same?.kind === 'launch' ? same : null;
        let launchId = launch?.launchId;
        if (input.launch !== undefined) {
            launchId = named(await launchHostOf(context).list(place.projectId), input.launch).launchId;
        }
        if (launchId === undefined) {
            throw new ToolRefusal('launch-required', 'A launch routine needs launch: the id of the launch it starts; launch_list names them');
        }
        routine = { ...launch, ...base, kind, launchId };
    }
    const parsed = RoutineSchema.safeParse(routine);
    if (!parsed.success) {
        throw new ToolRefusal('bad-routine', parsed.error.issues[0]?.message ?? 'This routine is not one the machine can keep');
    }
    return parsed.data;
}

async function saved(context: ServerActionContext, caller: string, routine: Routine, shared: boolean) {
    const result = await routinesOf(context).save(context.place.projectId, routine, context.host.starts.modeOf(caller), caller, shared);
    const kept = result.routine;
    return {
        output: {
            routineId: kept.id,
            title: kept.title,
            kind: kept.kind,
            mode: kept.kind === 'agent' ? kept.mode : null,
            shared: result.shared
        }
    };
}

async function toggled(context: ServerActionContext, routineId: string, change: 'pause' | 'resume') {
    const host = routinesOf(context);
    const entry = entryOf((await host.list(context.place.projectId)).routines, routineId);
    await host[change](context.place.projectId, routineId);

    return { output: { routineId, title: entry.routine.title } };
}

/* Every call is held to the caller's own project, read off the caller and never off an argument; no call approves. */
export const routineActions: ActionHandlers<ServerActionContext> = {
    'routine.list': async (_input, { context }) => {
        const { routines, timeZone } = await routinesOf(context).list(context.place.projectId);
        return { output: { routines, timeZone } };
    },
    'routine.create': async ({ shared, ...input }, { actor, context }) => {
        const { routines } = await routinesOf(context).list(context.place.projectId);
        if (routines.length >= ROUTINE_LIMITS.perProject) {
            throw new ToolRefusal('too-many-routines', `This project has ${routines.length} routines, the most one project keeps`);
        }
        const id = freeSlug(input.title, 'routine', new Set(routines.map((entry) => entry.routine.id)));
        const routine = await routineFrom(context, actor.id, id, input, null);
        return saved(context, actor.id, routine, shared ?? false);
    },
    'routine.edit': async ({ routineId, ...input }, { actor, context }) => {
        const { routines } = await routinesOf(context).list(context.place.projectId);
        const entry = entryOf(routines, routineId);
        const routine = await routineFrom(context, actor.id, routineId, input, entry.routine);
        return saved(context, actor.id, routine, entry.shared);
    },
    'routine.pause': ({ routineId }, { context }) => toggled(context, routineId, 'pause'),
    'routine.resume': ({ routineId }, { context }) => toggled(context, routineId, 'resume'),
    'routine.run': async ({ routineId }, { context }) => {
        const host = routinesOf(context);
        const entry = entryOf((await host.list(context.place.projectId)).routines, routineId);
        const result = await host.runNow(context.place.projectId, routineId);
        if (result.outcome === 'held') {
            throw new ToolRefusal(
                'routine-held',
                `${entry.routine.title} runs only once a person approves it on this machine as it stands now; they do so in Routines`
            );
        }
        if (result.outcome === 'busy' || result.runId === undefined) {
            throw new ToolRefusal('routine-busy', `The previous run of ${entry.routine.title} still runs or waits on a person; nothing started`);
        }
        return { output: { routineId, title: entry.routine.title, runId: result.runId } };
    }
};
