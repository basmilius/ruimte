import { z } from 'zod';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { STOP_GRACE_MS } from '../launches/runner.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SCOPE_LINE, field, orNote } from './verb.ts';

const LAUNCH_PARAM = { syntax: '<launch>', need: 'required', field: 'launch', more: 'ruimte-context launches list names them' } as const;

const APPROVAL_LINE =
    'approval\tA launch starts only once a person approved it on this machine for the command, folder and environment it has now; a changed launch needs that again';

const launchTuple = (word: string) =>
    z.tuple([z.string().min(1, `launches ${word} needs the id or the name of a launch`)], {
        error: (issue) =>
            issue.code === 'too_big' ? `launches ${word} takes one launch and nothing else` : `launches ${word} needs the id or the name of a launch`
    });

const listAction = defineActionVerb('launches', {
    name: 'list',
    action: 'launch.list',
    usage: '',
    params: [],
    detail: [
        'prints\tid\tname\tkind\tstate\tapproved\tport\turl\tmembers\tone line per launch, in the order of the menu',
        'kind\tservice runs until stopped and may wait on the port of its url; task runs once and ends; group starts the launches in members',
        'state\tstarting, running, stopping, or exited:<code>; a dash for one that has not run since the machine started, and for a group',
        'approved\tyes or no; see ruimte-context help launches start',
        'columns\tport, url and members are a dash when there are none; members is comma separated'
    ],
    positionals: z.tuple([], { error: 'launches list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { launches } = await runAction(call, 'launch.list', {});
        return orNote(
            launches.map((launch) =>
                [
                    field(launch.launchId),
                    field(launch.name),
                    launch.kind,
                    launch.state === null ? '-' : launch.state === 'exited' ? `exited:${launch.exitCode ?? '-'}` : launch.state,
                    launch.approved ? 'yes' : 'no',
                    launch.port === null ? '-' : String(launch.port),
                    launch.url === null ? '-' : field(launch.url),
                    launch.members.length === 0 ? '-' : launch.members.map(field).join(',')
                ].join('\t')
            ),
            'This project has no launches; a person adds them from the launch chip in the toolbar'
        );
    }
});

const readAction = defineActionVerb('launches', {
    name: 'read',
    action: 'launch.read',
    usage: '<launch> [--tail N]',
    params: [
        LAUNCH_PARAM,
        {
            syntax: '--tail N',
            need: 'optional',
            field: 'tail',
            more: `N a positive whole number; it cannot reach past the last ${MAX_SCREEN_LINES} lines the machine keeps`
        }
    ],
    detail: [
        'prints\tThe output of the launch as its terminal shows it now, as text, not as tab-separated lines',
        'group\tA group has no output of its own; read the launches it starts',
        'cheap\tThe last thirty lines usually say whether it came up or why it failed'
    ],
    positionals: launchTuple('read'),
    flags: z.object({
        tail: z.coerce
            .number({ error: '--tail needs a positive whole number' })
            .int('--tail needs a positive whole number')
            .positive('--tail needs a positive whole number')
            .optional()
    }),
    async run({ positionals: [launch], flags }, call) {
        const read = await runAction(call, 'launch.read', { launch, tail: flags.tail ?? null });
        if (read.text === null) {
            return [`note\t${read.name} has not run since this machine started`];
        }
        return read.text.split('\n');
    }
});

const startedLines = (verb: string, output: { launchId: string; name: string; kind: string; members: string[] }): string[] => [
    `${verb}\t${field(output.launchId)}\t${field(output.name)}${output.members.length === 0 ? '' : `\t${output.members.map(field).join(',')}`}`,
    `see\truimte-context launches list\twhether it came up; ruimte-context launches read ${field(output.launchId)} for its output`
];

const startDetail = (word: string): string[] => [
    APPROVAL_LINE,
    'refused\tlaunch-held\tnobody approved it here yet: ask the person, whose launch chip in the toolbar asks for it; one held line per launch it would run, with its command and folder',
    'refused\tport-busy\tanother launch has the port of its url: stop that one first when it is of this project, or ask the person',
    `note\tA group ${word}s every launch it holds, and only once each of them is approved`
];

const startAction = defineActionVerb('launches', {
    name: 'start',
    action: 'launch.start',
    usage: '<launch>',
    params: [LAUNCH_PARAM],
    detail: ['prints\tstarted\tid\tname\tmembers\tthe launch it started; a launch that already runs is left as it is', ...startDetail('start')],
    positionals: launchTuple('start'),
    flags: z.object({}),
    async run({ positionals: [launch] }, call) {
        return startedLines('started', await runAction(call, 'launch.start', { launch }));
    }
});

const restartAction = defineActionVerb('launches', {
    name: 'restart',
    action: 'launch.restart',
    usage: '<launch>',
    params: [LAUNCH_PARAM],
    detail: ['prints\trestarted\tid\tname\tmembers\tthe launch it stopped and started again', ...startDetail('restart')],
    positionals: launchTuple('restart'),
    flags: z.object({}),
    async run({ positionals: [launch] }, call) {
        return startedLines('restarted', await runAction(call, 'launch.restart', { launch }));
    }
});

const stopAction = defineActionVerb('launches', {
    name: 'stop',
    action: 'launch.stop',
    usage: '<launch>',
    params: [LAUNCH_PARAM],
    detail: [
        'prints\tstopping\tid\tname\tcount\thow many of its launches ran and are being stopped; ruimte-context launches list says when they are gone',
        `signals\tCtrl+C first, then SIGTERM after ${STOP_GRACE_MS / 1_000} seconds; never SIGKILL, which only a person gives with Force stop`,
        APPROVAL_LINE,
        'refused\tlaunch-held\tnobody approved it here as it stands now, so an agent may not stop it: ask the person, whose launch chip in the toolbar asks for it',
        'note\tA group stops every launch it holds, and only once each of them is approved'
    ],
    positionals: launchTuple('stop'),
    flags: z.object({}),
    async run({ positionals: [launch] }, call) {
        const stopped = await runAction(call, 'launch.stop', { launch });
        if (stopped.stopping === 0) {
            return [`note\t${stopped.name} was not running`];
        }
        return [`stopping\t${field(stopped.launchId)}\t${field(stopped.name)}\t${stopped.stopping}`];
    }
});

export const LAUNCHES_SUMMARY =
    'Lists the launches of the project and reads their output; starts, restarts and stops the ones a person approved on this machine';

export const LAUNCHES_DETAIL: readonly string[] = [
    'note\tA launch is a command of the project a person set up to run from the launch chip in the toolbar: a dev server, a build, or a group of them',
    APPROVAL_LINE,
    'never\tAn agent never adds, changes or approves a launch; a person does, in the app',
    SCOPE_LINE
];

export const LAUNCHES_ACTIONS = [listAction, readAction, startAction, restartAction, stopAction] as const;
