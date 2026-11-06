import { AgentKindSchema, ChatSkillSchema, ModelSelectionSchema, ProviderAccountIdSchema, RuntimeModeSchema } from '@adecore/agent-contracts';
import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';
import { ArtifactKeySchema } from './artifact.ts';
import { ProjectIdSchema } from './project.ts';
import { cronProblemText, parseCron } from './routine-cron.ts';

/*
 * A routine: work for an agent that starts once at a set time or on repeat, in one project, whose
 * outcome lands in Output as a version of one artifact. Its definition lives in the project's files;
 * whether it may run on this machine is a person's approval under `$RUIMTE_HOME`.
 */

export const ROUTINES_VERSION = 1;

export const ROUTINE_LIMITS = {
    title: 120,
    prompt: 20_000,
    perProject: 50,
    // The runs a list answers per routine; a routine keeps its older runs on disk.
    runsListed: 60,
    cron: 120
} as const;

// `HH:MM` on a 24-hour clock, in the machine's time zone.
const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// `YYYY-MM-DD`, a day in the machine's time zone.
const DaySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

// ISO weekdays: 1 is Monday, 7 is Sunday.
export const WeekdaySchema = z.number().int().min(1).max(7);

// Minutes between the runs of an interval: a quarter hour at the least, half a day at the most.
const ROUTINE_INTERVAL = { min: 15, max: 720, step: 15 } as const;

// From `from` on every `every` minutes, up to and including `to`: 09:00 to 17:00 every 60 runs nine times a day.
export const RoutineIntervalScheduleSchema = z
    .looseObject({
        kind: z.literal('interval'),
        days: z.array(WeekdaySchema).min(1).max(7),
        every: z.number().int().min(ROUTINE_INTERVAL.min).max(ROUTINE_INTERVAL.max).multipleOf(ROUTINE_INTERVAL.step),
        from: ClockTimeSchema,
        to: ClockTimeSchema
    })
    .refine((schedule) => schedule.to > schedule.from, { message: 'to comes after from', path: ['to'] });

// Five crontab fields on the machine's clock, such as `0 9 * * 1-5` (`routine-cron.ts`).
export const RoutineCronScheduleSchema = z
    .looseObject({ kind: z.literal('cron'), expression: z.string().min(1).max(ROUTINE_LIMITS.cron) })
    .superRefine((schedule, context) => {
        const parsed = parseCron(schedule.expression);
        if (!parsed.ok) {
            context.addIssue({ code: 'custom', message: cronProblemText(parsed.problem), path: ['expression'] });
        }
    });

export const RoutineScheduleSchema = z.discriminatedUnion('kind', [
    z.looseObject({ kind: z.literal('once'), date: DaySchema, time: ClockTimeSchema }),
    z.looseObject({ kind: z.literal('weekly'), days: z.array(WeekdaySchema).min(1).max(7), time: ClockTimeSchema }),
    RoutineIntervalScheduleSchema,
    RoutineCronScheduleSchema
]);
export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;

/* `new` starts each run as a chat of its own with the previous result as context; `continue` sends each run to one chat. */
export const RoutinePerRunSchema = z.enum(['new', 'continue']);
export type RoutinePerRun = z.infer<typeof RoutinePerRunSchema>;

const RoutineBaseShape = {
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    title: z.string().trim().min(1).max(ROUTINE_LIMITS.title),
    schedule: RoutineScheduleSchema,
    outputKey: ArtifactKeySchema
};

/*
 * What a person picked in an agent routine's prompt, as `chat.send` takes it: `@` files, `$` skills, and chats and
 * views of the project with `#`. The paths and names also sit in the prompt; these make them chips and context of a run.
 */
export const RoutinePickedSchema = z.looseObject({
    mentions: z.array(z.string().min(1)).max(64).optional(),
    skills: z.array(z.string().min(1)).max(16).optional(),
    chats: z.array(z.string().min(1)).max(16).optional(),
    references: z.array(z.string().min(1)).max(16).optional()
});
export type RoutinePicked = z.infer<typeof RoutinePickedSchema>;

/*
 * What a routine runs: an agent with a prompt, a command in a shell, or a launch of the project.
 * Loose, so a field a newer release adds survives a save by this one; a new field goes at the end, and
 * an entry of a kind this release does not know is kept as it stands.
 */
export const AgentRoutineSchema = z.looseObject({
    ...RoutineBaseShape,
    kind: z.literal('agent'),
    prompt: z.string().trim().min(1).max(ROUTINE_LIMITS.prompt),
    provider: AgentKindSchema,
    selection: ModelSelectionSchema.optional(),
    mode: RuntimeModeSchema,
    perRun: RoutinePerRunSchema,
    picked: RoutinePickedSchema.optional()
});
export type AgentRoutine = z.infer<typeof AgentRoutineSchema>;

export const CommandRoutineSchema = z.looseObject({
    ...RoutineBaseShape,
    kind: z.literal('command'),
    command: z.string().trim().min(1).max(ROUTINE_LIMITS.prompt),
    // Relative to the project folder, POSIX; absent is the project folder itself.
    cwd: z.string().optional()
});

