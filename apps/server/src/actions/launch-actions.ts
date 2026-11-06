import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers, ActionInput } from '@ruimte/actions';
import { isSecretReference, type LaunchConfig, type LaunchConfigKind, type LaunchConfigOverlay } from '@ruimte/contracts';
import { field, orNote } from '../canvas/host.ts';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import type { LaunchHost, LaunchReading } from '../launches/agent-host.ts';
import { hostService, type ServerActionContext } from './context.ts';
import { freeSlug } from './slug.ts';

export function launchHostOf(context: ServerActionContext): LaunchHost {
    return hostService(context, 'launches', 'no-launches', 'This machine runs no launches');
}

export function launchLines(launches: readonly LaunchReading[]): string[] {
    return orNote(
        launches.map((launch) => `launch\t${field(launch.launchId)}\t${field(launch.name)}`),
        'This project has no launches; a person adds them from the launch chip in the toolbar, and launch_new adds one they approve'
    );
}

/* A launch by its id, or by a name no other launch of the project carries; names are what a person sees, ids are what stays unique. */
export function named(launches: readonly LaunchReading[], wanted: string): LaunchReading {
    const byId = launches.find((launch) => launch.launchId === wanted);
    if (byId) {
        return byId;
    }
    const byName = launches.filter((launch) => launch.name.toLowerCase() === wanted.toLowerCase());
    if (byName.length === 1) {
        return byName[0]!;
    }
    if (byName.length > 1) {
        throw new ToolRefusal('ambiguous-launch', `${byName.length} launches are called ${wanted}; name one by its id`, launchLines(byName));
    }
    throw new ToolRefusal('unknown-launch', `This project has no launch ${wanted}`, launchLines(launches));
}

function lastLines(text: string, count: number): string {
    return text.split('\n').slice(-count).join('\n');
}

async function started(context: ServerActionContext, wanted: string, restart: boolean) {
    const host = launchHostOf(context);
    const { projectId } = context.place;
    const launch = named(await host.list(projectId), wanted);
    const result = await host.start(projectId, launch.launchId, restart);
    if (result.outcome === 'held') {
        throw new ToolRefusal(
            'launch-held',
            `${launch.name} runs only once a person approves it on this machine as it stands now; the launch chip in the toolbar asks them`,
            (result.held ?? []).map((held) => `held\t${field(held.launchId)}\t${field(held.command)}\t${field(held.cwd)}`)
        );
    }
    if (result.outcome === 'busy' && result.busy) {
        const { busy } = result;
        const holder = busy.projectId === projectId ? `the launch ${busy.launchId}` : 'a launch of another project';
        throw new ToolRefusal('port-busy', `Port ${busy.port} is taken by ${holder}; nothing started`);
    }
    return { output: { launchId: launch.launchId, name: launch.name, kind: launch.kind, members: launch.members } };
}

type LaunchFields = Omit<ActionInput<'launch.edit'>, 'launch'>;

function refuseFor(kind: LaunchConfigKind, input: LaunchFields): void {
    const notFor: readonly (keyof LaunchFields)[] = kind === 'group' ? ['command', 'cwd', 'url', 'env'] : kind === 'task' ? ['url', 'members'] : ['members'];
    const given = notFor.find((name) => input[name] !== undefined);
    if (given !== undefined) {
        throw new ToolRefusal('wrong-kind', `A ${kind} takes no ${given}`);
    }
}

/*
 * The launch an agent's call makes: the fields it gave set over what the launch was, in place, so the
 * file keeps its key order and every field this release does not know. A variable holding a secret is
 * the person's, since an agent that set it would read what the person typed into it.
 */
