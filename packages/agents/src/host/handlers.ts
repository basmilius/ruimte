import type { AGENT_REQUEST_SCHEMAS, AgentRequestType } from '@ruimte/agent-contracts';
import type { z } from 'zod';
import type { ChatCore } from '../chat/chat-core.ts';
import { ChatError } from '../chat/errors.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { UsageMonitor } from '../usage/limits/monitor.ts';
import type { UsageService } from '../usage/usage-service.ts';

export type AgentRequestMap = {
    [T in AgentRequestType]: {
        payload: z.infer<(typeof AGENT_REQUEST_SCHEMAS)[T]['payload']>;
        result: z.infer<(typeof AGENT_REQUEST_SCHEMAS)[T]['result']>;
    };
};

/* One request as a host answers it, for the client that asked. */
export type AgentHandler<T extends AgentRequestType> = (
    payload: AgentRequestMap[T]['payload'],
    clientId: string
) => AgentRequestMap[T]['result'] | Promise<AgentRequestMap[T]['result']>;

export type AgentHandlers = { [T in AgentRequestType]: AgentHandler<T> };

type AccountRequestType = Extract<AgentRequestType, `accounts.${string}`>;
type UsageRequestType = Extract<AgentRequestType, `usage.${string}`>;
export type ChatRequestType = Exclude<AgentRequestType, AccountRequestType | UsageRequestType>;

// A fork lands on a canvas and a summary goes back along its line, which a host of chats alone does not have.
const unsupported = (what: string) => (): never => {
    throw new ChatError('chat-unsupported', `This host does not ${what}`);
};

/* The chat requests over a core, including the ones only a host with more than chats can answer, which say so. */
export const chatHandlers = (chats: ChatCore, providers: ProviderRegistry): { [T in ChatRequestType]: AgentHandler<T> } => ({
    'provider.list': async () => ({ providers: await providers.list() }),
    'chat.create': (payload) => chats.create(payload),
    'chat.configure': (payload) => chats.configure(payload),
    // What a chat the host starts on its own is made with, while this client is connected.
    'chat.setPreferences': (payload, clientId) => {
        chats.composerPreferences.set(clientId, payload);
        return {};
    },
    'chat.attach': (payload, clientId) => chats.attachWithBookmarks(payload.chatId, clientId, payload.historyLimit, payload.since),
    'chat.history': (payload) => chats.history(payload.chatId, payload.cursor, payload.limit),
    'chat.subagent': (payload, clientId) => chats.subagent(clientId, payload),
    'chat.stopSubagent': async (payload) => {
        await chats.stopSubagent(payload.chatId, payload.toolUseId);
        return {};
    },
    'chat.stopTask': async (payload) => {
        await chats.stopTask(payload.chatId, payload.taskId);
        return {};
    },
    'chat.detach': (payload, clientId) => {
        chats.detach(payload.chatId, clientId);
        return {};
    },
    'chat.send': (payload) =>
        chats.send(payload.chatId, payload.text, { mentions: payload.mentions, skills: payload.skills, chats: payload.chats }, payload.attachments),
    'chat.unqueue': (payload) => ({ message: chats.unqueue(payload.chatId, payload.messageId) }),
    'chat.sendNow': (payload) => {
        chats.sendNow(payload.chatId, payload.messageId);
        return {};
    },
    'skills.list': async (payload) => ({ skills: await chats.skills(payload.chatId) }),
    'chat.compact': (payload) => {
        chats.compact(payload.chatId);
        return {};
    },
    'chat.clear': async (payload) => {
        await chats.clear(payload.chatId, payload.force === true);
        return {};
    },
    'chat.turnDiff': async (payload) => ({ diff: await chats.turnDiff(payload.chatId, payload.turnId) }),
    'chat.fork': unsupported('fork chats'),
    'chat.forkInfo': unsupported('fork chats'),
    'chat.summarize': unsupported('fork chats'),
    'chat.continueOn': unsupported('continue a chat under another account'),
    'chat.cancel': (payload) => {
        chats.cancel(payload.chatId, payload.subagents === true);
        return {};
    },
    'chat.approve': (payload) => {
        chats.approve(payload.chatId, payload.requestId, payload.decision, payload.message);
        return {};
    },
    'chat.answer': (payload) => {
        chats.answer(payload.chatId, payload.requestId, payload.answers);
        return {};
    },
    'chat.dismiss': (payload) => {
        chats.dismiss(payload.chatId, payload.itemId);
        return {};
    },
    'chat.addBookmark': async (payload) => ({ bookmarks: await chats.addBookmark(payload.chatId, payload.itemId, payload.name) }),
    'chat.renameBookmark': async (payload) => ({ bookmarks: await chats.renameBookmark(payload.chatId, payload.itemId, payload.name) }),
    'chat.removeBookmark': async (payload) => ({ bookmarks: await chats.removeBookmark(payload.chatId, payload.itemId) }),
    'chat.kill': async (payload) => {
        await chats.kill(payload.chatId);
        return {};
    },
    'chat.list': () => ({ chats: chats.list() })
});

/* The accounts are the person's settings of this host. */
export const accountHandlers = (accounts: ProviderAccountsService): { [T in AccountRequestType]: AgentHandler<T> } => ({
    'accounts.list': () => accounts.snapshot(),
    'accounts.save': (payload) => accounts.save(payload.accounts),
    'accounts.refresh': () => accounts.refresh(),
    'accounts.create': (payload) => accounts.create(payload),
    'accounts.watchLogin': (payload) => {
        void accounts.watchLogin(payload.id);
        return {};
    }
});

export const usageHandlers = (usage: UsageService, limits: UsageMonitor): { [T in UsageRequestType]: AgentHandler<T> } => ({
    'usage.summary': (payload) => usage.summary(payload),
    // While a client has the page open the host keeps scanning; every other client gets the event too.
    'usage.subscribe': (_payload, clientId) => {
        usage.follow(clientId);
        return {};
    },
    'usage.unsubscribe': (_payload, clientId) => {
        usage.unfollow(clientId);
        return {};
    },
    'usage.limits': () => limits.snapshot(),
    'usage.refreshLimits': async () => {
        await limits.refresh(true);
        return limits.snapshot();
    }
});
