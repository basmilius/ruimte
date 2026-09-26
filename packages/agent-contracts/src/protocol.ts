import { z } from 'zod';
import {
    ChatAddBookmarkPayloadSchema,
    ChatAnswerPayloadSchema,
    ChatApprovePayloadSchema,
    ChatAttachPayloadSchema,
    ChatAttachResultSchema,
    ChatBookmarksEventSchema,
    ChatBookmarksResultSchema,
    ChatCancelPayloadSchema,
    ChatClearPayloadSchema,
    ChatConfigurePayloadSchema,
    ChatContinueOnPayloadSchema,
    ChatContinueOnResultSchema,
    ChatCreatePayloadSchema,
    ChatDismissPayloadSchema,
    ChatEventEnvelopeSchema,
    ChatForkInfoPayloadSchema,
    ChatForkInfoResultSchema,
    ChatForkPayloadSchema,
    ChatForkResultSchema,
    ChatHistoryPayloadSchema,
    ChatHistoryResultSchema,
    ChatInfoSchema,
    ChatListResultSchema,
    ChatPreferencesPayloadSchema,
    ChatQueuePayloadSchema,
    ChatRemoveBookmarkPayloadSchema,
    ChatRenameBookmarkPayloadSchema,
    ChatSendPayloadSchema,
    ChatSendResultSchema,
    ChatStatusEventSchema,
    ChatStopSubagentPayloadSchema,
    ChatStopTaskPayloadSchema,
    ChatSubagentChangedEventSchema,
    ChatSubagentPayloadSchema,
    ChatSubagentResultSchema,
    ChatSummarizePayloadSchema,
    ChatSummarizeResultSchema,
    ChatTargetPayloadSchema,
    ChatTurnDiffPayloadSchema,
    ChatTurnDiffResultSchema,
    ChatUnqueueResultSchema,
    SkillsListPayloadSchema,
    SkillsListResultSchema
} from './chat.ts';
import { ProviderListResultSchema } from './model.ts';
import {
    ProviderAccountCreatePayloadSchema,
    ProviderAccountCreateResultSchema,
    ProviderAccountWatchLoginPayloadSchema,
    ProviderAccountsSavePayloadSchema,
    ProviderAccountsSchema
} from './provider-accounts.ts';
import { UsageChangedEventSchema, UsageLimitsSnapshotSchema, UsageSummaryPayloadSchema, UsageSummaryResultSchema } from './usage.ts';

export const EmptySchema = z.object({});

/*
 * The requests a chat, its providers and their usage answer, with what goes in and what comes back.
 * `@ruimte/contracts` places each one in the wire's own table, so a host that only runs chats serves
 * exactly these and a client reads the same shapes either way.
 */
export const AGENT_REQUEST_SCHEMAS = {
    'chat.create': { payload: ChatCreatePayloadSchema, result: ChatInfoSchema },
    'chat.history': { payload: ChatHistoryPayloadSchema, result: ChatHistoryResultSchema },
    'chat.attach': { payload: ChatAttachPayloadSchema, result: ChatAttachResultSchema },
    'chat.detach': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.send': { payload: ChatSendPayloadSchema, result: ChatSendResultSchema },
    'chat.unqueue': { payload: ChatQueuePayloadSchema, result: ChatUnqueueResultSchema },
    'chat.sendNow': { payload: ChatQueuePayloadSchema, result: EmptySchema },
    'chat.cancel': { payload: ChatCancelPayloadSchema, result: EmptySchema },
    'chat.approve': { payload: ChatApprovePayloadSchema, result: EmptySchema },
    'chat.answer': { payload: ChatAnswerPayloadSchema, result: EmptySchema },
    'chat.dismiss': { payload: ChatDismissPayloadSchema, result: EmptySchema },
    'chat.configure': { payload: ChatConfigurePayloadSchema, result: ChatInfoSchema },
    'chat.setPreferences': { payload: ChatPreferencesPayloadSchema, result: EmptySchema },
    'chat.compact': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.clear': { payload: ChatClearPayloadSchema, result: EmptySchema },
    'chat.turnDiff': { payload: ChatTurnDiffPayloadSchema, result: ChatTurnDiffResultSchema },
    'chat.fork': { payload: ChatForkPayloadSchema, result: ChatForkResultSchema },
    'chat.continueOn': { payload: ChatContinueOnPayloadSchema, result: ChatContinueOnResultSchema },
    'chat.forkInfo': { payload: ChatForkInfoPayloadSchema, result: ChatForkInfoResultSchema },
    'chat.summarize': { payload: ChatSummarizePayloadSchema, result: ChatSummarizeResultSchema },
    'chat.subagent': { payload: ChatSubagentPayloadSchema, result: ChatSubagentResultSchema },
    'chat.stopSubagent': { payload: ChatStopSubagentPayloadSchema, result: EmptySchema },
    'chat.stopTask': { payload: ChatStopTaskPayloadSchema, result: EmptySchema },
    'chat.addBookmark': { payload: ChatAddBookmarkPayloadSchema, result: ChatBookmarksResultSchema },
    'chat.renameBookmark': { payload: ChatRenameBookmarkPayloadSchema, result: ChatBookmarksResultSchema },
    'chat.removeBookmark': { payload: ChatRemoveBookmarkPayloadSchema, result: ChatBookmarksResultSchema },
    'skills.list': { payload: SkillsListPayloadSchema, result: SkillsListResultSchema },
    'provider.list': { payload: EmptySchema, result: ProviderListResultSchema },
    'accounts.list': { payload: EmptySchema, result: ProviderAccountsSchema },
    'accounts.save': { payload: ProviderAccountsSavePayloadSchema, result: ProviderAccountsSchema },
    // Asks every CLI again and answers once they all did.
    'accounts.refresh': { payload: EmptySchema, result: ProviderAccountsSchema },
    'accounts.create': { payload: ProviderAccountCreatePayloadSchema, result: ProviderAccountCreateResultSchema },
    // Answers at once; what the CLI says arrives as `accounts.changed`.
    'accounts.watchLogin': { payload: ProviderAccountWatchLoginPayloadSchema, result: EmptySchema },
    'usage.summary': { payload: UsageSummaryPayloadSchema, result: UsageSummaryResultSchema },
    'usage.subscribe': { payload: EmptySchema, result: EmptySchema },
    'usage.unsubscribe': { payload: EmptySchema, result: EmptySchema },
    'usage.limits': { payload: EmptySchema, result: UsageLimitsSnapshotSchema },
    'usage.refreshLimits': { payload: EmptySchema, result: UsageLimitsSnapshotSchema },
    'chat.kill': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.list': { payload: EmptySchema, result: ChatListResultSchema }
} as const;

export const AGENT_EVENT_SCHEMAS = {
    'chat.event': ChatEventEnvelopeSchema,
    'chat.status': ChatStatusEventSchema,
    'chat.subagentChanged': ChatSubagentChangedEventSchema,
    'chat.bookmarks': ChatBookmarksEventSchema,
    'usage.changed': UsageChangedEventSchema,
    'usage.limitsChanged': UsageLimitsSnapshotSchema,
    'accounts.changed': ProviderAccountsSchema
} as const;

export type AgentRequestType = keyof typeof AGENT_REQUEST_SCHEMAS;
export type AgentEventType = keyof typeof AGENT_EVENT_SCHEMAS;