function launchFrom(before: LaunchConfig, overlay: LaunchConfigOverlay | undefined, input: LaunchFields, readings: readonly LaunchReading[]): LaunchConfig {
    refuseFor(before.kind, input);
    const next: LaunchConfig = { ...before };
    if (input.name !== undefined) {
        next.name = input.name;
    }
    if (input.command !== undefined) {
        next.command = input.command;
    }
    if (input.cwd !== undefined) {
        next.cwd = input.cwd;
    }
    if (input.url !== undefined) {
        next.url = input.url;
    }
    if (input.members !== undefined) {
        next.launches = input.members.map((member) => named(readings, member).launchId);
    }
    if (input.env !== undefined) {
        const env: Record<string, string> = { ...before.env };
        for (const [variable, value] of Object.entries(input.env)) {
            if (isSecretReference(env[variable]) || isSecretReference(overlay?.env?.[variable])) {
                throw new ToolRefusal('secret-variable', `${variable} holds a secret the person keeps on this machine; only they change it`);
            }
            if (value === null) {
                delete env[variable];
            } else {
                env[variable] = value;
            }
        }
        if (Object.keys(env).length === 0) {
            delete next.env;
        } else {
            next.env = env;
        }
    }
    if (next.kind !== 'group' && !next.command?.trim()) {
        throw new ToolRefusal('command-required', `A ${next.kind} needs command: what its shell runs`);
    }
    return next;
}

function savedOutput(launch: LaunchConfig, shared: boolean) {
    return { output: { launchId: launch.id, name: launch.name, kind: launch.kind, shared } };
}

export const launchActions: ActionHandlers<ServerActionContext> = {
    'launch.create': async ({ name, kind, shared, ...input }, { context }) => {
        const host = launchHostOf(context);
        const { projectId } = context.place;
        const entries = await host.entries(projectId);
        const id = freeSlug(name, 'launch', new Set(entries.map((entry) => entry.id)));
        const launch = launchFrom({ id, name, kind }, undefined, input, await host.list(projectId));
        await host.save(projectId, launch, shared ?? false);
        return savedOutput(launch, shared ?? false);
    },
    'launch.edit': async ({ launch: wanted, ...input }, { context }) => {
        const host = launchHostOf(context);
        const { projectId } = context.place;
        const readings = await host.list(projectId);
        const { launchId } = named(readings, wanted);
        const entry = (await host.entries(projectId)).find((candidate) => candidate.id === launchId);
        if (entry === undefined) {
            throw new ToolRefusal('unknown-launch', `This project has no launch ${wanted}`, launchLines(readings));
        }
        const { shared, overlay, ...before } = entry;
        const launch = launchFrom(before, overlay, input, readings);
        await host.save(projectId, launch, shared);
        return savedOutput(launch, shared);
    },
    'launch.list': async (_input, { context }) => {
        const launches = await launchHostOf(context).list(context.place.projectId);
        return {
            output: {
                launches: launches.map((launch) => ({
                    launchId: launch.launchId,
                    name: launch.name,
                    kind: launch.kind,
                    state: launch.status?.state ?? null,
                    exitCode: launch.status?.exitCode ?? null,
                    approved: launch.approved,
                    port: launch.port,
                    url: launch.url,
                    members: launch.members
                }))
            }
        };
    },
    'launch.read': async ({ launch: wanted, tail }, { context }) => {
        const host = launchHostOf(context);
        const { projectId } = context.place;
        const launches = await host.list(projectId);
        const launch = named(launches, wanted);
        if (launch.kind === 'group') {
            throw new ToolRefusal(
                'launch-group',
                `${launch.name} is a group and has no output of its own; read one of the launches it starts`,
                launchLines(launches.filter((candidate) => launch.members.includes(candidate.launchId)))
            );
        }
        const text = await host.text(projectId, launch.launchId);
        // The screen cap stays the ceiling, as for a terminal a person linked.
        const shown = text === null ? null : lastLines(text, Math.min(tail ?? MAX_SCREEN_LINES, MAX_SCREEN_LINES));
        return { output: { launchId: launch.launchId, name: launch.name, text: shown } };
    },
    'launch.start': ({ launch }, { context }) => started(context, launch, false),
    'launch.restart': ({ launch }, { context }) => started(context, launch, true),
    'launch.stop': async ({ launch: wanted }, { context }) => {
        const host = launchHostOf(context);
        const { projectId } = context.place;
        const launch = named(await host.list(projectId), wanted);
        if (!launch.approved) {
            throw new ToolRefusal(
                'launch-held',
                `${launch.name} is stopped only once a person approves it on this machine as it stands now; the launch chip in the toolbar asks them`
            );
        }
        return { output: { launchId: launch.launchId, name: launch.name, stopping: await host.stop(projectId, launch.launchId) } };
    }
};
