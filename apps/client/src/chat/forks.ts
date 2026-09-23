import { useMemo } from 'react';
import type { ChatInfo } from '@ruimte/contracts';
import { forkIdsAfter, forkedTurnIds } from '@/chat/logic/fork';
import { useChats, type ChatsById } from '@/state/chats';
import { splitKey, useEndpointId } from '@/state/keys';

/* The chats this client holds of one machine, which is where the forks it knows of are. */
function* forkInfosOn(byKey: ChatsById, endpointId: string): Generator<ChatInfo> {
    for (const [key, state] of Object.entries(byKey)) {
        if (state.info.forkOf !== undefined && splitKey(key).endpointId === endpointId) {
            yield state.info;
        }
    }
}

/* Selectors answer a joined string, never a new array or set, and split it again in a memo. */
const splitIds = (joined: string): string[] => (joined === '' ? [] : joined.split('\n'));

/* The turns of this chat a fork went on after, for the thread to put a line under. */
export const useForkedTurns = (chatId: string): ReadonlySet<string> => {
    const endpointId = useEndpointId();
    const joined = useChats((s) => [...forkedTurnIds(forkInfosOn(s.byKey, endpointId), chatId)].join('\n'));
    return useMemo(() => new Set(splitIds(joined)), [joined]);
};

/* The forks that went on after this turn of this chat. */
export const useForkIdsAfter = (chatId: string, turnId: string): string[] => {
    const endpointId = useEndpointId();
    const joined = useChats((s) => forkIdsAfter(forkInfosOn(s.byKey, endpointId), chatId, turnId).join('\n'));
    return useMemo(() => splitIds(joined), [joined]);
};
