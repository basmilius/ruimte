import { z } from 'zod';
import { AgentKindSchema, AgentStatusSchema, SuggestedTitleSchema } from './agent.ts';
import { WorktreeSchema } from './git.ts';
import { ModelSelectionSchema, RuntimeModeSchema } from './model.ts';

// The client picks the id (its node id), like a terminal session.
export const ChatIdSchema = z.string().min(1);
export type ChatId = z.infer<typeof ChatIdSchema>;

// The daemon's estimate of what `contextTokens` is made of, scaled to add up to it; `system` is whatever the thread cannot account for.
export const ChatContextBreakdownSchema = z.object({
    toolOutput: z.number().int().nonnegative(),
    filesRead: z.number().int().nonnegative(),
    conversation: z.number().int().nonnegative(),
    system: z.number().int().nonnegative()
});
export type ChatContextBreakdown = z.infer<typeof ChatContextBreakdownSchema>;

export const ChatUsageSchema = z.object({
    // Tokens the last request carried, which is what the model saw as its context.
    contextTokens: z.number().int().nonnegative(),
    contextWindow: z.number().int().positive().nullable(),
    costUsd: z.number().nonnegative(),
    turns: z.number().int().nonnegative(),
    // Absent while nothing is in the context yet, and from a daemon that does not estimate.
    breakdown: ChatContextBreakdownSchema.optional()
});
export type ChatUsage = z.infer<typeof ChatUsageSchema>;

// Base64 for 10 MiB leaves room for the prompt and envelope inside the 16 MiB transport frame.
export const CHAT_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_BYTES = CHAT_ATTACHMENTS_MAX_BYTES;
export const CHAT_ATTACHMENTS_MAX_COUNT = 8;
const MAX_BASE64_LENGTH = Math.ceil(CHAT_ATTACHMENT_MAX_BYTES / 3) * 4;

export const attachmentBytes = (data: string): number => Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

const isBase64 = (data: string): boolean => {
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return data.length % 4 === 0 && !/[^A-Za-z0-9+/]/.test(data.slice(0, data.length - padding));
};

const IMAGE_MIME_BY_EXTENSION = new Map([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif']
]);
const IMAGE_MIME_TYPES = new Set(IMAGE_MIME_BY_EXTENSION.values());

// A generic MIME type from Finder may still name a picture; a declared PDF must stay a PDF.
export const attachmentImageMime = ({ name, mime }: { name: string; mime: string }): string | null => {
    const type = mime.split(';')[0]!.trim().toLowerCase();
    if (IMAGE_MIME_TYPES.has(type)) {
        return type;
    }
    if (type !== '' && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
        return null;
    }
    const dot = name.lastIndexOf('.');
    return dot < 0 ? null : (IMAGE_MIME_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null);
};

// What the composer hands the daemon: the bytes, plus what the file is called and what it is.
export const ChatAttachmentUploadSchema = z.object({
    name: z.string().min(1).max(255),
    mime: z.string().min(1).max(255),
    // Base64 without a data-URL prefix.
    data: z
        .string()
        .min(1)
        .max(MAX_BASE64_LENGTH)
        .refine(isBase64, { message: 'Invalid attachment base64' })
        .refine((data) => attachmentBytes(data) <= CHAT_ATTACHMENT_MAX_BYTES, { message: 'Attachment exceeds 10 MiB' })
});
export type ChatAttachmentUpload = z.infer<typeof ChatAttachmentUploadSchema>;

export const ChatAttachmentUploadsSchema = z
    .array(ChatAttachmentUploadSchema)
    .max(CHAT_ATTACHMENTS_MAX_COUNT)
    .refine((uploads) => uploads.reduce((bytes, upload) => bytes + attachmentBytes(upload.data), 0) <= CHAT_ATTACHMENTS_MAX_BYTES, {
        message: 'Attachments must total at most 10 MiB per message'
    });

// What the thread keeps. The bytes live under `$RUIMTE_HOME/attachments/<chatId>`, so a thread with
// a video in it is still a small JSON file.
export const ChatAttachmentSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    mime: z.string(),
    size: z.number().int().nonnegative(),
    // Absolute, on the machine the daemon runs on.
    path: z.string()
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

