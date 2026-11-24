import { z } from 'zod';

/*
 * The `host` area: the issues, changes and checks of a project as a code host or an issue tracker has them, in shapes
 * that belong to no host. A provider of an extension answers them (`extension-hosts.ts`), and nothing here names what
 * one host calls a state or a conclusion. Imports zod alone, so the test runtime of an extension carries it.
 */

// The same ids a manifest lists under `provides` (`ExtensionProvidedIdSchema`), which never hold a colon.
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* What one answer of a host may hold. A provider's answer is cut to these, never refused for being long. */
export const HOST_LIMITS = {
    locator: 300,
    title: 300,
    name: 120,
    label: 80,
    labels: 30,
    assignees: 30,
    body: 60_000,
    comments: 100,
    checks: 100,
    threads: 100,
    linked: 30,
    page: 100,
    reason: 300,
    url: 2048,
    cursor: 500,
    query: 300,
    sha: 64,
    path: 1024,
    // The tail of a check's log, which is what says why it failed.
    log: 64_000
} as const;

/* An issue or a change by one name everywhere: `<provider>:<locator>`, where the provider owns what the locator says. */
export const HostRefSchema = z
    .string()
    .max(HOST_LIMITS.locator + 65)
    .regex(/^[a-z0-9][a-z0-9-]{0,63}:[\s\S]+$/);
export type HostRef = z.infer<typeof HostRefSchema>;

export function hostRef(provider: string, locator: string): HostRef {
    return `${provider}:${locator}`;
}

/* The provider and the locator of a ref, or null for text that is none. The locator may hold a colon itself. */
export function parseHostRef(ref: string): { provider: string; locator: string } | null {
    const colon = ref.indexOf(':');
    const provider = ref.slice(0, colon);
    const locator = ref.slice(colon + 1);

    return colon > 0 && PROVIDER_ID.test(provider) && locator !== '' && locator.length <= HOST_LIMITS.locator ? { provider, locator } : null;
}

export const HostIssueStateSchema = z.enum(['open', 'closed']);
export type HostIssueState = z.infer<typeof HostIssueStateSchema>;

export const HostChangeStateSchema = z.enum(['open', 'closed', 'merged']);
export type HostChangeState = z.infer<typeof HostChangeStateSchema>;

export const HOST_CHECK_STATES = ['pending', 'success', 'failure', 'neutral', 'skipped'] as const;
export const HostCheckStateSchema = z.enum(HOST_CHECK_STATES);
export type HostCheckState = z.infer<typeof HostCheckStateSchema>;

/* The state a provider gave, or `failure` for a word Ruimte does not know: an unknown conclusion never reads as green. */
export function hostCheckState(state: unknown): HostCheckState {
    return HOST_CHECK_STATES.find((known) => known === state) ?? 'failure';
}

/* The checks of a change as one state: failed once one failed, still pending while one runs, and none without checks. */
export function hostChecksState(checks: readonly { state: HostCheckState }[]): HostCheckState | undefined {
    const has = (state: HostCheckState): boolean => checks.some((check) => check.state === state);

    return (['failure', 'pending', 'success', 'neutral', 'skipped'] as const).find(has);
}

const line = (max: number) => z.string().max(max);
// An ISO 8601 time, as the host gave it.
const time = z.string().max(40);

export const HostChangeSummarySchema = z.object({
    ref: HostRefSchema,
    title: line(HOST_LIMITS.title),
    state: HostChangeStateSchema,
    // The host's own word for the state, for display.
    stateLabel: line(HOST_LIMITS.name).optional(),
    draft: z.boolean().optional(),
    url: z.string().max(HOST_LIMITS.url).optional(),
    author: line(HOST_LIMITS.name).optional(),
    // The branch it comes from, and the one it goes into.
    branch: line(HOST_LIMITS.title).optional(),
    base: line(HOST_LIMITS.title).optional(),
    updatedAt: time.optional(),
    // Its checks as one state; absent for a change without checks, or a list that did not read them.
    checkState: HostCheckStateSchema.optional()
});
export type HostChangeSummary = z.infer<typeof HostChangeSummarySchema>;

export const HostIssueSummarySchema = z.object({
    ref: HostRefSchema,
    title: line(HOST_LIMITS.title),
    state: HostIssueStateSchema,
    stateLabel: line(HOST_LIMITS.name).optional(),
    url: z.string().max(HOST_LIMITS.url).optional(),
    author: line(HOST_LIMITS.name).optional(),
    assignees: z.array(line(HOST_LIMITS.name)).max(HOST_LIMITS.assignees),
    labels: z.array(line(HOST_LIMITS.label)).max(HOST_LIMITS.labels),
    updatedAt: time.optional(),
    commentCount: z.number().int().nonnegative().optional()
});
export type HostIssueSummary = z.infer<typeof HostIssueSummarySchema>;

