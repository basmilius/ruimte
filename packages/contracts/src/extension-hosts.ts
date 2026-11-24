import { z } from 'zod';
import {
    HOST_LIMITS,
    hostCheckState,
    hostChecksState,
    hostRef,
    type HostChange,
    type HostChangeSummary,
    type HostCheckLogResult,
    type HostIssue,
    type HostIssueSummary
} from './host.ts';

/*
 * What a host provider of an extension answers, as the machine and `createTestServer` both take it: the shapes of
 * `@ruimte/extension/server`, read into the neutral ones of `host.ts`. Everything in it is text a stranger wrote on a
 * host, so a long text is cut, a line loses its line breaks, an address that is no web page is dropped, and a provider
 * names its own issues and changes by locator only, which Ruimte puts its id in front of.
 */

/* What a provider says of itself when it registers: which of the optional parts it has. */
export const HostProviderShapeSchema = z.object({
    title: z.string().min(1).max(80),
    // Whether it has `match`, which makes it a code host found from a remote rather than a tracker.
    matches: z.boolean(),
    issues: z.boolean(),
    // Whether its issues have `parse`.
    parses: z.boolean(),
    changes: z.boolean(),
    checks: z.boolean()
});
export type HostProviderShape = z.infer<typeof HostProviderShapeSchema>;

/* What the machine asks a provider, by the name it crosses to the extension's process under. */
export const HOST_PROVIDER_METHODS = [
    'match',
    'status',
    'issues.list',
    'issues.read',
    'issues.parse',
    'changes.list',
    'changes.read',
    'changes.forBranch',
    'checks.log'
] as const;
export type HostProviderMethod = (typeof HOST_PROVIDER_METHODS)[number];

// Control characters but tab and line feed, which a host's text has no use for and a terminal or a prompt may act on.
// oxlint-disable-next-line no-control-regex -- a control character in a stranger's text is what this takes out.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
// oxlint-disable-next-line no-control-regex -- a line of a stranger's text is one line, whatever was put in it.
const LINE_BREAKS = /[\s\u0000-\u001f\u007f]+/g;

function cut(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) : text;
}

const text = (max: number) => z.string().transform((value) => cut(value.replace(CONTROL, ''), max));
const line = (max: number) => z.string().transform((value) => cut(value.replace(LINE_BREAKS, ' ').trim(), max));
const named = (max: number) => line(max).refine((value) => value !== '', 'is empty');
const list = <Item extends z.ZodType>(item: Item, max: number) => z.array(z.unknown()).transform((entries) => kept(entries.slice(0, max), item));
const locator = z.string().min(1).max(HOST_LIMITS.locator);

function kept<Item extends z.ZodType>(entries: readonly unknown[], item: Item): z.infer<Item>[] {
    return entries.flatMap((entry) => {
        const parsed = item.safeParse(entry);

        return parsed.success ? [parsed.data] : [];
    });
}

/* An address a person opens in a browser, or nothing: a host's text never names another scheme to Ruimte. */
const page = z
    .string()
    .max(HOST_LIMITS.url)
    .optional()
    .transform((value) => {
        try {
            return value !== undefined && ['https:', 'http:'].includes(new URL(value).protocol) ? value : undefined;
        } catch {
            return undefined;
        }
    });

const time = z
    .string()
    .max(40)
    .optional()
    .transform((value) => (value === undefined || Number.isNaN(Date.parse(value)) ? undefined : value));

const count = z.number().int().nonnegative();

const ProvidedChangeSummary = z.object({
    id: locator,
    title: named(HOST_LIMITS.title),
    state: z.enum(['open', 'closed', 'merged']),
    stateLabel: line(HOST_LIMITS.name).optional(),
    draft: z.boolean().optional(),
    url: page,
    author: line(HOST_LIMITS.name).optional(),
    branch: line(HOST_LIMITS.title).optional(),
    base: line(HOST_LIMITS.title).optional(),
    updatedAt: time,
    checkState: z.unknown().optional()
});

