import { z } from 'zod';
import {
    USAGE_DAY_DESCRIPTION,
    USAGE_MAX_COUNT,
    USAGE_MAX_DAYS_PER_BATCH,
    USAGE_MAX_STARTUP_MS,
    USAGE_VERB_COUNTERS,
    USAGE_VIEW_COUNTERS,
    usageCohortProblem,
    type UsageBatch,
    type UsageCounter
} from './usage.ts';

/*
 * The usage report a daemon sends Observatory from 0.22 on: the same description of a day as the address book's
 * batch, with flat counters named from the allow-list below and one median per timing. A name with a dot is one value
 * of a dimension (`chats.claude`), which Observatory groups by the part before the last dot. Every name is fixed here,
 * with `other` where a set can grow, so nothing a person typed or chose ever becomes a name.
 */

// Under Observatory's limit with room; a daemon sends fewer days when a batch would be larger.
export const USAGE_REPORT_MAX_BYTES = 32 * 1024;

export const USAGE_PROVIDERS = ['claude', 'codex', 'copilot', 'grok', 'antigravity', 'apple', 'nanogpt', 'other'] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

export const USAGE_MODEL_FAMILIES = [
    'fable',
    'opus',
    'sonnet',
    'haiku',
    'codex',
    'gpt',
    'grok',
    'gemini',
    'apple',
    'deepseek',
    'qwen',
    'llama',
    'mistral',
    'kimi',
    'glm',
    'other'
] as const;
export type UsageModelFamily = (typeof USAGE_MODEL_FAMILIES)[number];

// The runtime modes of `@adecore/agent-contracts` a chat turn ran with, and plan mode beside them, in Observatory's alphabet.
export const USAGE_MODES = ['supervised', 'autoAcceptEdits', 'auto', 'fullAccess', 'plan'] as const;
export type UsageMode = (typeof USAGE_MODES)[number];

const MODE_OF: Readonly<Record<string, UsageMode>> = {
    supervised: 'supervised',
    'auto-accept-edits': 'autoAcceptEdits',
    auto: 'auto',
    'full-access': 'fullAccess',
    plan: 'plan'
};

/* The counter name of a runtime mode; null for one this list does not know, which is then not counted. */
export function usageModeOf(mode: string): UsageMode | null {
    return MODE_OF[mode] ?? null;
}

// How a connection to a machine went: this machine's own socket, the local network, a direct channel or one through TURN.
export const USAGE_CONNECTION_PATHS = ['local', 'lan', 'direct', 'turn'] as const;

// Why a connection to a machine did not open.
export const USAGE_CONNECT_FAILURES = ['timeout', 'refused', 'signaling', 'ice', 'closed', 'other'] as const;

// Observatory's limit; a day stays far below it, since zeros are left out.
export const USAGE_REPORT_MAX_COUNTERS = 500;

const PLAIN_COUNTERS = [
    'projects.opened',
    'terminals.started',
    'agents.delegated',
    'teams.delegated',
    'launches.run',
    'worktree.merges',
    'clients.desktop',
    'clients.ios',
    'clients.station',
    'clients.peer',
    'actions.browser',
    'actions.device',
    'actions.database',
    'actions.computer',
    // Not `limits.resumed`: Observatory would group that with `limits.<provider>` as one more provider.
    'limitResumes',
    'voice.sessions',
    'dictations',
    'files.opened',
    'files.saved',
    'git.commits',
    'git.pushes',
    'git.pulls',
    'git.conflictsResolved',
    'plans.created',
    'visuals.shown',
    'prWatches.started',
    'database.queries',
    'devices.started',
    'peers.tasks'
] as const;

const prefixed = <Prefix extends string, Value extends string>(prefix: Prefix, values: readonly Value[]): `${Prefix}.${Value}`[] =>
    values.map((value) => `${prefix}.${value}` as const);

const VIEW_KINDS = Object.keys(USAGE_VIEW_COUNTERS) as (keyof typeof USAGE_VIEW_COUNTERS)[];
const VERBS = Object.keys(USAGE_VERB_COUNTERS) as (keyof typeof USAGE_VERB_COUNTERS)[];

export const USAGE_REPORT_COUNTERS = [
    ...PLAIN_COUNTERS,
    ...prefixed('views', VIEW_KINDS),
    ...prefixed('verbs', VERBS),
    ...prefixed('chats', USAGE_PROVIDERS),
    ...prefixed('turns', USAGE_PROVIDERS),
    ...prefixed('limits', USAGE_PROVIDERS),
    ...prefixed('turns.model', USAGE_MODEL_FAMILIES),
    ...prefixed('turns.mode', USAGE_MODES),
    ...prefixed('connections', USAGE_CONNECTION_PATHS),
    ...prefixed('connectFailures', USAGE_CONNECT_FAILURES)
] as const;
export type UsageReportCounter = (typeof USAGE_REPORT_COUNTERS)[number];

// What only the app on the machine sees and hands over (`usage.count`, `usage.timing`): a dictation and how its links went.
export const USAGE_CLIENT_COUNTERS = [
    'dictations',
    ...prefixed('connections', USAGE_CONNECTION_PATHS),
    ...prefixed('connectFailures', USAGE_CONNECT_FAILURES)
] as const satisfies readonly UsageReportCounter[];
export const USAGE_CLIENT_TIMINGS = ['remoteConnectMs'] as const;

// `startupMs` stays the day's own field, as in the address book's batch.
export const USAGE_REPORT_TIMINGS = [...prefixed('firstTokenMs', USAGE_PROVIDERS), 'terminalAttachMs', 'remoteConnectMs'] as const;
export type UsageReportTiming = (typeof USAGE_REPORT_TIMINGS)[number];

