import type { ChatCore } from '@adecore/agents/chat';
import type { AgentInfo, ChatDelivery, ChatInfo, ChatItem } from '@ruimte/contracts';
import { voiceActions } from '../actions/voice-actions.ts';
import type { CanvasHost } from '../canvas/host.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { defineAgentFeature } from './feature.ts';

/* A chat's items and info as they stand, whether its CLI runs or the chat is only a record; null for no chat of that id. */
interface ChatThreadHost {
    items(chatId: string): Promise<ChatItem[] | null>;
    info?(chatId: string): Promise<ChatInfo | null>;
}

/* A prompt into a chat the machine runs, the way a person's composer sends one; Voice prompts no chat that is only a record. */
interface ChatPromptHost {
    running(chatId: string): boolean;
    send(chatId: string, text: string, delivery: ChatDelivery | undefined): Promise<{ queued: boolean; turnId: string }>;
    /* The daemon's own `chat.clear`, stopping a turn in the way: whoever calls it asked the person first. */
    clear(chatId: string): Promise<void>;
}

/* The agent a terminal runs as its hooks last told it; null for a plain shell, undefined for no session of that id. */
interface TerminalAgentHost {
    agentOf(sessionId: string): AgentInfo | null | undefined;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The thread of a chat, loaded or only on disk, for a reader that does not attach and wakes nothing; absent on a host without chats. */
        chatThreads?: ChatThreadHost;
        /* What a terminal agent does, which Voice reads where a window would read its status. */
        terminals?: TerminalAgentHost;
        /* Prompting or clearing a chat, which only Voice does through an action; an agent sends through `notify`. */
        chatPrompts?: ChatPromptHost;
    }
}

/* How a tool reads and prompts chats and asks which agent a terminal runs. */
export function chatAccess(chats: ChatCore, sessions: SessionManager): Pick<CanvasHost, 'chatThreads' | 'chatPrompts' | 'terminals'> {
    return {
        // A chat nobody opened since a restart is read from its record, which starts no CLI.
        chatThreads: {
            items: async (chatId) => chats.get(chatId)?.thread.list() ?? (await chats.readChat(chatId))?.items ?? null,
            info: async (chatId) => chats.get(chatId)?.info ?? (await chats.readChat(chatId))?.info ?? null
        },
        chatPrompts: {
            running: (chatId) => chats.get(chatId) !== undefined,
            send: (chatId, text, delivery) => chats.send(chatId, text, delivery === undefined ? {} : { delivery }),
            clear: (chatId) => chats.clear(chatId, true)
        },
        terminals: {
            agentOf: (sessionId) => {
                const session = sessions.get(sessionId);
                return session === undefined ? undefined : (session.agent ?? null);
            }
        }
    };
}

/* Voice has no tool: it reads and prompts chats and terminals through the actions, so it carries the three ports for that. */
export const voiceFeature = defineAgentFeature({
    name: 'voice',
    actions: voiceActions,
    host: ({ agents }) => chatAccess(agents.chats, agents.sessions)
});