// A message typed while a turn was running; the daemon sends it when that turn settles.
export const ChatQueuedMessageSchema = z.object({
    id: z.string().min(1),
    // Older saved queues have no reserved turn yet; draining them still mints one.
    turnId: z.string().min(1).optional(),
    text: z.string(),
    mentions: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    attachments: z.array(ChatAttachmentSchema).optional(),
    createdAt: z.number()
});
export type ChatQueuedMessage = z.infer<typeof ChatQueuedMessageSchema>;

// A command or a monitor the CLI keeps running beside its turns, until it ends or its process does.
export const ChatBackgroundTaskSchema = z.object({
    // The CLI's own id for the task, which is what stopping it names.
    id: z.string().min(1),
    kind: z.enum(['shell', 'monitor']),
    description: z.string(),
    command: z.string().nullable(),
    startedAt: z.number()
});
export type ChatBackgroundTask = z.infer<typeof ChatBackgroundTaskSchema>;

export const ChatInfoSchema = z.object({
    chatId: ChatIdSchema,
    provider: AgentKindSchema,
    cwd: z.string(),
    // Set once the CLI announced itself; what a terminal node needs for `--resume`.
    agentSessionId: z.string().nullable(),
    // The model the CLI reported, which can differ from the selection (aliases, reroutes).
    model: z.string().nullable(),
    selection: ModelSelectionSchema,
    runtimeMode: RuntimeModeSchema,
    status: AgentStatusSchema,
    // Whether the CLI process is alive right now. A dead one is started again with `--resume` on the next send.
    running: z.boolean(),
    // The turn in flight, if any; items carry the same id so the client can fold work per turn.
    activeTurnId: z.string().nullable(),
    slashCommands: z.array(z.string()),
    // What the CLI's own init frame says it will run; empty until the first message named them.
    skills: z.array(z.string()).optional(),
    // Messages typed while a turn ran, in the order they go out once it settles.
    queue: z.array(ChatQueuedMessageSchema).optional(),
    background: z.array(ChatBackgroundTaskSchema).optional(),
    usage: ChatUsageSchema,
    // The name the CLI gave the session, when it gives one; a node that nobody named takes it.
    suggestedTitle: SuggestedTitleSchema.optional(),
    // The chat this one was forked from and the turn it continues after; absent on a chat nobody forked.
    forkOf: z.object({ chatId: ChatIdSchema, turnId: z.string().min(1), at: z.number() }).optional(),
    createdAt: z.number()
});
export type ChatInfo = z.infer<typeof ChatInfoSchema>;

// Where a skill was found: the person's own folder, the chat's folder, or a plugin.
export const ChatSkillSourceSchema = z.enum(['user', 'project', 'plugin']);
export type ChatSkillSource = z.infer<typeof ChatSkillSourceSchema>;

export const ChatSkillSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    source: ChatSkillSourceSchema
});
export type ChatSkill = z.infer<typeof ChatSkillSchema>;

export const SkillsListPayloadSchema = z.object({ chatId: ChatIdSchema });
export type SkillsListPayload = z.infer<typeof SkillsListPayloadSchema>;

export const SkillsListResultSchema = z.object({ skills: z.array(ChatSkillSchema) });
export type SkillsListResult = z.infer<typeof SkillsListResultSchema>;

const base = {
    id: z.string().min(1),
    createdAt: z.number(),
    turnId: z.string().nullable()
};

export const ChatUserItemSchema = z.object({
    ...base,
    kind: z.literal('user'),
    text: z.string(),
    // Files the person picked with `@`; the paths also sit in the text, this is what the row highlights.
    mentions: z.array(z.string()).optional(),
    // Skills the person picked with `$`; the names also sit in the text, this is what the row chips.
    skills: z.array(z.string()).optional(),
    attachments: z.array(ChatAttachmentSchema).optional()
});

export const ChatAssistantItemSchema = z.object({
    ...base,
    kind: z.literal('assistant'),
    text: z.string(),
    streaming: z.boolean(),
    // Set for text a subagent wrote, with the id of the Agent call that spawned it.
    parentToolUseId: z.string().nullable().optional()
});

