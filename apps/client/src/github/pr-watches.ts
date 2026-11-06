import type { GitPrWatch, GitPrWatchEndReason } from '@ruimte/contracts';
import { create } from 'zustand';
import { dropEndpoint, endpointKey } from '@/state/keys';
import { readOnEveryOpen, type Transport, fireAndForget } from '@/transport-api/transport';
import { useEndpointId } from '../state/current-endpoint';

/*
 * The pull requests a machine watches, per chat. A person turns one on from the pull request dialog;
 * the machine polls and wakes the chat, and this only shows which chats it does that for. Every
 * change on the machine is heard as an event, and the list is read again then.
 */

interface PrWatchesStore {
    /* Keyed with `endpointKey(endpointId, chatId)`. */
    byChat: Readonly<Record<string, GitPrWatch>>;
    /* Why a watch ended by itself, until a person has seen it, by the same key. */
    ended: Readonly<Record<string, GitPrWatchEndReason>>;
    receive(endpointId: string, watches: readonly GitPrWatch[], ended?: { chatId: string; reason: GitPrWatchEndReason }): void;
    dismissEnded(endpointId: string, chatId: string): void;
    forget(endpointId: string): void;
}

export const usePrWatches = create<PrWatchesStore>((set, get) => ({
    byChat: {},
    ended: {},
    receive(endpointId, watches, ended) {
        const byChat: Record<string, GitPrWatch> = dropEndpoint(get().byChat, endpointId);
        for (const watch of watches) {
            byChat[endpointKey(endpointId, watch.chatId)] = watch;
        }
        set({
            byChat,
            ended: ended ? { ...get().ended, [endpointKey(endpointId, ended.chatId)]: ended.reason } : get().ended
        });
    },
    dismissEnded(endpointId, chatId) {
        const key = endpointKey(endpointId, chatId);
        if (get().ended[key] === undefined) {
            return;
        }
        const { [key]: _gone, ...ended } = get().ended;
        set({ ended });
    },
    forget(endpointId) {
        set({ byChat: dropEndpoint(get().byChat, endpointId), ended: dropEndpoint(get().ended, endpointId) });
    }
}));

/* The watch list of one machine: read on every fresh link and again after each change it reports. */
export function watchPrWatches(endpointId: string, transport: Transport): () => void {
    let generation = 0;
    const refresh = (ended?: { chatId: string; reason: GitPrWatchEndReason }): void => {
        const current = ++generation;
        void fireAndForget(
            'git.pr-watches',
            transport.request('git.pr-watches', {}).then(({ watches }) => {
                if (current === generation) {
                    usePrWatches.getState().receive(endpointId, watches, ended);
                }
            })
        );
    };
    const offEvent = transport.on('git.pr-watches', ({ ended }) => refresh(ended));
    const offStatus = readOnEveryOpen(transport, refresh);
    return () => {
        generation++;
        offEvent();
        offStatus();
        usePrWatches.getState().forget(endpointId);
    };
}

/* The watch a chat has on the machine in scope, or null. */
export function useChatPrWatch(chatId: string): GitPrWatch | null {
    const endpointId = useEndpointId();
    return usePrWatches((s) => s.byChat[endpointKey(endpointId, chatId)] ?? null);
}