export const HostCommentSchema = z.object({
    id: line(HOST_LIMITS.locator),
    author: line(HOST_LIMITS.name),
    body: z.string().max(HOST_LIMITS.body),
    createdAt: time.optional()
});
export type HostComment = z.infer<typeof HostCommentSchema>;

export const HostIssueSchema = HostIssueSummarySchema.extend({
    body: z.string().max(HOST_LIMITS.body),
    // The newest ones when the host has more than Ruimte holds of one issue.
    comments: z.array(HostCommentSchema).max(HOST_LIMITS.comments),
    // The changes the host links to it.
    changes: z.array(HostChangeSummarySchema).max(HOST_LIMITS.linked)
});
export type HostIssue = z.infer<typeof HostIssueSchema>;

export const HostCheckSchema = z.object({
    // What `host.checkLog` and `ci_logs` name it by.
    name: line(HOST_LIMITS.title),
    state: HostCheckStateSchema,
    url: z.string().max(HOST_LIMITS.url).optional(),
    summary: line(HOST_LIMITS.title).optional()
});
export type HostCheck = z.infer<typeof HostCheckSchema>;

/* A review thread nobody resolved yet, by its first comment. */
export const HostThreadSchema = z.object({
    id: line(HOST_LIMITS.locator),
    author: line(HOST_LIMITS.name),
    body: z.string().max(HOST_LIMITS.body),
    path: line(HOST_LIMITS.path).optional(),
    line: z.number().int().positive().optional()
});
export type HostThread = z.infer<typeof HostThreadSchema>;

export const HostChangeSchema = HostChangeSummarySchema.extend({
    body: z.string().max(HOST_LIMITS.body),
    // The commit its checks ran on, which a merge names so it lands what was read.
    headSha: line(HOST_LIMITS.sha),
    checks: z.array(HostCheckSchema).max(HOST_LIMITS.checks),
    threads: z.array(HostThreadSchema).max(HOST_LIMITS.threads),
    size: z.object({ additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), files: z.number().int().nonnegative() }),
    // The issues it closes once it lands.
    closes: z.array(HostRefSchema).max(HOST_LIMITS.linked)
});
export type HostChange = z.infer<typeof HostChangeSchema>;

/* Whether a provider answers for a project now, and why not in words a person reads. */
export const HostProviderStateSchema = z.enum(['ready', 'signed-out', 'unreachable']);
export type HostProviderState = z.infer<typeof HostProviderStateSchema>;

export const HostProviderStatusSchema = z.object({
    provider: z.string().regex(PROVIDER_ID),
    // The extension that supplies it.
    extension: z.string().min(1),
    title: line(HOST_LIMITS.name),
    // A code host was found from a checkout's remote, a tracker said itself that it has this project's issues.
    kind: z.enum(['code-host', 'tracker']),
    // A code host only: the remote it matched, and that repository as the git panel names it.
    remote: z.string().max(HOST_LIMITS.url).optional(),
    repo: z.string().optional(),
    issues: z.boolean(),
    changes: z.boolean(),
    checks: z.boolean(),
    state: HostProviderStateSchema,
    reason: line(HOST_LIMITS.reason).optional(),
    // Whose account it reads with, as the host names them.
    account: line(HOST_LIMITS.name).optional()
});
export type HostProviderStatus = z.infer<typeof HostProviderStatusSchema>;

/* A chat that works on an issue. The title and state are as read when it was linked; nothing syncs them. */
export const HostLinkSchema = z.object({
    chatId: z.string().min(1),
    ref: HostRefSchema,
    title: line(HOST_LIMITS.title),
    state: HostIssueStateSchema,
    stateLabel: line(HOST_LIMITS.name).optional(),
    url: z.string().max(HOST_LIMITS.url).optional(),
    linkedAt: z.number(),
    // A person linked it, an agent did for its own chat, or the change of the chat's branch closes the issue.
    by: z.enum(['person', 'agent', 'change'])
});
export type HostLink = z.infer<typeof HostLinkSchema>;

const projectId = z.string().min(1);
const provider = z.string().regex(PROVIDER_ID);
const cursor = z.string().max(HOST_LIMITS.cursor);
const Nothing = z.object({});

/* Which provider of the project a list asks: its id, and the remote for a code host of more than one repository. */
const ListScope = { projectId, provider, remote: z.string().max(HOST_LIMITS.url).optional() };

export const HostStatusPayloadSchema = z.object({ projectId });
export const HostStatusResultSchema = z.object({ providers: z.array(HostProviderStatusSchema) });
export type HostStatusResult = z.infer<typeof HostStatusResultSchema>;

export const HostIssuesPayloadSchema = z.object({
    ...ListScope,
    // Only what is assigned to the account the provider reads with.
    assigned: z.boolean().optional(),
    // Absent is `open`.
    state: z.enum(['open', 'closed', 'all']).optional(),
    query: z.string().max(HOST_LIMITS.query).optional(),
    cursor: cursor.optional()
});
export type HostIssuesPayload = z.infer<typeof HostIssuesPayloadSchema>;

