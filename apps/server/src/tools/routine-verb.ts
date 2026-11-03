import { modeFlag } from '@adecore/agents/providers';
import type { ActionInput } from '@ruimte/actions';
import {
    cronProblemText,
    parseCron,
    RoutinePerRunSchema,
    RoutineScheduleSchema,
    type RoutineEntry,
    type RoutineRun,
    type RoutineSchedule
} from '@ruimte/contracts';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { modelFlag } from './model.ts';
import { field, orNote, oneArgument } from './verb.ts';

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const DAY_SETS: Record<string, readonly number[]> = {
    daily: [1, 2, 3, 4, 5, 6, 7],
    weekdays: [1, 2, 3, 4, 5],
    weekends: [6, 7]
};

const SCHEDULE_SYNTAX =
    '"daily 23:00", "weekdays 09:00", "weekends 10:30", "mon,thu 17:00", "once 2026-10-27 22:00", a repeat within a day such as "weekdays every 1h 09:00-17:00" or "daily every 30m 08:00-18:00" (steps of 15m up to 12h, both ends included), or "cron" and five crontab fields such as "cron 0 9 * * 1-5" or "cron */30 8-18 * * mon-fri" (at most every 15m)';

const APPROVAL_LINE =
    'approval\tA routine runs only once a person approved it on this machine as it stands; whatever you add or change waits for them in Routines, and you never approve one';

function clockOf(text: string): string | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) {
        return null;
    }
    const time = `${match[1]!.padStart(2, '0')}:${match[2]}`;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function daysOf(text: string): number[] | null {
    const set = DAY_SETS[text];
    if (set !== undefined) {
        return [...set];
    }
    const days = text.split(',').map((name) => DAY_NAMES.indexOf(name.slice(0, 3) as (typeof DAY_NAMES)[number]) + 1);
    if (days.some((day) => day === 0)) {
        return null;
    }
    return [...new Set(days)].sort((a, b) => a - b);
}

/* `--at` as an agent writes it: a set of days and a time, or once on a day at a time, in the machine's time zone. */
export function parseSchedule(text: string): RoutineSchedule | null {
    const words = text.trim().toLowerCase().split(/\s+/);
    if (words[0] === 'cron') {
        const schedule = RoutineScheduleSchema.safeParse({ kind: 'cron', expression: words.slice(1).join(' ') });
        return schedule.success ? schedule.data : null;
    }
    if (words[0] === 'once' && words.length === 3) {
        const time = clockOf(words[2]!);
        const date = words[1]!;
        const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
        return time === null || !valid ? null : { kind: 'once', date, time };
    }
    if (words.length === 4 && words[1] === 'every') {
        return intervalOf(words[0]!, words[2]!, words[3]!);
    }
    if (words.length !== 2) {
        return null;
    }
    const days = daysOf(words[0]!);
    const time = clockOf(words[1]!);
    return days === null || time === null ? null : { kind: 'weekly', days, time };
}

/* `weekdays every 1h 09:00-17:00`: the steps in minutes or hours, the window with both ends included. */
function intervalOf(dayText: string, everyText: string, windowText: string): RoutineSchedule | null {
    const days = daysOf(dayText);
    const step = /^(\d+)(m|h)$/.exec(everyText);
    const [fromText, toText, ...rest] = windowText.split('-');
    if (days === null || step === null || rest.length > 0 || fromText === undefined || toText === undefined) {
        return null;
    }
    const schedule = RoutineScheduleSchema.safeParse({
        kind: 'interval',
        days,
        every: Number(step[1]) * (step[2] === 'h' ? 60 : 1),
        from: clockOf(fromText),
        to: clockOf(toText)
    });
    return schedule.success ? schedule.data : null;
}

