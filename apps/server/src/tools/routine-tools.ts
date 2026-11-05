import { modeField } from '@adecore/agents/providers';
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
import { field, orNote, requiredField } from '../canvas/host.ts';
import { modelFlag } from '../canvas/model.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineTool, defineToolkit } from './tool.ts';

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const DAY_SETS: Record<string, readonly number[]> = {
    daily: [1, 2, 3, 4, 5, 6, 7],
    weekdays: [1, 2, 3, 4, 5],
    weekends: [6, 7]
};

const SCHEDULE_SYNTAX =
    '"daily 23:00", "weekdays 09:00", "weekends 10:30", "mon,thu 17:00", "once 2026-10-27 22:00", a repeat within a day such as "weekdays every 1h 09:00-17:00" or "daily every 30m 08:00-18:00" (steps of 15m up to 12h, both ends included), or "cron" and five crontab fields such as "cron 0 9 * * 1-5" or "cron */30 8-18 * * mon-fri" (at most every 15m)';

const SCHEDULE_GUIDE = [
    `at\tWhen it runs, in the time zone of this machine: once on a day at a time, every week on some days at a time, on some days every so many minutes from one time to another, or a five-field crontab expression that runs at most every 15 minutes; ${SCHEDULE_SYNTAX}`
];

const TOGGLES = ['pause', 'resume'] as const;

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

/* `at` as an agent writes it: a set of days and a time, or once on a day at a time, in the machine's time zone. */
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

/* A schedule in the words `at` takes, so a list reads back as what an edit would give. */
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

export function approvalOf(entry: RoutineEntry): string {
    if (entry.approved) {
        return 'yes';
    }
    return entry.held === undefined ? 'declined' : 'held';
}

/* A run's state, with why it was skipped after a colon. */
export function runStateOf(run: RoutineRun): string {
    return run.skipped === undefined ? run.state : `${run.state}:${run.skipped}`;
}

function lastOf(entry: RoutineEntry): string {
    const run = entry.runs[0];

    return run === undefined ? '-' : runStateOf(run);
}

const ScheduleInput = z.string().transform((text, context) => {
    const schedule = parseSchedule(text);

    if (schedule === null) {
        const cron = /^\s*cron\b(.*)$/i.exec(text);
        const parsed = cron === null ? null : parseCron(cron[1]!);
        const message = parsed !== null && !parsed.ok ? `at cron: ${cronProblemText(parsed.problem)}` : `at takes ${SCHEDULE_SYNTAX}`;

        context.addIssue({ code: 'custom', message });

        return z.NEVER;
    }

    return schedule;
});

const AT_TEXT = 'Such as "weekdays 09:00", in machine time. Format: guide topic schedule';

const FIELD_INPUT = {
    kind: z.enum(['agent', 'command', 'launch'], { error: 'kind is agent, command or launch' }).optional(),
    prompt: z.string().optional(),
    agent: z.string().min(1, 'agent needs the name of a CLI').optional().describe('The CLI, such as claude'),
    model: modelFlag,
    mode: modeField,
    per_run: RoutinePerRunSchema.optional().describe('A chat per run (new) or one chat (continue)'),
    command: z.string().optional(),
    cwd: z.string().min(1, 'cwd needs the path of a folder').optional().describe('For kind command'),
    launch: z.string().min(1, 'launch needs the id of a launch').optional(),
    key: z.string().optional().describe('The Output artifact runs add to')
};

type FieldInput = { [Name in keyof typeof FIELD_INPUT]?: z.output<(typeof FIELD_INPUT)[Name]> };

function fieldsOf(input: FieldInput) {
    const given = {
        kind: input.kind,
        prompt: input.prompt,
        provider: input.agent,
        model: input.model,
        mode: input.mode,
        perRun: input.per_run,
        command: input.command,
        cwd: input.cwd,
        launch: input.launch,
        key: input.key
    };

    return Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) as Partial<typeof given>;
}

function routineInput(tool: string) {
    return requiredField(`${tool} needs routine, the id of a routine; routine_list lists them`);
}

function savedLines(output: { routineId: string; title: string; kind: string; mode: string | null; shared: boolean }, asked: string | undefined): string[] {
    return [
        `saved\t${output.routineId}\t${field(output.title)}\t${output.kind}\t${output.mode ?? '-'}\t${output.shared ? 'shared' : 'private'}`,
        'held\tIt waits for a person to approve it in Routines on this machine, and runs nothing until then; tell them what you set up and why',
        ...(asked !== undefined && output.mode !== null && output.mode !== asked
            ? [`note\tmode ${asked} is wider than your own, so it runs in ${output.mode}`]
            : [])
    ];
}

const routineList = defineActionTool('routine', {
    name: 'routine_list',
    action: 'routine.list',
    description: 'Lists the routines of the project.',
    annotations: { readOnly: true },
    input: z.object({}),
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

const routineNew = defineActionTool('routine', {
    name: 'routine_new',
    action: 'routine.create',
    description: 'Adds a routine that starts an agent, a command or a launch on a schedule.',
    input: z.object({
        title: requiredField('routine_new needs title, a title'),
        at: ScheduleInput.describe(AT_TEXT),
        ...FIELD_INPUT,
        shared: z.boolean().optional().describe('In the shared project file a team commits')
    }),
    async run(input, call) {
        const saved = await runAction(call, 'routine.create', {
            title: input.title,
            schedule: input.at,
            ...fieldsOf(input),
            shared: input.shared === true
        });

        return savedLines(saved, input.mode);
    }
});

const routineEdit = defineActionTool('routine', {
    name: 'routine_edit',
    action: 'routine.edit',
    description: 'Changes a routine.',
    input: z.object({
        routine: routineInput('routine_edit'),
        title: z.string().min(1, 'title needs a title').optional(),
        at: ScheduleInput.optional().describe(AT_TEXT),
        ...FIELD_INPUT
    }),
    async run(input, call) {
        const saved = await runAction(call, 'routine.edit', {
            routineId: input.routine,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.at === undefined ? {} : { schedule: input.at }),
            ...fieldsOf(input)
        });

        return savedLines(saved, input.mode);
    }
});

/* Pausing and resuming take the same field and the same risk, so one tool picks among them. */
const routineToggle = defineTool('routine', {
    name: 'routine_toggle',
    description: 'Pauses or resumes a routine of this project.',
    input: z.object({
        action: z.enum(TOGGLES, { error: `routine_toggle needs action, one of ${TOGGLES.join(', ')}` }),
        routine: routineInput('routine_toggle')
    }),
    async run(input, call) {
        if (input.action === 'pause') {
            const paused = await runAction(call, 'routine.pause', { routineId: input.routine });

            return [`paused\t${paused.routineId}\t${field(paused.title)}`];
        }

        const resumed = await runAction(call, 'routine.resume', { routineId: input.routine });

        return [`resumed\t${resumed.routineId}\t${field(resumed.title)}`];
    }
});

const routineRun = defineActionTool('routine', {
    name: 'routine_run',
    action: 'routine.run',
    description: 'Runs an approved routine now.',
    input: z.object({ routine: routineInput('routine_run') }),
    async run(input, call) {
        const started = await runAction(call, 'routine.run', { routineId: input.routine });

        return [`started\t${started.routineId}\t${field(started.title)}\t${started.runId}`];
    }
});

export const routineToolkit = defineToolkit(
    'routine',
    [routineList, routineNew, routineEdit, routineToggle, routineRun],
    [{ name: 'schedule', lines: SCHEDULE_GUIDE }]
);
