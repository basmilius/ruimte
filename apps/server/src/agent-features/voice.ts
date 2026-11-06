import { voiceActions } from '../actions/voice-actions.ts';
import type { CanvasHost } from '../canvas/host.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { defineAgentFeature } from './feature.ts';

/* How a tool reads and prompts chats and asks which agent a terminal runs. */
export function chatAccess(chats: ChatManager, sessions: SessionManager): Pick<CanvasHost, 'chatThreads' | 'chatPrompts' | 'terminals'> {
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
