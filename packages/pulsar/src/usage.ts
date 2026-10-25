import type { KnownAgentKind } from '@adecore/agent-contracts/agent';
import { z } from 'zod';

/*
 * Anonymous usage statistics: a machine counts per UTC day and sends each finished day once. Nothing in a
 * day names a person, a machine or a project: no ids, no keys, no names, no paths, only the counts below.
 */

export const USAGE_PATH = '/v1/usage';

// A machine sends at most the last seven finished days it missed; one day more absorbs a slow clock.
export const USAGE_MAX_DAYS_PER_BATCH = 7;
export const USAGE_MAX_AGE_DAYS = 8;

// Well above a heavy day of one machine, so only a broken or forged counter meets it. A machine clamps before it sends.
export const USAGE_MAX_COUNT = 100_000;
export const USAGE_MAX_STARTUP_MS = 600_000;

// The versions the release scripts never ship; a test batch carries one so every view of the data can leave it out.
export const USAGE_TEST_VERSION_PREFIX = '0.0.0';

// The fields of the address book's batch, frozen: daemons before 0.22 send exactly these, and the batch is read strictly.
export const USAGE_POINTS = {
    day: [
        'active',
        'firstThisWeek',
        'firstThisMonth',
        'startupMs',
        'projectsOpened',
        'terminalsStarted',
        'agentsDelegated',
        'teamsDelegated',
        'launchesRun',
        'worktreeMerges',
        'clientsDesktop',
        'clientsIos',
        'clientsStation',
        'clientsPeer',
        'browserActions',
        'deviceActions',
        'databaseActions',
        'computerActions'
    ],
    work: [
        'viewsCanvas',
        'viewsChat',
        'viewsTerminal',
        'viewsBrowser',
        'viewsDevice',
        'viewsDrawing',
        'viewsDiagram',
        'viewsFile',
        'viewsDatabase',
        'chatsClaude',
        'chatsCodex',
        'chatsGemini',
        'chatsCopilot',
        'chatsApple',
        'turnsClaude',
        'turnsCodex',
        'turnsGemini',
        'turnsCopilot',
        'turnsApple'
    ],
    verbs: [
        'verbsRead',
        'verbsTask',
        'verbsMessage',
        'verbsAgent',
        'verbsCanvas',
        'verbsBrowser',
        'verbsDevice',
        'verbsDatabase',
        'verbsComputer',
        'verbsWorktree',
        'verbsLaunches',
        'verbsSecret',
        'verbsLanguage'
    ]
} as const;

export type UsagePointKind = keyof typeof USAGE_POINTS;
export const USAGE_POINT_KINDS = Object.keys(USAGE_POINTS) as UsagePointKind[];

export type UsageField = (typeof USAGE_POINTS)[UsagePointKind][number];

// The fields of `day` that describe the day rather than count something in it.
export const USAGE_DAY_MEASURES = ['active', 'firstThisWeek', 'firstThisMonth', 'startupMs'] as const;
export type UsageDayMeasure = (typeof USAGE_DAY_MEASURES)[number];

export type UsageCounter = Exclude<UsageField, UsageDayMeasure>;

const MEASURES: ReadonlySet<string> = new Set(USAGE_DAY_MEASURES);

export const USAGE_COUNTERS = USAGE_POINT_KINDS.flatMap((kind) => USAGE_POINTS[kind].filter((key) => !MEASURES.has(key))) as UsageCounter[];

/*
 * The project view kinds a machine counts openings of, and the counter of each. A kind added to the
 * contracts needs a counter here first; `packages/contracts` holds the two lists against each other.
 */
export const USAGE_VIEW_COUNTERS = {
    canvas: 'viewsCanvas',
    chat: 'viewsChat',
    terminal: 'viewsTerminal',
    browser: 'viewsBrowser',
    device: 'viewsDevice',
    drawing: 'viewsDrawing',
    diagram: 'viewsDiagram',
    file: 'viewsFile',
    database: 'viewsDatabase'
} as const satisfies Record<string, UsageCounter>;

// Only the kinds the batch has counters for; a chat of any other kind is not counted.
export const USAGE_CHAT_COUNTERS = {
    claude: { chats: 'chatsClaude', turns: 'turnsClaude' },
    codex: { chats: 'chatsCodex', turns: 'turnsCodex' },
    gemini: { chats: 'chatsGemini', turns: 'turnsGemini' },
    copilot: { chats: 'chatsCopilot', turns: 'turnsCopilot' },
    apple: { chats: 'chatsApple', turns: 'turnsApple' }
} as const satisfies Record<KnownAgentKind, { chats: UsageCounter; turns: UsageCounter }>;