// One stretch of the model thinking out loud before it answers: Claude's thinking blocks, Codex's
// reasoning summaries. Consecutive blocks are one item, so the timeline has one row per stretch.
export const ChatThinkingItemSchema = z.object({
    ...base,
    kind: z.literal('thinking'),
    text: z.string(),
    streaming: z.boolean(),
    // When the stretch ended, so the row can say how long it took; null while it is still running.
    endedAt: z.number().nullable()
});

export const ChatToolStateSchema = z.enum(['running', 'done', 'error']);
export type ChatToolState = z.infer<typeof ChatToolStateSchema>;

// What is known about a tool call while it runs; absent until the CLI reports something.
export const ChatToolProgressSchema = z.object({
    // Derived from the CLI's `elapsed_time_seconds`, so the client can count on from here; null when only the description came.
    startedAt: z.number().nullable(),
    // What the CLI says the call is doing (Claude Code's `task_started` frame), when it said so.
    description: z.string().nullable(),
    // Output seen so far, for a provider that streams it; the tool's `output` replaces it when the call settles.
    output: z.string().nullable()
});
export type ChatToolProgress = z.infer<typeof ChatToolProgressSchema>;

// One file a tool call changed, as the CLI reports it; `diff` is unified text for a provider that
// gives one and empty for a provider whose edits only carry the text before and after.
export const ChatFileChangeSchema = z.object({
    path: z.string(),
    kind: z.enum(['add', 'update', 'delete']),
    diff: z.string()
});
export type ChatFileChange = z.infer<typeof ChatFileChangeSchema>;

export const ChatToolItemSchema = z.object({
    ...base,
    kind: z.literal('tool'),
    toolUseId: z.string(),
    name: z.string(),
    input: z.unknown(),
    output: z.string().nullable(),
    state: ChatToolStateSchema,
    // Set for a tool call made by a subagent, with the id of the Task call that spawned it.
    parentToolUseId: z.string().nullable(),
    progress: ChatToolProgressSchema.optional(),
    changes: z.array(ChatFileChangeSchema).optional()
});

export const ChatSubagentStatusSchema = z.enum(['running', 'done', 'failed']);
export type ChatSubagentStatus = z.infer<typeof ChatSubagentStatusSchema>;

export const ChatSubagentUsageSchema = z.object({
    totalTokens: z.number().int().nonnegative(),
    toolUses: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative()
});
export type ChatSubagentUsage = z.infer<typeof ChatSubagentUsageSchema>;

/*
 * One agent the agent delegated to, foreground or background. Its own work stays in the thread as
 * ordinary items that carry `parentToolUseId`, so streaming keeps working; the timeline gathers
 * them under this row. `result` is the report it ended with, as markdown.
 */
export const ChatSubagentItemSchema = z.object({
    ...base,
    kind: z.literal('subagent'),
    // The id of the Agent call that spawned it, which is what every later frame about it names.
    toolUseId: z.string(),
    description: z.string(),
    subagentType: z.string().nullable(),
    prompt: z.string().nullable(),
    // Whether it runs beside the turn instead of blocking it, so the turn can end before it does.
    background: z.boolean(),
    status: ChatSubagentStatusSchema,
    startedAt: z.number(),
    finishedAt: z.number().nullable(),
    // What the CLI says it is doing while it runs, and what it says came of it once it settled.
    summary: z.string().nullable(),
    result: z.string().nullable(),
    usage: ChatSubagentUsageSchema.nullable(),
    // The tool it reached for last, for the line while it is still running.
    lastTool: z.string().nullable(),
    // The CLI's own transcript of the run, when it wrote one.
    outputFile: z.string().optional(),
    // Set when it did more than the thread keeps; what is there is the beginning of its work.
    itemsTruncated: z.boolean(),
    // Where the CLI keeps this subagent's own conversation; set once the daemon found it.
    native: z.object({ agentId: z.string().optional(), threadId: z.string().optional() }).optional(),
    // Who opened it: the CLI with its own tool, or a verb with `--task` that made a node; absent is `native`.
    origin: z.enum(['native', 'ruimte']).optional(),
    // The node a `--task` opened, whose own conversation this row stands for.
    childId: z.string().optional()
});

