import { z } from 'zod';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { STOP_GRACE_MS } from '../launches/runner.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SCOPE_LINE, field, orNote, oneArgument, TAIL_FLAG, jsonFlag } from './verb.ts';

const LAUNCH_PARAM = { syntax: '<launch>', need: 'required', field: 'launch', more: 'launch_list names them' } as const;

const APPROVAL_LINE =
    'approval\tA launch starts only once a person approved it on this machine for the command, folder and environment it has now; a changed launch needs that again';

function launchTuple(word: string) {
    return oneArgument(`launches ${word} needs the id or the name of a launch`, `launches ${word} takes one launch and nothing else`);
}

const listAction = defineActionVerb('launches', {
    name: 'list',
    action: 'launch.list',
    usage: '',
    params: [],
    detail: [
        'prints\tid\tname\tkind\tstate\tapproved\tport\turl\tmembers\tone line per launch, in the order of the menu',
        'kind\tservice runs until stopped and may wait on the port of its url; task runs once and ends; group starts the launches in members',
        'state\tstarting, running, stopping, or exited:<code>; a dash for one that has not run since the machine started, and for a group',
        'approved\tyes or no; launch_control starts only an approved launch',
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
            'This project has no launches; a person adds them from the launch chip in the toolbar, and launch_new adds one they approve'
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
        tail: TAIL_FLAG
    }),
    async run({ positionals: [launch], flags }, call) {
        const read = await runAction(call, 'launch.read', { launch, tail: flags.tail ?? null });
        if (read.text === null) {
            return [`note\t${read.name} has not run since this machine started`];
        }
        return read.text.split('\n');
    }
});

function startedLines(verb: string, output: { launchId: string; name: string; kind: string; members: string[] }): string[] {
    return [
        `${verb}\t${field(output.launchId)}\t${field(output.name)}${output.members.length === 0 ? '' : `\t${output.members.map(field).join(',')}`}`,
        `see\tlaunch_list\twhether it came up; launch_read ${field(output.launchId)} for its output`
    ];
}

function startDetail(word: string): string[] {
    return [
        APPROVAL_LINE,
        'refused\tlaunch-held\tnobody approved it here yet: ask the person, whose launch chip in the toolbar asks for it; one held line per launch it would run, with its command and folder',
        'refused\tport-busy\tanother launch has the port of its url: stop that one first when it is of this project, or ask the person',
        `note\tA group ${word}s every launch it holds, and only once each of them is approved`
    ];
}

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
        'prints\tstopping\tid\tname\tcount\thow many of its launches ran and are being stopped; launch_list says when they are gone',
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

const EnvFlag = jsonFlag('--env is a JSON object of variables, such as {"PORT":"3000"}; null removes one').pipe(
    z.record(z.string(), z.string().nullable(), {
        error: '--env is a JSON object of variables with text values, such as {"PORT":"3000"}; null removes one'
    })
);

const MembersFlag = z
    .string()
    .min(1, '--members needs the launches a group starts')
    .transform((text) =>
        text
            .split(',')
            .map((member) => member.trim())
            .filter((member) => member !== '')
    );

const HELD_LINE =
    'held\tIt waits for a person to approve it from the launch chip in the toolbar, and starts nothing until then; tell them what you set up and why';

function savedLaunchLines(saved: { launchId: string; name: string; kind: string; shared: boolean }): string[] {
    return [`saved\t${field(saved.launchId)}\t${field(saved.name)}\t${saved.kind}\t${saved.shared ? 'shared' : 'private'}`, HELD_LINE];
}

const SAVE_PARAMS = [
    { syntax: '--command C', need: 'service, task', field: 'command' },
    { syntax: '--cwd D', need: 'service, task', field: 'cwd' },
    { syntax: '--url U', need: 'service', field: 'url' },
    { syntax: '--env JSON', need: 'service, task', field: 'env', more: 'a JSON object such as {"PORT":"3000"}' },
    { syntax: '--members L', need: 'group', field: 'members', more: 'comma separated ids or names' }
] as const;

