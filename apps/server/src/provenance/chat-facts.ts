import type { ChatCore } from '@adecore/agents/chat/chat-core';
import type { ProvenanceChat } from './provenance-service.ts';

/* What a chat that is loaded says about its turns; null for one that is not, since a turn is only recorded while its chat runs. */
export function provenanceChat(chats: Pick<ChatCore, 'get'>, chatId: string): ProvenanceChat | null {
    const session = chats.get(chatId);
    if (session === undefined) {
        return null;
    }
    const { thread } = session;
    return {
        provider: session.info.provider,
        cwd: session.info.cwd,
        checkpointOf: (turnId) => {
            const turn = thread.get(turnId);
            return turn?.kind === 'turn' ? turn.checkpoint : undefined;
        },
        turnNumberOf: (turnId) => {
            const index = thread
                .list()
                .filter((item) => item.kind === 'turn')
                .findIndex((item) => item.id === turnId);
            return index < 0 ? null : index + 1;
        },
        promptOf: (turnId) => thread.find('user', (item) => item.turnId === turnId)?.text ?? null
    };
}