export const ChatApprovalDecisionSchema = z.enum(['pending', 'allow', 'allow-always', 'deny', 'cancelled']);
export type ChatApprovalDecision = z.infer<typeof ChatApprovalDecisionSchema>;

export const ChatApprovalItemSchema = z.object({
    ...base,
    kind: z.literal('approval'),
    requestId: z.string(),
    toolUseId: z.string().nullable(),
    toolName: z.string(),
    input: z.unknown(),
    description: z.string().nullable(),
    // Whether the CLI offered a rule that would let this pass next time.
    canAllowAlways: z.boolean(),
    allowAlways: z.object({ label: z.string(), description: z.string() }).optional(),
    decision: ChatApprovalDecisionSchema
});

export const ChatQuestionSchema = z.object({
    id: z.string(),
    header: z.string(),
    question: z.string(),
    choices: z.array(z.object({ label: z.string(), description: z.string() })),
    multiSelect: z.boolean()
});
export type ChatQuestion = z.infer<typeof ChatQuestionSchema>;

export const ChatQuestionItemSchema = z.object({
    ...base,
    kind: z.literal('question'),
    requestId: z.string(),
    questions: z.array(ChatQuestionSchema).min(1),
    // Set when the CLI goes on while it waits, which is the only kind that may be dismissed.
    async: z.boolean().optional(),
    // Keyed by question id; null while the person has not answered.
    answers: z.record(z.string(), z.string()).nullable(),
    state: z.enum(['pending', 'answered', 'cancelled', 'dismissed'])
});

// One file of a turn's checkpoint diff: the working tree against the tree the turn started from.
export const ChatCheckpointFileSchema = z.object({
    path: z.string(),
    kind: z.enum(['add', 'update', 'delete']),
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    // The unified diff of this file; empty when `omitted` says why there is none.
    diff: z.string(),
    omitted: z.enum(['binary', 'too-large']).optional()
});
export type ChatCheckpointFile = z.infer<typeof ChatCheckpointFileSchema>;

export const ChatCheckpointDiffSchema = z.object({
    files: z.array(ChatCheckpointFileSchema),
    // Set when more files changed than the list carries.
    truncated: z.boolean()
});
export type ChatCheckpointDiff = z.infer<typeof ChatCheckpointDiffSchema>;

export const ChatTurnItemSchema = z.object({
    ...base,
    kind: z.literal('turn'),
    state: z.enum(['running', 'done', 'aborted', 'error']),
    // Who started the turn. Absent means the person did, which is what every turn written before this field was.
    origin: z.enum(['user', 'agent']).optional(),
    // What the CLI woke up about (the summary of a background task that settled); only an agent turn has one.
    label: z.string().optional(),
    // The Agent call the CLI woke up about, so the header can point at the subagent row it belongs to.
    taskToolUseId: z.string().optional(),
    endedAt: z.number().nullable(),
    costUsd: z.number().nonnegative(),
    // The git tree of the chat's folder when the turn started; absent outside a repository.
    checkpoint: z.string().optional(),
    // What the working tree holds against that checkpoint, taken when the turn settled.
    checkpointDiff: ChatCheckpointDiffSchema.optional(),
    // How many CLI processes worked on this turn; absent is one, which is every turn before this field.
    attempt: z.number().int().positive().optional(),
    // The tasks whose results woke the chat for this turn; only a turn the daemon opened carries them.
    taskIds: z.array(z.string()).optional(),
    // The nodes whose messages woke the chat for this turn, which is where waking on a message stops: a turn with one wakes nobody.
    messageFrom: z.array(z.string()).optional(),
    // The CLI's own name for where this turn ended, which is what a fork after this turn is cut at.
    native: z.object({ turnId: z.string().optional(), lastUuid: z.string().optional() }).optional(),
    // The git tree of the chat's folder when the turn settled: what a fork after this turn starts its files from.
    checkpointAfter: z.string().optional(),
    // Set on the turn a fork writes a summary in: the chat it is for, which gets the last answer of the turn.
    summaryFor: ChatIdSchema.optional()
});