const CountSchema = z.number().int().min(1).max(USAGE_MAX_COUNT);
const TimingSchema = z.number().int().min(1).max(USAGE_MAX_STARTUP_MS);

export const UsageReportDaySchema = z
    .strictObject({
        ...USAGE_DAY_DESCRIPTION,
        // The median of the day's desktop starts until the first connection, in milliseconds; absent when the desktop did not start.
        startupMs: TimingSchema.optional(),
        // Zeros are left out.
        counts: z.partialRecord(z.enum(USAGE_REPORT_COUNTERS), CountSchema),
        // One median per name over the day's samples on this machine, in whole milliseconds; Observatory takes the percentiles across machines.
        timings: z.partialRecord(z.enum(USAGE_REPORT_TIMINGS), TimingSchema).optional()
    })
    .refine((day) => !usageCohortProblem(day), { message: 'The cohort week is after the day', path: ['cohortWeek'] })
    .refine((day) => Object.keys(day.counts).length <= USAGE_REPORT_MAX_COUNTERS, { message: 'Too many counters in a day', path: ['counts'] });
export type UsageReportDay = z.infer<typeof UsageReportDaySchema>;

export const UsageReportBatchSchema = z
    .strictObject({ days: z.array(UsageReportDaySchema).min(1).max(USAGE_MAX_DAYS_PER_BATCH) })
    .refine((batch) => new Set(batch.days.map((day) => day.date)).size === batch.days.length, { message: 'A day appears twice', path: ['days'] });
export type UsageReportBatch = z.infer<typeof UsageReportBatchSchema>;

const FAMILY_PATTERNS: readonly [RegExp, UsageModelFamily][] = [
    [/fable/, 'fable'],
    [/opus/, 'opus'],
    [/sonnet/, 'sonnet'],
    [/haiku/, 'haiku'],
    [/codex/, 'codex'],
    [/(^|[/:-])(gpt|o\d)/, 'gpt'],
    [/grok/, 'grok'],
    [/gemini/, 'gemini'],
    [/apple|foundation/, 'apple'],
    [/deepseek/, 'deepseek'],
    [/qwen/, 'qwen'],
    [/llama/, 'llama'],
    [/mistral|mixtral|codestral/, 'mistral'],
    [/kimi|moonshot/, 'kimi'],
    [/glm/, 'glm']
];

/* The family a model id belongs to, so a turn names `opus` and never the id a person or a provider chose. */
export function usageModelFamilyOf(model: string): UsageModelFamily {
    const id = model.toLowerCase();
    return FAMILY_PATTERNS.find(([pattern]) => pattern.test(id))?.[1] ?? 'other';
}

export function usageProviderOf(kind: string): UsageProvider {
    return (USAGE_PROVIDERS as readonly string[]).includes(kind) ? (kind as UsageProvider) : 'other';
}

// Gemini left the product; an older daemon's count of it lands in `other`.
const PROVIDER_OF_V1: Readonly<Record<string, UsageProvider>> = {
    Claude: 'claude',
    Codex: 'codex',
    Gemini: 'other',
    Copilot: 'copilot',
    Apple: 'apple'
};

const V1_PLAIN: Partial<Record<UsageCounter, UsageReportCounter>> = {
    projectsOpened: 'projects.opened',
    terminalsStarted: 'terminals.started',
    agentsDelegated: 'agents.delegated',
    teamsDelegated: 'teams.delegated',
    launchesRun: 'launches.run',
    worktreeMerges: 'worktree.merges',
    clientsDesktop: 'clients.desktop',
    clientsIos: 'clients.ios',
    clientsStation: 'clients.station',
    clientsPeer: 'clients.peer',
    browserActions: 'actions.browser',
    deviceActions: 'actions.device',
    databaseActions: 'actions.database',
    computerActions: 'actions.computer'
};

/* The report name of a counter of the address book's batch; null for a verb group, which named no single verb. */
export function usageReportCounterOfV1(counter: UsageCounter): UsageReportCounter | null {
    const plain = V1_PLAIN[counter];
    if (plain !== undefined) {
        return plain;
    }
    const view = /^views([A-Z]\w*)$/.exec(counter)?.[1];
    if (view !== undefined) {
        return `views.${view.toLowerCase()}` as UsageReportCounter;
    }
    const chat = /^(chats|turns)([A-Z]\w*)$/.exec(counter);
    const provider = chat === null ? undefined : PROVIDER_OF_V1[chat[2]!];
    if (chat !== null && provider !== undefined) {
        return `${chat[1] as 'chats' | 'turns'}.${provider}`;
    }
    return null;
}

/*
 * An older daemon's batch as a report, for the address book's relay until `/v1/usage` goes: the same day, its
 * counters under their report names, summed where two land on one (Gemini in `other`), and its verb groups left out,
 * since a group names no single verb.
 */
export function usageReportOfV1(batch: UsageBatch): UsageReportBatch {
    return {
        days: batch.days.map(({ counts, ...day }) => {
            const report: Partial<Record<UsageReportCounter, number>> = {};
            for (const [counter, value] of Object.entries(counts) as [UsageCounter, number | undefined][]) {
                const name = usageReportCounterOfV1(counter);
                if (name !== null && value !== undefined && value > 0) {
                    report[name] = Math.min((report[name] ?? 0) + value, USAGE_MAX_COUNT);
                }
            }
            return { ...day, counts: report };
        })
    };
}
