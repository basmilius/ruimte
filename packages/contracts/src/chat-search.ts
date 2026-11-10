import { AgentKindSchema, ProviderAccountIdSchema } from '@adecore/agent-contracts';
import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';

const CHAT_SEARCH_MAX_HITS = 500;

export const ChatSearchPayloadSchema = z.object({
    projectId: z.string().min(1),
    query: z.string().min(1).max(256),
    // Chosen by the client, so a new query can cancel the one it replaces.
    searchId: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(CHAT_SEARCH_MAX_HITS).optional()
});
export type ChatSearchPayload = z.infer<typeof ChatSearchPayloadSchema>;

export const ChatSearchHitSchema = z.object({
    chatId: z.string().min(1),
    itemId: z.string().min(1),
    author: z.enum(['person', 'agent']),
    snippet: z.string(),
    matchStart: z.number().int().nonnegative(),
    matchLength: z.number().int().nonnegative(),
    createdAt: z.number()
});
export type ChatSearchHit = z.infer<typeof ChatSearchHitSchema>;

export const ChatSearchResultSchema = z.object({
    hits: z.array(ChatSearchHitSchema),
    // The title of every chat with a hit, so the client groups without asking the project again.
    chats: z.array(z.object({ chatId: z.string().min(1), title: z.string() })),
    searched: z.number().int().nonnegative(),
    failed: z.array(z.object({ chatId: z.string().min(1), title: z.string(), reason: z.string() })),
    // Whether hits were left out because the limit was reached.
    truncated: z.boolean(),
    cancelled: z.boolean()
});
export type ChatSearchResult = z.infer<typeof ChatSearchResultSchema>;

export const ChatSearchCancelPayloadSchema = z.object({ searchId: z.string().min(1).max(64) });

export const ChatExternalPayloadSchema = z.object({ projectId: z.string().min(1) });

export const ChatExternalSessionSchema = z.object({
    provider: AgentKindSchema,
    // The account whose folder holds the session, so resuming it signs in the same way; absent for the default one.
    account: ProviderAccountIdSchema.optional(),
    sessionId: z.string().min(1),
    title: z.string(),
    updatedAt: z.number(),
    cwd: z.string()
});
export type ChatExternalSession = z.infer<typeof ChatExternalSessionSchema>;

export const ChatExternalResultSchema = z.object({
    sessions: z.array(ChatExternalSessionSchema),
    failed: z.array(z.object({ provider: AgentKindSchema, reason: z.string() }))
});
export type ChatExternalResult = z.infer<typeof ChatExternalResultSchema>;

export const CHAT_SEARCH_REQUEST_SCHEMAS = {
    'chat.search': { payload: ChatSearchPayloadSchema, result: ChatSearchResultSchema },
    'chat.searchCancel': { payload: ChatSearchCancelPayloadSchema, result: EmptySchema },
    'chat.external': { payload: ChatExternalPayloadSchema, result: ChatExternalResultSchema }
} as const;