/* What a turn a restart could not take up again ends with, so a client can tell it from a turn a person stopped. */
const NOT_RESUMED_PREFIX = 'This turn could not be resumed after the machine restarted: ';

export const notResumedNote = (reason: string): string => `${NOT_RESUMED_PREFIX}${reason}`;

/* Whether the machine ended this aborted turn rather than a person: the daemon leaves its warning note in the turn. */
export const abortedByMachine = (
    turn: { id: string; state: string },
    items: readonly { kind: string; turnId: string | null; level?: string; text?: string }[]
): boolean =>
    turn.state === 'aborted' &&
    items.some((item) => item.kind === 'note' && item.turnId === turn.id && item.level === 'warning' && item.text?.startsWith(NOT_RESUMED_PREFIX) === true);

export const ChatNoteItemSchema = z.object({
    ...base,
    kind: z.literal('note'),
    level: z.enum(['info', 'warning', 'error']),
    text: z.string(),
    // The chat a delivered summary came from, so a client can offer to open it.
    from: ChatIdSchema.optional()
});

export const ChatCompactionItemSchema = z.object({
    ...base,
    kind: z.literal('compaction'),
    preTokens: z.number().int().nonnegative().nullable()
});

/*
 * Never a new member here, and never a new value in an enum a chat or a push already carries: the
 * iPhone app validates `chat.attach` and `chat.history` whole, so one item it does not know rejects
 * the entire conversation. Add optional fields instead.
 */
export const ChatItemSchema = z.discriminatedUnion('kind', [
    ChatUserItemSchema,
    ChatAssistantItemSchema,
    ChatThinkingItemSchema,
    ChatToolItemSchema,
    ChatSubagentItemSchema,
    ChatApprovalItemSchema,
    ChatQuestionItemSchema,
    ChatTurnItemSchema,
    ChatNoteItemSchema,
    ChatCompactionItemSchema
]);
export type ChatItem = z.infer<typeof ChatItemSchema>;
export type ChatUserItem = z.infer<typeof ChatUserItemSchema>;
export type ChatAssistantItem = z.infer<typeof ChatAssistantItemSchema>;
export type ChatThinkingItem = z.infer<typeof ChatThinkingItemSchema>;
export type ChatToolItem = z.infer<typeof ChatToolItemSchema>;
export type ChatSubagentItem = z.infer<typeof ChatSubagentItemSchema>;
export type ChatApprovalItem = z.infer<typeof ChatApprovalItemSchema>;
export type ChatQuestionItem = z.infer<typeof ChatQuestionItemSchema>;
export type ChatTurnItem = z.infer<typeof ChatTurnItemSchema>;
export type ChatNoteItem = z.infer<typeof ChatNoteItemSchema>;
export type ChatCompactionItem = z.infer<typeof ChatCompactionItemSchema>;

// Events apply after the `chat.attach` snapshot; item ids make upserts and streamed deltas replayable.
export const ChatEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('item'), item: ChatItemSchema, historyIndex: z.number().int().nonnegative().optional() }),
    z.object({ type: z.literal('delta'), itemId: z.string(), text: z.string() }),
    z.object({ type: z.literal('info'), info: ChatInfoSchema }),
    z.object({ type: z.literal('reset'), info: ChatInfoSchema, items: z.array(ChatItemSchema) })
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const ChatEventEnvelopeSchema = z.object({
    chatId: ChatIdSchema,
    event: ChatEventSchema,
    // The place of this event in the chat's stream, for `since` on the next attach.
    seq: z.number().int().positive().optional()
});
export type ChatEventEnvelope = z.infer<typeof ChatEventEnvelopeSchema>;

export const ChatCreatePayloadSchema = z.object({
    chatId: ChatIdSchema,
    provider: AgentKindSchema.optional(),
    cwd: z.string().optional(),
    // A CLI session to continue, for a chat opened from a terminal that ran the agent.
    resume: z.string().optional(),
    selection: ModelSelectionSchema.optional(),
    runtimeMode: RuntimeModeSchema.optional()
});
export type ChatCreatePayload = z.infer<typeof ChatCreatePayloadSchema>;

