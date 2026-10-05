import { jumpToTimelineTurn, type TurnTarget } from '@ruimte/agents-react/chat/timeline-scroll';
import { focusChat } from '@/plan/plan-actions';
import { endpointKey } from '@/state/keys';

/*
 * Brings a chat into view and scrolls its thread to a turn: the message that opened it, or the files it
 * changed. A thread that is not drawn yet takes the jump when it is.
 */
export function openChatAtTurn(endpointId: string, chatId: string, turnId: string, target: TurnTarget, focus: (chatId: string) => void = focusChat): void {
    focus(chatId);
    jumpToTimelineTurn(endpointKey(endpointId, chatId), turnId, target);
}