export const LaunchRoutineSchema = z.looseObject({
    ...RoutineBaseShape,
    kind: z.literal('launch'),
    launchId: z.string().min(1)
});

export const RoutineSchema = z.discriminatedUnion('kind', [AgentRoutineSchema, CommandRoutineSchema, LaunchRoutineSchema]);
export type Routine = z.infer<typeof RoutineSchema>;
export type RoutineKind = Routine['kind'];

/* What one person keeps of a routine on this machine, shared or not: never in the shared file. */
export const RoutineLocalSchema = z.looseObject({
    account: ProviderAccountIdSchema.optional(),
    // Epoch ms; absent while it runs.
    pausedAt: z.number().int().nonnegative().optional(),
    // The definition a person said no to; a change to it asks again.
    declined: z.string().min(1).optional()
});
export type RoutineLocal = z.infer<typeof RoutineLocalSchema>;

/* `.ruimte/routines.json`. Read entry by entry, so one this release cannot read is kept as it stands. */
export const RoutinesSharedFileSchema = z.looseObject({
    version: z.number().int().positive(),
    routines: z.array(z.unknown())
});
export type RoutinesSharedFile = z.infer<typeof RoutinesSharedFileSchema>;

/* `.ruimte/private/routines.json`: the rev, this person's own routines, the order over both files and what each keeps here. */
export const RoutinesPrivateFileSchema = z.looseObject({
    version: z.number().int().positive(),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative(),
    order: z.array(z.string()).optional(),
    routines: z.array(z.unknown()).optional(),
    // By routine id, over both files.
    local: z.record(z.string(), RoutineLocalSchema).optional()
});
export type RoutinesPrivateFile = z.infer<typeof RoutinesPrivateFileSchema>;

export type RoutineFileEntry = { routine: Routine } | { raw: unknown };

export function readRoutineEntries(entries: readonly unknown[]): RoutineFileEntry[] {
    return entries.map((raw) => {
        const parsed = RoutineSchema.safeParse(raw);
        return parsed.success ? { routine: parsed.data } : { raw };
    });
}

/* Why a routine waits on a person here: an agent made or changed it, or it came in through git or a hand edit. Absent once approved. */
export const RoutineHeldSchema = z.enum(['agent', 'outside']);

/* The agent chat that last made or changed a routine, as the machine wrote it down. */
export const RoutineMadeBySchema = z.object({
    chatId: z.string().min(1),
    title: z.string(),
    at: z.number().int().nonnegative()
});
export type RoutineMadeBy = z.infer<typeof RoutineMadeBySchema>;

export const RoutineRunKindSchema = z.enum(['scheduled', 'caught-up', 'manual']);
export type RoutineRunKind = z.infer<typeof RoutineRunKindSchema>;

/*
 * `skipped`: it was due but did not start (`skipped` says why). `running`, `needs-you`: its chat now.
 * `limit`: stopped on a usage limit, taken up again at `limitUntil` when a person turned that on.
 * `done` and `failed` once its chat ended the turn, or its command exited.
 */
export const RoutineRunStateSchema = z.enum(['skipped', 'starting', 'running', 'needs-you', 'limit', 'done', 'failed']);
export type RoutineRunState = z.infer<typeof RoutineRunStateSchema>;

/* `overlap`: the previous run still ran or waited on a person. `held`: nobody approved it as it stood. `paused`: a person paused it. */
export const RoutineSkipSchema = z.enum(['overlap', 'held', 'paused']);
export type RoutineSkip = z.infer<typeof RoutineSkipSchema>;

export const RoutineRunSchema = z.object({
    runId: z.string().min(1),
    routineId: z.string().min(1),
    projectId: ProjectIdSchema,
    kind: RoutineRunKindSchema,
    // Epoch ms: when it was due, and when the machine took it up. A manual run is due when it was asked.
    due: z.number().int().nonnegative(),
    at: z.number().int().nonnegative(),
    // The times it missed while the machine slept or was off, which this one run made up for.
    missed: z.array(z.number().int().nonnegative()).optional(),
    state: RoutineRunStateSchema,
    skipped: RoutineSkipSchema.optional(),
    // The chat of an agent run.
    chatId: z.string().min(1).optional(),
    // How a command or a launch ended.
    exitCode: z.number().int().optional(),
    // Whether it waited on a person at some point, and until when.
    waited: z.boolean().optional(),
    limitUntil: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
    // Why it failed, in the machine's words.
    error: z.string().optional(),
    // The version of the routine's artifact this run delivered.
    artifactId: z.string().min(1).optional(),
    versionId: z.string().min(1).optional(),
    versionNumber: z.number().int().positive().optional(),
    // The turns its chat had ended before this run, so a chat that has not begun the run's turn yet is not read as done.
    turnsBefore: z.number().int().nonnegative().optional()
});
export type RoutineRun = z.infer<typeof RoutineRunSchema>;