export const ChatConfigurePayloadSchema = z.object({
    chatId: ChatIdSchema,
    selection: ModelSelectionSchema.optional(),
    runtimeMode: RuntimeModeSchema.optional()
});
export type ChatConfigurePayload = z.infer<typeof ChatConfigurePayloadSchema>;

/*
 * The composer preference of this client, for a chat the daemon starts with no client mounting it.
 * One socket's answer, dropped with it. Among the clients connected the newest `changedAt` wins, so
 * a client that reconnects with an older pick does not override a fresher one made elsewhere.
 */
export const ChatPreferencesPayloadSchema = z.object({
    runtimeMode: RuntimeModeSchema.optional(),
    // The mode a terminal agent node starts in, for the terminals the daemon starts on its own.
    terminalRuntimeMode: RuntimeModeSchema.optional(),
    // Per provider, because a model slug only means something in its own CLI's catalog.
    selections: z.partialRecord(AgentKindSchema, ModelSelectionSchema).optional(),
    // When the person last changed it, in milliseconds since the epoch; absent is older than any pick.
    changedAt: z.number().nonnegative().optional()
});
export type ChatPreferencesPayload = z.infer<typeof ChatPreferencesPayloadSchema>;

export const ChatTargetPayloadSchema = z.object({ chatId: ChatIdSchema });
export type ChatTargetPayload = z.infer<typeof ChatTargetPayloadSchema>;

// Without `force` a chat in the middle of a turn is refused, so a person is asked before that turn is thrown away.
export const ChatClearPayloadSchema = ChatTargetPayloadSchema.extend({ force: z.boolean().optional() });
export type ChatClearPayload = z.infer<typeof ChatClearPayloadSchema>;

// With `subagents` the stop also ends every agent the chat opened and marks its CLI's own subagents stopped; the chat stays.
export const ChatCancelPayloadSchema = ChatTargetPayloadSchema.extend({ subagents: z.boolean().optional() });
export type ChatCancelPayload = z.infer<typeof ChatCancelPayloadSchema>;

export const ChatAttachPayloadSchema = ChatTargetPayloadSchema.extend({
    historyLimit: z.number().int().min(1).max(100).optional(),
    // The last seq this client saw; honored when the daemon still holds everything after it.
    since: z.number().int().nonnegative().optional()
});
export const ChatHistoryPayloadSchema = ChatTargetPayloadSchema.extend({
    cursor: z.string().min(1).max(128),
    limit: z.number().int().min(1).max(100).optional()
});
export const ChatHistoryPageSchema = z.object({
    start: z.number().int().nonnegative(),
    cursor: z.string().nullable()
});
export const ChatHistoryResultSchema = z.object({ items: z.array(ChatItemSchema), history: ChatHistoryPageSchema });
export type ChatHistoryResult = z.infer<typeof ChatHistoryResultSchema>;

export const ChatSubagentPayloadSchema = ChatTargetPayloadSchema.extend({
    // The call that spawned it: a row of the chat's own thread, or of a subagent's conversation.
    toolUseId: z.string().min(1).max(256),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    // True keeps this client told while the conversation grows, false lets go; absent leaves it as it was.
    watch: z.boolean().optional()
});
export type ChatSubagentPayload = z.infer<typeof ChatSubagentPayloadSchema>;

export const ChatStopSubagentPayloadSchema = ChatTargetPayloadSchema.extend({
    // A running row of the chat's own thread: a task's node is stopped, a subagent of the CLI's own only marked.
    toolUseId: z.string().min(1).max(256)
});
export type ChatStopSubagentPayload = z.infer<typeof ChatStopSubagentPayloadSchema>;

export const ChatStopTaskPayloadSchema = ChatTargetPayloadSchema.extend({ taskId: z.string().min(1).max(256) });
export type ChatStopTaskPayload = z.infer<typeof ChatStopTaskPayloadSchema>;