// `cursor` is there while the host has more, and asks for the next page.
export const HostIssuesResultSchema = z.object({ issues: z.array(HostIssueSummarySchema).max(HOST_LIMITS.page), cursor: cursor.optional() });
export type HostIssuesResult = z.infer<typeof HostIssuesResultSchema>;

export const HostIssuePayloadSchema = z.object({ projectId, ref: HostRefSchema });
export const HostIssueResultSchema = z.object({ issue: HostIssueSchema });

export const HostChangesPayloadSchema = z.object({
    ...ListScope,
    state: z.enum(['open', 'closed', 'merged', 'all']).optional(),
    query: z.string().max(HOST_LIMITS.query).optional(),
    cursor: cursor.optional()
});
export type HostChangesPayload = z.infer<typeof HostChangesPayloadSchema>;

export const HostChangesResultSchema = z.object({ changes: z.array(HostChangeSummarySchema).max(HOST_LIMITS.page), cursor: cursor.optional() });
export type HostChangesResult = z.infer<typeof HostChangesResultSchema>;

// A change by its ref, or the change of the branch of the folder a chat works in. Null for a chat whose branch has none.
export const HostChangePayloadSchema = z.object({ projectId, ref: HostRefSchema.optional(), chatId: z.string().min(1).optional() });
export const HostChangeResultSchema = z.object({ change: HostChangeSchema.nullable() });

export const HostCheckLogPayloadSchema = z.object({ projectId, ref: HostRefSchema, check: z.string().min(1).max(HOST_LIMITS.title) });
// The end of the log; `truncated` says the start was left out.
export const HostCheckLogResultSchema = z.object({ text: z.string().max(HOST_LIMITS.log), truncated: z.boolean() });
export type HostCheckLogResult = z.infer<typeof HostCheckLogResultSchema>;

// A client that shows a project's issues, or one issue or change of it, hears `host.changed` until it unwatches or goes.
export const HostWatchPayloadSchema = z.object({ projectId, ref: HostRefSchema.optional() });

// One of the three, the narrowest first: the issues of a chat, the chats of an issue, or every link of a project's chats.
export const HostLinksPayloadSchema = z.object({ chatId: z.string().min(1).optional(), ref: HostRefSchema.optional(), projectId: projectId.optional() });
export const HostLinksResultSchema = z.object({ links: z.array(HostLinkSchema) });
export type HostLinksResult = z.infer<typeof HostLinksResultSchema>;

export const HostLinkPayloadSchema = z.object({ projectId, chatId: z.string().min(1), ref: HostRefSchema });
export const HostLinkResultSchema = z.object({ link: HostLinkSchema });

export const HostUnlinkPayloadSchema = z.object({ chatId: z.string().min(1), ref: HostRefSchema });
export const HostUnlinkResultSchema = z.object({ removed: z.boolean() });

// What a chat a person starts on an issue opens with: the issue quoted as data, and a branch named after its ref.
export const HostIssuePromptResultSchema = z.object({ prompt: z.string(), title: line(HOST_LIMITS.title), branch: z.string() });
export type HostIssuePromptResult = z.infer<typeof HostIssuePromptResultSchema>;

export const HOST_REQUEST_SCHEMAS = {
    'host.status': { payload: HostStatusPayloadSchema, result: HostStatusResultSchema },
    'host.issues': { payload: HostIssuesPayloadSchema, result: HostIssuesResultSchema },
    'host.issue': { payload: HostIssuePayloadSchema, result: HostIssueResultSchema },
    'host.issuePrompt': { payload: HostIssuePayloadSchema, result: HostIssuePromptResultSchema },
    'host.changes': { payload: HostChangesPayloadSchema, result: HostChangesResultSchema },
    'host.change': { payload: HostChangePayloadSchema, result: HostChangeResultSchema },
    'host.checkLog': { payload: HostCheckLogPayloadSchema, result: HostCheckLogResultSchema },
    'host.watch': { payload: HostWatchPayloadSchema, result: Nothing },
    'host.unwatch': { payload: HostWatchPayloadSchema, result: Nothing },
    'host.links': { payload: HostLinksPayloadSchema, result: HostLinksResultSchema },
    'host.link': { payload: HostLinkPayloadSchema, result: HostLinkResultSchema },
    'host.unlink': { payload: HostUnlinkPayloadSchema, result: HostUnlinkResultSchema }
} as const;

export const HOST_EVENT_SCHEMAS = {
    // To a client that watches: read again. Without a ref the providers of the project changed, with one that issue or change did.
    'host.changed': z.object({ projectId, ref: HostRefSchema.optional() }),
    // To every client: the links of this chat are no longer what they were.
    'host.linksChanged': z.object({ chatId: z.string().min(1) })
} as const;