// Every `ruimte-context` verb in one group, since the batch has fewer counters than there are verbs.
export const USAGE_VERB_COUNTERS = {
    help: 'verbsRead',
    list: 'verbsRead',
    read: 'verbsRead',
    provider: 'verbsRead',
    bridge: 'verbsRead',
    done: 'verbsTask',
    task: 'verbsTask',
    plan: 'verbsTask',
    answer: 'verbsTask',
    notify: 'verbsMessage',
    alert: 'verbsMessage',
    flag: 'verbsMessage',
    chat: 'verbsMessage',
    agent: 'verbsAgent',
    team: 'verbsAgent',
    fork: 'verbsAgent',
    node: 'verbsCanvas',
    link: 'verbsCanvas',
    view: 'verbsCanvas',
    ui: 'verbsCanvas',
    project: 'verbsCanvas',
    visual: 'verbsCanvas',
    browser: 'verbsBrowser',
    device: 'verbsDevice',
    database: 'verbsDatabase',
    computer: 'verbsComputer',
    worktree: 'verbsWorktree',
    launches: 'verbsLaunches',
    operation: 'verbsLaunches',
    secret: 'verbsSecret',
    language: 'verbsLanguage'
} as const satisfies Record<string, UsageCounter>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DAY_MS = 86_400_000;

function isCalendarDate(text: string): boolean {
    return DATE_PATTERN.test(text) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);
}

/* The UTC day of a moment, as `YYYY-MM-DD`. */
export function usageDateOf(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
}

/* The ISO 8601 week of a UTC day, as `YYYY-Www`: weeks start on Monday and week 1 holds the year's first Thursday. */
export function isoWeekOf(date: string): string {
    const day = new Date(`${date}T00:00:00Z`);
    const weekday = (day.getUTCDay() + 6) % 7;
    const thursday = new Date(day.getTime() + (3 - weekday) * DAY_MS);
    const year = thursday.getUTCFullYear();
    const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
    return `${year}-W${String(week).padStart(2, '0')}`;
}

const CountSchema = z.number().int().min(0).max(USAGE_MAX_COUNT);

export const UsageCountsSchema = z.strictObject(
    Object.fromEntries(USAGE_COUNTERS.map((counter) => [counter, CountSchema.optional()])) as Record<UsageCounter, z.ZodOptional<typeof CountSchema>>
);
export type UsageCounts = z.infer<typeof UsageCountsSchema>;

/* What describes a day and the machine it is of, in the address book's batch and in the report alike (`usage-report.ts`). */
export const USAGE_DAY_DESCRIPTION = {
    // The UTC day the counts are of, finished before it is sent.
    date: z.string().refine(isCalendarDate, 'Expected a UTC day as YYYY-MM-DD'),
    version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,32})?$/, 'Expected a release version'),
    platform: z.enum(['darwin', 'linux', 'win32', 'other']),
    arch: z.enum(['arm64', 'x64', 'other']),
    launcher: z.enum(['service', 'desktop', 'standalone']),
    signedIn: z.boolean(),
    // The machine's first active day of this ISO week or this UTC calendar month, so a sum of either is the active machines in it.
    firstThisWeek: z.boolean(),
    firstThisMonth: z.boolean(),
    // The ISO week of the machine's first day with Ruimte, for retention.
    cohortWeek: z.string().regex(WEEK_PATTERN, 'Expected an ISO week as YYYY-Www')
};

/* A cohort week after the day itself is a clock or a counter that is off. */
export function usageCohortProblem(day: { date: string; cohortWeek: string }): boolean {
    return isCalendarDate(day.date) && WEEK_PATTERN.test(day.cohortWeek) && day.cohortWeek > isoWeekOf(day.date);
}

export const UsageDaySchema = z
    .strictObject({
        ...USAGE_DAY_DESCRIPTION,
        // The median of the day's desktop starts until the first connection, in milliseconds; absent when the desktop did not start.
        startupMs: z.number().int().min(1).max(USAGE_MAX_STARTUP_MS).optional(),
        counts: UsageCountsSchema
    })
    .refine((day) => !usageCohortProblem(day), { message: 'The cohort week is after the day', path: ['cohortWeek'] });
export type UsageDay = z.infer<typeof UsageDaySchema>;

export const UsageBatchSchema = z
    .strictObject({ days: z.array(UsageDaySchema).min(1).max(USAGE_MAX_DAYS_PER_BATCH) })
    .refine((batch) => new Set(batch.days.map((day) => day.date)).size === batch.days.length, { message: 'A day appears twice', path: ['days'] });
export type UsageBatch = z.infer<typeof UsageBatchSchema>;

/* Why a day falls outside what the address book takes at `now`, or null when it is in. Today counts, for a clock a little ahead. */
export function usageDateProblem(date: string, now: number): string | null {
    const today = usageDateOf(now);
    if (date > today) {
        return 'The day is in the future';
    }
    if (date < usageDateOf(now - USAGE_MAX_AGE_DAYS * DAY_MS)) {
        return `The day is more than ${USAGE_MAX_AGE_DAYS} days old`;
    }
    return null;
}