// `start` is the place in the conversation for a source that numbers it; a Codex thread pages by its own cursor only.
export const ChatSubagentPageSchema = z.object({
    start: z.number().int().nonnegative().optional(),
    cursor: z.string().nullable()
});

export const ChatSubagentSourceSchema = z.enum(['claude-transcript', 'codex-thread']);
export type ChatSubagentSource = z.infer<typeof ChatSubagentSourceSchema>;

export const ChatSubagentResultSchema = z.object({
    items: z.array(ChatItemSchema),
    history: ChatSubagentPageSchema,
    source: ChatSubagentSourceSchema,
    // Whether the subagent is still writing, so a client knows to keep reading.
    live: z.boolean()
});
export type ChatSubagentResult = z.infer<typeof ChatSubagentResultSchema>;

/*
 * The status of one chat, sent to every client on this machine rather than only to the ones
 * attached to it. A thread's events are only worth streaming to whoever reads them, but what a chat
 * is doing belongs to the whole project: a node waiting on a person has to say so on a view nobody
 * has open. Terminals have said this all along through `session.status`.
 */
export const ChatStatusEventSchema = z.object({ chatId: ChatIdSchema, info: ChatInfoSchema });
export type ChatStatusEvent = z.infer<typeof ChatStatusEventSchema>;

// Carries nothing of the conversation: a client that holds it asks for the newest page again.
export const ChatSubagentChangedEventSchema = z.object({ chatId: ChatIdSchema, toolUseId: z.string() });
export type ChatSubagentChangedEvent = z.infer<typeof ChatSubagentChangedEventSchema>;

export const ChatAttachResultSchema = z.object({
    info: ChatInfoSchema,
    items: z.array(ChatItemSchema),
    history: ChatHistoryPageSchema.optional(),
    pending: z.array(ChatItemSchema).optional(),
    seq: z.number().int().nonnegative().optional(),
    // Only when `since` was honored: what happened after it, in order; `items` is then empty.
    events: z.array(ChatEventSchema).optional()
});
export type ChatAttachResult = z.infer<typeof ChatAttachResultSchema>;

export const ChatSendPayloadSchema = z
    .object({
        chatId: ChatIdSchema,
        text: z.string(),
        mentions: z.array(z.string().min(1)).max(64).optional(),
        skills: z.array(z.string().min(1)).max(16).optional(),
        attachments: ChatAttachmentUploadsSchema.optional()
    })
    .refine((payload) => payload.text.trim() !== '' || (payload.attachments?.length ?? 0) > 0, { message: 'A message needs text or an attachment' });
export type ChatSendPayload = z.infer<typeof ChatSendPayloadSchema>;

// Daemons before completion follow-ups omit `turnId`; keeping it optional lets newer clients finish the send.
export const ChatSendResultSchema = z.object({ queued: z.boolean(), turnId: z.string().min(1).optional() });
export type ChatSendResult = z.infer<typeof ChatSendResultSchema>;

export const ChatQueuePayloadSchema = z.object({
    chatId: ChatIdSchema,
    messageId: z.string().min(1)
});
export type ChatQueuePayload = z.infer<typeof ChatQueuePayloadSchema>;

// The message as it left the queue. An older daemon answers `{}` and refuses one it no longer holds.
export const ChatUnqueueResultSchema = z.object({
    message: ChatQueuedMessageSchema.optional()
});
export type ChatUnqueueResult = z.infer<typeof ChatUnqueueResultSchema>;

export const ChatApprovePayloadSchema = z.object({
    chatId: ChatIdSchema,
    requestId: z.string().min(1),
    decision: z.enum(['allow', 'allow-always', 'deny']),
    message: z.string().optional()
});
export type ChatApprovePayload = z.infer<typeof ChatApprovePayloadSchema>;

// Leaves an asynchronous question alone; the agent never hears about it and the item settles.
export const ChatDismissPayloadSchema = z.object({
    chatId: ChatIdSchema,
    itemId: z.string().min(1)
});
export type ChatDismissPayload = z.infer<typeof ChatDismissPayloadSchema>;