const ProvidedIssueSummary = z.object({
    id: locator,
    title: named(HOST_LIMITS.title),
    state: z.enum(['open', 'closed']),
    stateLabel: line(HOST_LIMITS.name).optional(),
    url: page,
    author: line(HOST_LIMITS.name).optional(),
    assignees: list(named(HOST_LIMITS.name), HOST_LIMITS.assignees).optional(),
    labels: list(named(HOST_LIMITS.label), HOST_LIMITS.labels).optional(),
    updatedAt: time,
    commentCount: count.optional()
});

const ProvidedComment = z.object({
    id: locator,
    author: line(HOST_LIMITS.name),
    body: text(HOST_LIMITS.body),
    createdAt: time
});

const ProvidedIssue = ProvidedIssueSummary.extend({
    body: text(HOST_LIMITS.body),
    // The newest are kept, since a long thread is read from its end.
    comments: z
        .array(z.unknown())
        .transform((entries) => kept(entries.slice(-HOST_LIMITS.comments), ProvidedComment))
        .optional(),
    changes: list(ProvidedChangeSummary, HOST_LIMITS.linked).optional()
});

const ProvidedCheck = z.object({
    name: named(HOST_LIMITS.title),
    state: z.unknown(),
    url: page,
    summary: line(HOST_LIMITS.title).optional()
});

const ProvidedThread = z.object({
    id: locator,
    author: line(HOST_LIMITS.name),
    body: text(HOST_LIMITS.body),
    path: line(HOST_LIMITS.path).optional(),
    line: z.number().int().positive().optional()
});

const ProvidedChange = ProvidedChangeSummary.extend({
    body: text(HOST_LIMITS.body),
    headSha: named(HOST_LIMITS.sha),
    checks: list(ProvidedCheck, HOST_LIMITS.checks).optional(),
    threads: list(ProvidedThread, HOST_LIMITS.threads).optional(),
    size: z.object({ additions: count, deletions: count, files: count }).optional(),
    closes: list(locator, HOST_LIMITS.linked).optional()
});

const ProvidedPage = z.object({ items: z.array(z.unknown()), cursor: z.string().min(1).max(HOST_LIMITS.cursor).optional() });

const ProvidedStatus = z.object({
    state: z.enum(['ready', 'signed-out', 'unreachable', 'not-configured']),
    reason: line(HOST_LIMITS.reason).optional(),
    account: line(HOST_LIMITS.name).optional()
});
export type ProvidedHostStatus = z.infer<typeof ProvidedStatus>;

const ProvidedLog = z.object({ text: z.string() });

/* Leaves out the keys a provider gave no value for, so a shape of the wire has no key that holds undefined. */
function present<Shape extends object>(shape: Shape): Shape {
    return Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined)) as Shape;
}

function why(error: z.ZodError): string {
    const issue = error.issues[0];

    return `${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`.trim();
}

function changeSummaryOf(provider: string, change: z.infer<typeof ProvidedChangeSummary>): HostChangeSummary {
    const { id, checkState, ...rest } = change;

    return present({ ref: hostRef(provider, id), ...rest, checkState: checkState === undefined ? undefined : hostCheckState(checkState) });
}

function issueSummaryOf(provider: string, issue: z.infer<typeof ProvidedIssueSummary>): HostIssueSummary {
    const { id, assignees, labels, ...rest } = issue;

    return present({ ref: hostRef(provider, id), ...rest, assignees: assignees ?? [], labels: labels ?? [] });
}

/*
 * What a provider said of itself for a project. An answer of another shape reads as unreachable, with that as the
 * reason, so a provider that broke shows as one a person can ask its author about rather than as none.
 */
export function providedHostStatus(answer: unknown): ProvidedHostStatus {
    const parsed = ProvidedStatus.safeParse(answer);

    return parsed.success ? present(parsed.data) : { state: 'unreachable', reason: 'It gave no answer Ruimte can read.' };
}

interface ProvidedItems<Item> {
    items: Item[];
    cursor?: string;
}

