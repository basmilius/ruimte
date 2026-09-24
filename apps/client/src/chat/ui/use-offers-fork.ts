import { lastSettledTurn } from '@/chat/logic/fork';
import { useChatRow } from '@/state/chats';

/*
 * Whether `ForkMenuItem` draws anything at all. A menu that puts a line above the row has to know
 * that before it draws the line, or a chat nobody has written in yet gets two lines against each
 * other. It asks the same two questions the component asks, so the two move together.
 */
export const useOffersFork = (chatId: string): boolean => {
    const settled = useChatRow(chatId, (row) => (row ? lastSettledTurn(row.structure, row.order) !== null : false));
    const forked = useChatRow(chatId, (row) => row?.info.forkOf !== undefined);
    return settled || forked;
};