/* A routine as a client shows it, with what this machine knows of it. */
export const RoutineEntrySchema = z.object({
    routine: RoutineSchema,
    projectId: ProjectIdSchema,
    projectName: z.string(),
    shared: z.boolean(),
    local: RoutineLocalSchema,
    // What an approval covers; `routine.approve` names it so a person approves what they saw.
    digest: z.string().min(1),
    approved: z.boolean(),
    held: RoutineHeldSchema.optional(),
    madeBy: RoutineMadeBySchema.optional(),
    // Epoch ms of the next time it is due here; null while paused, held, declined or past its once.
    next: z.number().int().nonnegative().nullable(),
    // Newest first, at most `ROUTINE_LIMITS.runsListed`.
    runs: z.array(RoutineRunSchema),
    // The artifact its runs deliver to, once one did.
    artifactId: z.string().min(1).optional()
});
export type RoutineEntry = z.infer<typeof RoutineEntrySchema>;

export const RoutineListPayloadSchema = z.object({ projectId: ProjectIdSchema.optional() });

export const RoutineListResultSchema = z.object({
    routines: z.array(RoutineEntrySchema),
    // The rev of each project's routines, which a save names.
    revs: z.record(z.string(), z.number().int().nonnegative()),
    // The machine's time zone, which every schedule is read in.
    timeZone: z.string()
});
export type RoutineListResult = z.infer<typeof RoutineListResultSchema>;

export const RoutineTargetPayloadSchema = z.object({ projectId: ProjectIdSchema, routineId: z.string().min(1) });

export const RoutineGetResultSchema = z.object({ routine: RoutineEntrySchema, rev: z.number().int().nonnegative(), timeZone: z.string() });
export type RoutineGetResult = z.infer<typeof RoutineGetResultSchema>;

/* A person's save of one routine, new or changed; it counts as their approval on this machine. */
export const RoutineSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    baseRev: z.number().int().nonnegative(),
    routine: RoutineSchema,
    shared: z.boolean(),
    account: ProviderAccountIdSchema.nullable().optional()
});

export const RoutineSaveResultSchema = z.object({ rev: z.number().int().nonnegative(), routineId: z.string().min(1) });

export const RoutineApprovePayloadSchema = RoutineTargetPayloadSchema.extend({ digest: z.string().min(1) });

export const RoutineRemovePayloadSchema = RoutineTargetPayloadSchema.extend({ baseRev: z.number().int().nonnegative() });

/* `held`: nothing started, nobody approved it as it stands. `busy`: nothing started, its previous run still runs or waits. */
export const RoutineRunNowResultSchema = z.object({
    outcome: z.enum(['started', 'held', 'busy']),
    runId: z.string().min(1).optional()
});
export type RoutineRunNowResult = z.infer<typeof RoutineRunNowResultSchema>;

/* The skills an agent would run in a project, for a routine's prompt before any chat of it exists. */
export const RoutineSkillsPayloadSchema = z.object({ projectId: ProjectIdSchema, provider: AgentKindSchema });
export type RoutineSkillsPayload = z.infer<typeof RoutineSkillsPayloadSchema>;

export const RoutineSkillsResultSchema = z.object({ skills: z.array(ChatSkillSchema) });
export type RoutineSkillsResult = z.infer<typeof RoutineSkillsResultSchema>;

// Only to the clients that asked with `routine.watch`; they read the project's routines again.
export const RoutineChangedEventSchema = z.object({ projectId: ProjectIdSchema });

export const ROUTINE_REQUEST_SCHEMAS = {
    // A person's own: no request of these is on a peer's list, and an agent reaches routines only through its verbs.
    'routine.list': { payload: RoutineListPayloadSchema, result: RoutineListResultSchema },
    'routine.get': { payload: RoutineTargetPayloadSchema, result: RoutineGetResultSchema },
    'routine.save': { payload: RoutineSavePayloadSchema, result: RoutineSaveResultSchema },
    'routine.approve': { payload: RoutineApprovePayloadSchema, result: EmptySchema },
    'routine.decline': { payload: RoutineApprovePayloadSchema, result: EmptySchema },
    'routine.pause': { payload: RoutineTargetPayloadSchema, result: EmptySchema },
    'routine.resume': { payload: RoutineTargetPayloadSchema, result: EmptySchema },
    'routine.runNow': { payload: RoutineTargetPayloadSchema, result: RoutineRunNowResultSchema },
    'routine.remove': { payload: RoutineRemovePayloadSchema, result: EmptySchema },
    'routine.watch': { payload: EmptySchema, result: EmptySchema },
    'routine.unwatch': { payload: EmptySchema, result: EmptySchema },
    'routine.skills': { payload: RoutineSkillsPayloadSchema, result: RoutineSkillsResultSchema }
} as const;

export const ROUTINE_EVENT_SCHEMAS = {
    // Only to the clients that asked with `routine.watch`.
    'routine.changed': RoutineChangedEventSchema
} as const;