const SAVE_FLAGS = {
    command: z.string().optional(),
    cwd: z.string().min(1, '--cwd needs the path of a folder').optional(),
    url: z.string().optional(),
    env: EnvFlag.optional(),
    members: MembersFlag.optional()
};

type SaveFlags = { [Name in keyof typeof SAVE_FLAGS]?: z.infer<(typeof SAVE_FLAGS)[Name]> };

function saveFieldsOf(flags: SaveFlags) {
    return {
        ...(flags.command === undefined ? {} : { command: flags.command }),
        ...(flags.cwd === undefined ? {} : { cwd: flags.cwd }),
        ...(flags.url === undefined ? {} : { url: flags.url }),
        ...(flags.env === undefined ? {} : { env: flags.env }),
        ...(flags.members === undefined ? {} : { members: flags.members })
    };
}

const newAction = defineActionVerb('launches', {
    name: 'new',
    action: 'launch.create',
    usage: '--name N --kind service|task|group [--command C] [--cwd D] [--url U] [--env JSON] [--members L] [--shared]',
    params: [
        { syntax: '--name N', need: 'required', field: 'name' },
        { syntax: '--kind K', need: 'required', field: 'kind' },
        ...SAVE_PARAMS,
        { syntax: '--shared', need: 'no value', field: 'shared' }
    ],
    detail: [
        'prints\tsaved\tid\tname\tkind\tshared or private, then held',
        'id\tMade from the name and unique in the project; launches edit, start and read take it',
        APPROVAL_LINE,
        'refusals\tlaunches-invalid\twrong-kind\tcommand-required\tunknown-launch\tthe codes this action refuses with'
    ],
    positionals: z.tuple([], { error: 'launches new takes no arguments; name it with --name' }),
    switches: ['shared'],
    flags: z.object({
        name: z.string({ error: '--name needs a name' }).min(1, '--name needs a name'),
        kind: z.enum(['service', 'task', 'group'], { error: '--kind is service, task or group' }),
        ...SAVE_FLAGS
    }),
    async run({ flags, switches }, call) {
        return savedLaunchLines(
            await runAction(call, 'launch.create', { name: flags.name, kind: flags.kind, ...saveFieldsOf(flags), shared: switches.has('shared') })
        );
    }
});

const editAction = defineActionVerb('launches', {
    name: 'edit',
    action: 'launch.edit',
    usage: '<launch> [--name N] [--command C] [--cwd D] [--url U] [--env JSON] [--members L]',
    params: [LAUNCH_PARAM, { syntax: '--name N', need: 'optional', field: 'name' }, ...SAVE_PARAMS],
    detail: [
        'prints\tsaved\tid\tname\tkind\tshared or private, then held',
        'keeps\tWhat you leave out stays as it was, its kind and its file too; --env sets the variables it names and leaves the rest',
        "secret\tA variable that holds a secret is the person's, and refused with secret-variable; secret_request asks them for one",
        APPROVAL_LINE,
        'refusals\tlaunches-invalid\twrong-kind\tcommand-required\tsecret-variable\tunknown-launch\tambiguous-launch\tthe codes this action refuses with'
    ],
    positionals: launchTuple('edit'),
    flags: z.object({ name: z.string().min(1, '--name needs a name').optional(), ...SAVE_FLAGS }),
    async run({ positionals: [launch], flags }, call) {
        return savedLaunchLines(
            await runAction(call, 'launch.edit', { launch, ...(flags.name === undefined ? {} : { name: flags.name }), ...saveFieldsOf(flags) })
        );
    }
});

export const LAUNCHES_SUMMARY =
    'Lists, adds and changes the launches of the project and reads their output; starts, restarts and stops the ones a person approved on this machine';

export const LAUNCHES_DETAIL: readonly string[] = [
    'note\tA launch is a command of the project that runs from the launch chip in the toolbar: a dev server, a build, or a group of them',
    APPROVAL_LINE,
    'never\tAn agent never approves a launch: whatever you add or change waits on a person, in the app',
    SCOPE_LINE
];

export const LAUNCHES_ACTIONS = [listAction, readAction, newAction, editAction, startAction, restartAction, stopAction] as const;
