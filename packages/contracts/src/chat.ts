import { z } from 'zod';
import { AgentStatusSchema } from './agent.ts';

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
    cwd: z.string(),
    // Set once the CLI announced itself; what a terminal node needs for `--resume`.
    agentSessionId: z.string().nullable(),
    model: z.string().nullable(),
    status: AgentStatusSchema,
    // Whether the CLI process is alive right now. A dead one is started again with `--resume` on the next send.
    running: z.boolean(),
    usage: ChatUsageSchema,
    createdAt: z.number()
});
export type ChatInfo = z.infer<typeof ChatInfoSchema>;

const base = {
    id: z.string().min(1),
    createdAt: z.number()
};

export const ChatUserItemSchema = z.object({ ...base, kind: z.literal('user'), text: z.string() });

export const ChatAssistantItemSchema = z.object({
    ...base,
    kind: z.literal('assistant'),
    text: z.string(),
    streaming: z.boolean()
});

export const ChatToolStateSchema = z.enum(['running', 'done', 'error']);
export type ChatToolState = z.infer<typeof ChatToolStateSchema>;

export const ChatToolItemSchema = z.object({
    ...base,
    kind: z.literal('tool'),
    toolUseId: z.string(),
    name: z.string(),
    input: z.unknown(),
    output: z.string().nullable(),
    state: ChatToolStateSchema
});

export const ChatApprovalDecisionSchema = z.enum(['pending', 'allow', 'deny', 'cancelled']);
export type ChatApprovalDecision = z.infer<typeof ChatApprovalDecisionSchema>;

export const ChatApprovalItemSchema = z.object({
    ...base,
    kind: z.literal('approval'),
    requestId: z.string(),
    toolUseId: z.string().nullable(),
    toolName: z.string(),
    input: z.unknown(),
    description: z.string().nullable(),
    decision: ChatApprovalDecisionSchema
});

export const ChatNoteItemSchema = z.object({
    ...base,
    kind: z.literal('note'),
    level: z.enum(['info', 'error']),
    text: z.string()
});

export const ChatItemSchema = z.discriminatedUnion('kind', [
    ChatUserItemSchema,
    ChatAssistantItemSchema,
    ChatToolItemSchema,
    ChatApprovalItemSchema,
    ChatNoteItemSchema
]);
export type ChatItem = z.infer<typeof ChatItemSchema>;
export type ChatUserItem = z.infer<typeof ChatUserItemSchema>;
export type ChatAssistantItem = z.infer<typeof ChatAssistantItemSchema>;
export type ChatToolItem = z.infer<typeof ChatToolItemSchema>;
export type ChatApprovalItem = z.infer<typeof ChatApprovalItemSchema>;
export type ChatNoteItem = z.infer<typeof ChatNoteItemSchema>;

// Every change to a thread is one of these; `item` is an upsert by id so a client can rebuild
// its view from any prefix of the stream after `chat.attach` handed it the current state.
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
    cwd: z.string().optional(),
    // A CLI session to continue, for a chat opened from a terminal that ran the agent.
    resume: z.string().optional(),
    model: z.string().optional()
});
export type ChatCreatePayload = z.infer<typeof ChatCreatePayloadSchema>;

export const ChatTargetPayloadSchema = z.object({ chatId: ChatIdSchema });
export type ChatTargetPayload = z.infer<typeof ChatTargetPayloadSchema>;

export const ChatAttachResultSchema = z.object({
    info: ChatInfoSchema,
    items: z.array(ChatItemSchema)
});
export type ChatAttachResult = z.infer<typeof ChatAttachResultSchema>;

export const ChatSendPayloadSchema = z.object({
    chatId: ChatIdSchema,
    text: z.string().min(1)
});
export type ChatSendPayload = z.infer<typeof ChatSendPayloadSchema>;

export const ChatApprovePayloadSchema = z.object({
    chatId: ChatIdSchema,
    requestId: z.string().min(1),
    decision: z.enum(['allow', 'deny']),
    message: z.string().optional()
});
export type ChatApprovePayload = z.infer<typeof ChatApprovePayloadSchema>;

export const ChatListResultSchema = z.object({
    chats: z.array(ChatInfoSchema)
});
export type ChatListResult = z.infer<typeof ChatListResultSchema>;