function pageOf<Schema extends z.ZodType, Item>(
    answer: unknown,
    schema: Schema,
    what: string,
    read: (item: z.infer<Schema>) => Item,
    refused: (reason: string) => void
): ProvidedItems<Item> {
    const listed = ProvidedPage.safeParse(answer);

    if (!listed.success) {
        throw new Error(`It listed no ${what}s: ${why(listed.error)}`);
    }

    const items = listed.data.items.slice(0, HOST_LIMITS.page).flatMap((entry) => {
        const parsed = schema.safeParse(entry);

        if (!parsed.success) {
            refused(`listed ${what === 'issue' ? 'an' : 'a'} ${what} that is none: ${why(parsed.error)}`);

            return [];
        }

        return [read(parsed.data)];
    });

    return present({ items, cursor: listed.data.cursor });
}

/* A page of issues as a provider listed it: at most `HOST_LIMITS.page`, and none that is no issue, each of which `refused` hears the reason of. */
export function providedIssuePage(provider: string, answer: unknown, refused: (reason: string) => void): ProvidedItems<HostIssueSummary> {
    return pageOf(answer, ProvidedIssueSummary, 'issue', (issue) => issueSummaryOf(provider, issue), refused);
}

export function providedChangePage(provider: string, answer: unknown, refused: (reason: string) => void): ProvidedItems<HostChangeSummary> {
    return pageOf(answer, ProvidedChangeSummary, 'change', (change) => changeSummaryOf(provider, change), refused);
}

/* One issue as a provider read it, or null for one the host does not have. Throws for an answer that is no issue. */
export function providedIssue(provider: string, answer: unknown): HostIssue | null {
    if (answer === null || answer === undefined) {
        return null;
    }

    const parsed = ProvidedIssue.safeParse(answer);

    if (!parsed.success) {
        throw new Error(`It answered an issue that is none: ${why(parsed.error)}`);
    }

    const { body, comments, changes, ...summary } = parsed.data;

    return {
        ...issueSummaryOf(provider, summary),
        body,
        comments: (comments ?? []).map(present),
        changes: (changes ?? []).map((change) => changeSummaryOf(provider, change))
    };
}

/* One change as a provider read it, with its checks reduced to the five states and rolled up into one. */
export function providedChange(provider: string, answer: unknown): HostChange | null {
    if (answer === null || answer === undefined) {
        return null;
    }

    const parsed = ProvidedChange.safeParse(answer);

    if (!parsed.success) {
        throw new Error(`It answered a change that is none: ${why(parsed.error)}`);
    }

    const { body, headSha, checks, threads, size, closes, ...summary } = parsed.data;
    const reduced = (checks ?? []).map((check) => present({ ...check, state: hostCheckState(check.state) }));

    return present({
        ...changeSummaryOf(provider, summary),
        // What the provider read counts, never the one state it summed them up as.
        checkState: hostChecksState(reduced),
        body,
        headSha,
        checks: reduced,
        threads: (threads ?? []).map(present),
        size: size ?? { additions: 0, deletions: 0, files: 0 },
        closes: (closes ?? []).map((issue) => hostRef(provider, issue))
    });
}

/* The locator a provider answered, for `issues.parse` and `changes.forBranch`; null for none and for anything that is no locator. */
export function providedLocator(answer: unknown): string | null {
    const parsed = locator.safeParse(answer);

    return parsed.success ? parsed.data : null;
}

/* The end of a check's log, since that is where a failure says why; null for a check the provider has no log of. */
export function providedCheckLog(answer: unknown): HostCheckLogResult | null {
    if (answer === null || answer === undefined) {
        return null;
    }

    const parsed = ProvidedLog.safeParse(answer);

    if (!parsed.success) {
        throw new Error(`It answered a log that is none: ${why(parsed.error)}`);
    }

    const log = parsed.data.text.replace(CONTROL, '');

    return { text: log.slice(-HOST_LIMITS.log), truncated: log.length > HOST_LIMITS.log };
}
