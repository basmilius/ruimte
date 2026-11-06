import type { ChatState } from '@adecore/agents-react/state';
import type { ChatItem } from '@ruimte/contracts';
import { chatTurnProgress, type VoiceChatCompletion, type VoiceChatState } from '@ruimte/voice';

/* The thread in the order this window holds it. A long turn's own item may sit in `items` before the page `order` reaches back to. */
function threadItems(chat: Pick<ChatState, 'items' | 'order'>, turnId?: string): ChatItem[] {
    const items = chat.order.flatMap((id) => {
        const item = chat.items[id];
        return item ? [item] : [];
    });
    const turn = turnId === undefined ? undefined : chat.items[turnId];
    return turn?.kind === 'turn' && !chat.order.includes(turn.id) ? [turn, ...items] : items;
}

/* A chat this window holds as the runners of Voice read it. */
export function followedState(chat: Pick<ChatState, 'items' | 'order' | 'info'>, turnId: string): VoiceChatState {
    return { items: threadItems(chat, turnId), info: chat.info };
}

export function chatCompletion(chat: ChatState | undefined, turnId: string): VoiceChatCompletion | null {
    if (!chat) {
        return null;
    }
    const progress = chatTurnProgress(followedState(chat, turnId), turnId);
    return progress.kind === 'settled' ? progress.completion : null;
}