export const ChatAnswerPayloadSchema = z.object({
    chatId: ChatIdSchema,
    requestId: z.string().min(1),
    answers: z.record(z.string(), z.string())
});
export type ChatAnswerPayload = z.infer<typeof ChatAnswerPayloadSchema>;

export const ChatTurnDiffPayloadSchema = z.object({
    chatId: ChatIdSchema,
    turnId: z.string().min(1)
});
export type ChatTurnDiffPayload = z.infer<typeof ChatTurnDiffPayloadSchema>;

// Null when the turn has no checkpoint to diff against: no repository, or git could not be read.
export const ChatTurnDiffResultSchema = z.object({ diff: ChatCheckpointDiffSchema.nullable() });
export type ChatTurnDiffResult = z.infer<typeof ChatTurnDiffResultSchema>;

// A title of a node the fork makes; the same cap the canvas verbs hold a title to.
export const CHAT_FORK_TITLE_MAX = 120;

/*
 * A new chat that goes on after `turnId`, with the history up to and including that turn. The fork of
 * a node is a node beside it unless `asView` asks for a chat view of its own, listed right after the
 * canvas the node stands on. The fork of a chat that is a view of its own is a view listed right after
 * it, unless `viewId` names a canvas to put a node on instead.
 */
export const ChatForkPayloadSchema = z.object({
    chatId: ChatIdSchema,
    turnId: z.string().min(1),
    title: z.string().trim().min(1).max(CHAT_FORK_TITLE_MAX).optional(),
    viewId: z.string().min(1).optional(),
    asView: z.boolean().optional(),
    // A git worktree of its own on a new branch; absent is the original's folder. The branch defaults to one named after the title.
    worktree: z.object({ branch: z.string().trim().min(1).max(CHAT_FORK_TITLE_MAX).optional() }).optional(),
    // With a worktree: its files as they were after the turn rather than the branch's HEAD.
    filesAfterTurn: z.boolean().optional(),
    // Another CLI to go on with, which gets the conversation as text; absent is the original's CLI.
    provider: AgentKindSchema.optional(),
    // The model of that CLI; absent is the newest composer pick for it.
    selection: ModelSelectionSchema.optional()
});
export type ChatForkPayload = z.infer<typeof ChatForkPayloadSchema>;

/*
 * `viewId` is the canvas the node landed on, or the fork's own view, whose id is `nodeId`. `edgeId`
 * is null when no line could be drawn from the original: it stands on no canvas, or the fork does not.
 */
export const ChatForkResultSchema = z.object({
    info: ChatInfoSchema,
    nodeId: z.string(),
    viewId: z.string(),
    edgeId: z.string().nullable(),
    worktree: WorktreeSchema.optional()
});
export type ChatForkResult = z.infer<typeof ChatForkResultSchema>;

export const ChatSummarizePayloadSchema = z.object({ chatId: ChatIdSchema });
export type ChatSummarizePayload = z.infer<typeof ChatSummarizePayloadSchema>;

// The turn the fork writes its summary in; its last answer goes to the original once the turn ends.
export const ChatSummarizeResultSchema = z.object({ turnId: z.string() });
export type ChatSummarizeResult = z.infer<typeof ChatSummarizeResultSchema>;

export const ChatForkInfoPayloadSchema = z.object({ chatId: ChatIdSchema, turnId: z.string().min(1) });
export type ChatForkInfoPayload = z.infer<typeof ChatForkInfoPayloadSchema>;

/*
 * What the fork dialog asks before it offers a worktree: whether the chat's folder is in a repository,
 * the branches taken there with a free one to suggest, and whether the files after that turn can
 * still be put back (a tree git collected, or a turn that never had one, cannot).
 */
export const ChatForkInfoResultSchema = z.object({
    repository: z.boolean(),
    branches: z.array(z.string()),
    branch: z.string().nullable(),
    filesAfterTurn: z.boolean()
});
export type ChatForkInfoResult = z.infer<typeof ChatForkInfoResultSchema>;

export const ChatListResultSchema = z.object({
    chats: z.array(ChatInfoSchema)
});
export type ChatListResult = z.infer<typeof ChatListResultSchema>;
