import { lastSettledTurn } from '@ruimte/agents-react/chat/logic/fork';
import { useChatRow } from '@ruimte/agents-react/state/chats';

/*
 * Whether `ForkMenuItem` draws anything. A menu asks before it draws a line above the row, or an
 * empty chat gets two lines against each other. It asks what the component asks, so the two move together.
 */
export const useOffersFork = (chatId: string): boolean => {
    const settled = useChatRow(chatId, (row) => (row ? lastSettledTurn(row.structure, row.order) !== null : false));
    const forked = useChatRow(chatId, (row) => row?.info.forkOf !== undefined);
    return settled || forked;
};
