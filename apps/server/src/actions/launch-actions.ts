import type { ActionHandlers } from '@ruimte/actions';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { VerbRefusal, field, orNote, type LaunchHost, type LaunchReading } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

const launchHostOf = (context: ServerActionContext): LaunchHost => {
    if (!context.host.launches) {
        throw new VerbRefusal('no-launches', 'This machine runs no launches');
    }
    return context.host.launches;
};

const launchLines = (launches: readonly LaunchReading[]): string[] =>
    orNote(
        launches.map((launch) => `launch\t${field(launch.launchId)}\t${field(launch.name)}`),
        'This project has no launches; a person adds them from the launch chip in the toolbar'
    );

/* A launch by its id, or by a name no other launch of the project carries; names are what a person sees, ids are what stays unique. */
const named = (launches: readonly LaunchReading[], wanted: string): LaunchReading => {
    const byId = launches.find((launch) => launch.launchId === wanted);
    if (byId) {
        return byId;
    }
    const byName = launches.filter((launch) => launch.name.toLowerCase() === wanted.toLowerCase());
    if (byName.length === 1) {
        return byName[0]!;
    }
    if (byName.length > 1) {
        throw new VerbRefusal('ambiguous-launch', `${byName.length} launches are called ${wanted}; name one by its id`, launchLines(byName));
    }
    throw new VerbRefusal('unknown-launch', `This project has no launch ${wanted}`, launchLines(launches));
};

const lastLines = (text: string, count: number): string => text.split('\n').slice(-count).join('\n');

const started = async (context: ServerActionContext, wanted: string, restart: boolean) => {
    const host = launchHostOf(context);
    const { projectId } = context.place;
    const launch = named(await host.list(projectId), wanted);
    const result = await host.start(projectId, launch.launchId, restart);
    if (result.outcome === 'held') {
        throw new VerbRefusal(
            'launch-held',
            `${launch.name} runs only once a person approves it on this machine as it stands now; the launch chip in the toolbar asks them`,
            (result.held ?? []).map((held) => `held\t${field(held.launchId)}\t${field(held.command)}\t${field(held.cwd)}`)
        );
    }
    if (result.outcome === 'busy' && result.busy) {
        const { busy } = result;
        const holder = busy.projectId === projectId ? `the launch ${busy.launchId}` : 'a launch of another project';
        throw new VerbRefusal('port-busy', `Port ${busy.port} is taken by ${holder}; nothing started`);
    }
    return { output: { launchId: launch.launchId, name: launch.name, kind: launch.kind, members: launch.members } };
};

export const launchActions: ActionHandlers<ServerActionContext> = {
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
            throw new VerbRefusal(
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
            throw new VerbRefusal(
                'launch-held',
                `${launch.name} is stopped only once a person approves it on this machine as it stands now; the launch chip in the toolbar asks them`
            );
        }
        return { output: { launchId: launch.launchId, name: launch.name, stopping: await host.stop(projectId, launch.launchId) } };
    }
};
