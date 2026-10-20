import type { ChatItem } from '@ruimte/contracts';
import type { ChatState } from '@adecore/agents-react/state';
import { chatWaits as threadWaits, turnCompletion, type VoiceChatCompletion } from '@ruimte/voice';

/* The thread in the order this window holds it. A long turn's own item may sit in `items` before the page `order` reaches back to. */
function threadItems(chat: Pick<ChatState, 'items' | 'order'>, turnId?: string): ChatItem[] {
    const items = chat.order.flatMap((id) => {
        const item = chat.items[id];
        return item ? [item] : [];
    });
    const turn = turnId === undefined ? undefined : chat.items[turnId];
    return turn?.kind === 'turn' && !chat.order.includes(turn.id) ? [turn, ...items] : items;
}

export function chatCompletion(chat: ChatState | undefined, turnId: string): VoiceChatCompletion | null {
    if (!chat) {
        return null;
    }
    return turnCompletion({ items: threadItems(chat, turnId), activeTurnId: chat.info.activeTurnId }, turnId);
}

/* Only what this window holds of the thread; a chat nobody here opened says what it waits on through chat.inspect. */
export function chatWaits(chat: Pick<ChatState, 'items' | 'order'> | undefined): string[] {
    return threadWaits(chat ? threadItems(chat) : undefined);
}