function everyText(minutes: number): string {
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/* A schedule in the words `--at` takes, so a list reads back as what an edit would give. */
export function scheduleText(schedule: RoutineSchedule): string {
    if (schedule.kind === 'once') {
        return `once ${schedule.date} ${schedule.time}`;
    }
    if (schedule.kind === 'cron') {
        return `cron ${schedule.expression}`;
    }
    const days = [...schedule.days].sort((a, b) => a - b).join(',');
    const named = Object.entries(DAY_SETS).find(([, set]) => set.join(',') === days)?.[0] ?? schedule.days.map((day) => DAY_NAMES[day - 1]).join(',');
    if (schedule.kind === 'interval') {
        return `${named} every ${everyText(schedule.every)} ${schedule.from}-${schedule.to}`;
    }
    return `${named} ${schedule.time}`;
}

const scheduleFlag = z.string().transform((text, context) => {
    const schedule = parseSchedule(text);
    if (schedule === null) {
        const cron = /^\s*cron\b(.*)$/i.exec(text);
        const parsed = cron === null ? null : parseCron(cron[1]!);
        const message = parsed !== null && !parsed.ok ? `--at cron: ${cronProblemText(parsed.problem)}` : `--at takes ${SCHEDULE_SYNTAX}`;
        context.addIssue({ code: 'custom', message });
        return z.NEVER;
    }
    return schedule;
});

type FieldName = keyof ActionInput<'routine.edit'> & keyof ActionInput<'routine.create'>;

const FIELD_PARAMS = [
    { syntax: '--kind K', need: 'optional', field: 'kind', more: 'agent when omitted on a new routine' },
    { syntax: '--prompt P', need: 'kind agent', field: 'prompt' },
    { syntax: '--agent A', need: 'kind agent', field: 'provider', more: 'a CLI this machine has, such as claude or codex' },
    { syntax: '--model M', need: 'kind agent', field: 'model' },
    { syntax: '--mode M', need: 'kind agent', field: 'mode' },
    { syntax: '--per-run R', need: 'kind agent', field: 'perRun', more: 'new when omitted on a new routine' },
    { syntax: '--command C', need: 'kind command', field: 'command' },
    { syntax: '--cwd D', need: 'kind command', field: 'cwd' },
    { syntax: '--launch L', need: 'kind launch', field: 'launch', more: 'launch_list names them' },
    { syntax: '--key K', need: 'optional', field: 'key', more: 'lowercase letters, digits and dashes' }
] as const satisfies readonly { syntax: string; need: string; field: FieldName; more?: string }[];

const FIELD_FLAGS = {
    kind: z.enum(['agent', 'command', 'launch'], { error: '--kind is agent, command or launch' }).optional(),
    prompt: z.string().optional(),
    agent: z.string().min(1, '--agent needs the name of a CLI').optional(),
    model: modelFlag,
    mode: modeFlag,
    'per-run': RoutinePerRunSchema.optional(),
    command: z.string().optional(),
    cwd: z.string().min(1, '--cwd needs the path of a folder').optional(),
    launch: z.string().min(1, '--launch needs the id of a launch').optional(),
    key: z.string().optional()
};

type FieldFlags = { [Name in keyof typeof FIELD_FLAGS]?: z.infer<(typeof FIELD_FLAGS)[Name]> };

function fieldsOf(flags: FieldFlags) {
    const given = {
        kind: flags.kind,
        prompt: flags.prompt,
        provider: flags.agent,
        model: flags.model,
        mode: flags.mode,
        perRun: flags['per-run'],
        command: flags.command,
        cwd: flags.cwd,
        launch: flags.launch,
        key: flags.key
    };
    return Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) as Partial<typeof given>;
}

function savedLines(
    verb: string,
    output: { routineId: string; title: string; kind: string; mode: string | null; shared: boolean },
    asked: string | undefined
): string[] {
    return [
        `${verb}\t${output.routineId}\t${field(output.title)}\t${output.kind}\t${output.mode ?? '-'}\t${output.shared ? 'shared' : 'private'}`,
        'held\tIt waits for a person to approve it in Routines on this machine, and runs nothing until then; tell them what you set up and why',
        ...(asked !== undefined && output.mode !== null && output.mode !== asked
            ? [`note\t--mode ${asked} is wider than your own, so it runs in ${output.mode}`]
            : [])
    ];
}

