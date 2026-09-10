import { z } from 'zod';
import { AgentKindSchema, AgentStatusSchema } from './agent.ts';
import { ModelSelectionSchema, RuntimeModeSchema } from './model.ts';

// The client picks the id (its node id), like a terminal session.
export const ChatIdSchema = z.string().min(1);
export type ChatId = z.infer<typeof ChatIdSchema>;

export const ChatUsageSchema = z.object({
    // Tokens the last request carried, which is what the model saw as its context.
    contextTokens: z.number().int().nonnegative(),
    contextWindow: z.number().int().positive().nullable(),
    costUsd: z.number().nonnegative(),
    turns: z.number().int().nonnegative()
});
export type ChatUsage = z.infer<typeof ChatUsageSchema>;

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
    usage: ChatUsageSchema,
    createdAt: z.number()
});
export type ChatInfo = z.infer<typeof ChatInfoSchema>;

const base = {
    id: z.string().min(1),
    createdAt: z.number(),
    turnId: z.string().nullable()
};

// What the Anthropic API takes as an image block; the CLI passes the block through as is.
export const ChatAttachmentMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export type ChatAttachmentMediaType = z.infer<typeof ChatAttachmentMediaTypeSchema>;

// The API refuses an image over 5 MB; the count keeps one message from carrying a whole folder.
export const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_ATTACHMENTS_MAX_COUNT = 8;
const MAX_BASE64_LENGTH = Math.ceil(CHAT_ATTACHMENT_MAX_BYTES / 3) * 4;

export const ChatAttachmentSchema = z.object({
    name: z.string().min(1).max(255),
    mediaType: ChatAttachmentMediaTypeSchema,
    // Base64 without a data-URL prefix.
    data: z.string().min(1).max(MAX_BASE64_LENGTH)
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatUserItemSchema = z.object({
    ...base,
    kind: z.literal('user'),
    text: z.string(),
    // Files the person picked with `@`; the paths also sit in the text, this is what the row highlights.
    mentions: z.array(z.string()).optional(),
    attachments: z.array(ChatAttachmentSchema).optional()
});

export const ChatAssistantItemSchema = z.object({
    ...base,
    kind: z.literal('assistant'),
    text: z.string(),
    streaming: z.boolean()
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
    // Keyed by question id; null while the person has not answered.
    answers: z.record(z.string(), z.string()).nullable(),
    state: z.enum(['pending', 'answered', 'cancelled'])
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
    endedAt: z.number().nullable(),
    costUsd: z.number().nonnegative(),
    // The git tree of the chat's folder when the turn started; absent outside a repository.
    checkpoint: z.string().optional(),
    // What the working tree holds against that checkpoint, taken when the turn settled.
    checkpointDiff: ChatCheckpointDiffSchema.optional()
});

export const ChatNoteItemSchema = z.object({
    ...base,
    kind: z.literal('note'),
    level: z.enum(['info', 'warning', 'error']),
    text: z.string()
});

export const ChatCompactionItemSchema = z.object({
    ...base,
    kind: z.literal('compaction'),
    preTokens: z.number().int().nonnegative().nullable()
});

export const ChatItemSchema = z.discriminatedUnion('kind', [
    ChatUserItemSchema,
    ChatAssistantItemSchema,
    ChatToolItemSchema,
    ChatApprovalItemSchema,
    ChatQuestionItemSchema,
    ChatTurnItemSchema,
    ChatNoteItemSchema,
    ChatCompactionItemSchema
]);
export type ChatItem = z.infer<typeof ChatItemSchema>;
export type ChatUserItem = z.infer<typeof ChatUserItemSchema>;
export type ChatAssistantItem = z.infer<typeof ChatAssistantItemSchema>;
export type ChatToolItem = z.infer<typeof ChatToolItemSchema>;
export type ChatApprovalItem = z.infer<typeof ChatApprovalItemSchema>;
export type ChatQuestionItem = z.infer<typeof ChatQuestionItemSchema>;
export type ChatTurnItem = z.infer<typeof ChatTurnItemSchema>;
export type ChatNoteItem = z.infer<typeof ChatNoteItemSchema>;
export type ChatCompactionItem = z.infer<typeof ChatCompactionItemSchema>;

// Every change to a thread is one of these; `item` is an upsert by id so a client can rebuild
// its view from any prefix of the stream after `chat.attach` handed it the current state.
// A `delta` appends to an assistant item's text or to a running tool item's partial output.
export const ChatEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('item'), item: ChatItemSchema }),
    z.object({ type: z.literal('delta'), itemId: z.string(), text: z.string() }),
    z.object({ type: z.literal('info'), info: ChatInfoSchema })
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const ChatEventEnvelopeSchema = z.object({
    chatId: ChatIdSchema,
    event: ChatEventSchema
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

export const ChatTargetPayloadSchema = z.object({ chatId: ChatIdSchema });
export type ChatTargetPayload = z.infer<typeof ChatTargetPayloadSchema>;

export const ChatAttachResultSchema = z.object({
    info: ChatInfoSchema,
    items: z.array(ChatItemSchema)
});
export type ChatAttachResult = z.infer<typeof ChatAttachResultSchema>;

export const ChatSendPayloadSchema = z
    .object({
        chatId: ChatIdSchema,
        text: z.string(),
        mentions: z.array(z.string().min(1)).max(64).optional(),
        attachments: z.array(ChatAttachmentSchema).max(CHAT_ATTACHMENTS_MAX_COUNT).optional()
    })
    .refine((payload) => payload.text.trim() !== '' || (payload.attachments?.length ?? 0) > 0, { message: 'A message needs text or an attachment' });
export type ChatSendPayload = z.infer<typeof ChatSendPayloadSchema>;

export const ChatApprovePayloadSchema = z.object({
    chatId: ChatIdSchema,
    requestId: z.string().min(1),
    decision: z.enum(['allow', 'allow-always', 'deny']),
    message: z.string().optional()
});
export type ChatApprovePayload = z.infer<typeof ChatApprovePayloadSchema>;

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

export const ChatListResultSchema = z.object({
    chats: z.array(ChatInfoSchema)
});
export type ChatListResult = z.infer<typeof ChatListResultSchema>;