export function approvalOf(entry: RoutineEntry): string {
    if (entry.approved) {
        return 'yes';
    }
    return entry.held === undefined ? 'declined' : 'held';
}

function lastOf(entry: RoutineEntry): string {
    const run = entry.runs[0];
    return run === undefined ? '-' : runStateOf(run);
}

/* A run's state, with why it was skipped after a colon. */
export function runStateOf(run: RoutineRun): string {
    return run.skipped === undefined ? run.state : `${run.state}:${run.skipped}`;
}

function routineTuple(word: string) {
    return oneArgument(`routine ${word} needs the id of a routine; routine_list lists them`, `routine ${word} takes one routine and nothing else`);
}

const ROUTINE_PARAM = { syntax: '<routine>', need: 'required', field: 'routineId' } as const;

const listAction = defineActionVerb('routine', {
    name: 'list',
    action: 'routine.list',
    usage: '',
    params: [],
    detail: [
        'prints\tid\ttitle\tkind\tschedule\tapproved\tpaused\tnext\tlast\tone line per routine, then timezone and the time zone every schedule is read in',
        'schedule\tIn the words --at takes',
        'approved\tyes, held while it waits on a person, or declined when a person said no to it as it stands',
        'next\tAn ISO time in UTC, or - while it is paused, held, declined or past its one time',
        'last\tThe state of its newest run, with why it was skipped after a colon, or - for none',
        APPROVAL_LINE
    ],
    positionals: z.tuple([], { error: 'routine list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { routines, timeZone } = await runAction(call, 'routine.list', {});
        return [
            ...orNote(
                routines.map((entry) =>
                    [
                        entry.routine.id,
                        field(entry.routine.title),
                        entry.routine.kind,
                        scheduleText(entry.routine.schedule),
                        approvalOf(entry),
                        entry.local.pausedAt === undefined ? 'no' : 'yes',
                        entry.next === null ? '-' : new Date(entry.next).toISOString(),
                        lastOf(entry)
                    ].join('\t')
                ),
                'This project has no routines yet; routine_new adds one'
            ),
            `timezone\t${timeZone}`
        ];
    }
});

const newAction = defineActionVerb('routine', {
    name: 'new',
    action: 'routine.create',
    usage: '--title T --at <schedule> [--kind agent|command|launch] [--prompt P] [--agent A] [--model M] [--mode M] [--per-run new|continue] [--command C] [--cwd D] [--launch L] [--key K] [--shared]',
    params: [
        { syntax: '--title T', need: 'required', field: 'title' },
        { syntax: '--at <schedule>', need: 'required', field: 'schedule', more: SCHEDULE_SYNTAX },
        ...FIELD_PARAMS,
        { syntax: '--shared', need: 'no value', field: 'shared' }
    ],
    detail: [
        'prints\tsaved\tid\ttitle\tkind\tmode\tshared or private, then held',
        'id\tMade from the title and unique in the project; routine edit, pause and run take it',
        'kind\tagent runs a chat with --prompt in it, under --agent (your own CLI when omitted) and --mode (supervised when omitted); command runs --command in a shell; launch starts --launch',
        'output\tEvery run adds a version to one artifact in Output under --key; an agent run is told to publish there',
        APPROVAL_LINE
    ],
    positionals: z.tuple([], { error: 'routine new takes no arguments; name it with --title' }),
    switches: ['shared'],
    flags: z.object({
        title: z.string({ error: '--title needs a title' }).min(1, '--title needs a title'),
        at: scheduleFlag,
        ...FIELD_FLAGS
    }),
    async run({ flags, switches }, call) {
        const saved = await runAction(call, 'routine.create', {
            title: flags.title,
            schedule: flags.at,
            ...fieldsOf(flags),
            shared: switches.has('shared')
        });
        return savedLines('saved', saved, flags.mode);
    }
});

const editAction = defineActionVerb('routine', {
    name: 'edit',
    action: 'routine.edit',
    usage: '<routine> [--title T] [--at <schedule>] [--kind K] [--prompt P] [--agent A] [--model M] [--mode M] [--per-run R] [--command C] [--cwd D] [--launch L] [--key K]',
    params: [
        ROUTINE_PARAM,
        { syntax: '--title T', need: 'optional', field: 'title' },
        { syntax: '--at <schedule>', need: 'optional', field: 'schedule', more: SCHEDULE_SYNTAX },
        ...FIELD_PARAMS
    ],
    detail: [
        'prints\tsaved\tid\ttitle\tkind\tmode\tshared or private, then held',
        'keeps\tWhat you leave out stays as it was; another --kind keeps only the title, the schedule and the key, and needs what that kind runs',
        'where\tA shared routine stays shared and a private one private; only a person moves one',
        APPROVAL_LINE
    ],
    positionals: routineTuple('edit'),
    flags: z.object({
        title: z.string().min(1, '--title needs a title').optional(),
        at: scheduleFlag.optional(),
        ...FIELD_FLAGS
    }),
    async run({ positionals: [routineId], flags }, call) {
        const saved = await runAction(call, 'routine.edit', {
            routineId,
            ...(flags.title === undefined ? {} : { title: flags.title }),
            ...(flags.at === undefined ? {} : { schedule: flags.at }),
            ...fieldsOf(flags)
        });
        return savedLines('saved', saved, flags.mode);
    }
});

const pauseAction = defineActionVerb('routine', {
    name: 'pause',
    action: 'routine.pause',
    usage: '<routine>',
    params: [ROUTINE_PARAM],
    detail: ['prints\tpaused\tid\ttitle', 'note\tA paused routine starts nothing on this machine until it is resumed; a run that is going goes on'],
    positionals: routineTuple('pause'),
    flags: z.object({}),
    async run({ positionals: [routineId] }, call) {
        const paused = await runAction(call, 'routine.pause', { routineId });
        return [`paused\t${paused.routineId}\t${field(paused.title)}`];
    }
});

const resumeAction = defineActionVerb('routine', {
    name: 'resume',
    action: 'routine.resume',
    usage: '<routine>',
    params: [ROUTINE_PARAM],
    detail: ['prints\tresumed\tid\ttitle', 'note\tIt runs from its next time on, and only once a person approved it as it stands'],
    positionals: routineTuple('resume'),
    flags: z.object({}),
    async run({ positionals: [routineId] }, call) {
        const resumed = await runAction(call, 'routine.resume', { routineId });
        return [`resumed\t${resumed.routineId}\t${field(resumed.title)}`];
    }
});

const runNowAction = defineActionVerb('routine', {
    name: 'run',
    action: 'routine.run',
    usage: '<routine>',
    params: [ROUTINE_PARAM],
    detail: [
        'prints\tstarted\tid\ttitle\trun',
        APPROVAL_LINE,
        'refused\troutine-held\tnobody approved it here as it stands now: ask the person, who approves it in Routines',
        'refused\troutine-busy\tits previous run still runs or waits on a person',
        'see\tartifact_list\twhere the result of the run lands'
    ],
    positionals: routineTuple('run'),
    flags: z.object({}),
    async run({ positionals: [routineId] }, call) {
        const started = await runAction(call, 'routine.run', { routineId });
        return [`started\t${started.routineId}\t${field(started.title)}\t${started.runId}`];
    }
});

export const ROUTINE_SUMMARY =
    'Adds, changes, lists, pauses and runs the routines of the project: an agent, a command or a launch that starts at a set time, once a person approved it';

export const ROUTINE_DETAIL: readonly string[] = [
    'note\tA routine starts work at a time, once or every week, whether or not anyone has the project open; its runs deliver to Output',
    APPROVAL_LINE,
    'never\tNo verb approves a routine; a person does, in Routines'
];

export const ROUTINE_ACTIONS = [listAction, newAction, editAction, pauseAction, resumeAction, runNowAction] as const;
