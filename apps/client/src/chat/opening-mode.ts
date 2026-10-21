import { useChats } from '@adecore/agents-react/state';
import type { RuntimeMode } from '@ruimte/contracts';
import { perform } from '@/actions/client-actions';
import { endpointKey } from '@/state/keys';

/* The mode a chat made a moment ago opens in, until its body opened it. */
const pending = new Map<string, RuntimeMode>();

/*
 * Has a new chat run in this mode as its own, leaving the machine's default alone. The chat may
 * already have opened by the time its maker knows its id, so an open one is configured instead.
 */
export function openChatInMode(endpointId: string, chatId: string, runtimeMode: RuntimeMode): void {
    const key = endpointKey(endpointId, chatId);
    const info = useChats.getState().statusByKey[key]?.info;
    if (info === undefined) {
        pending.set(key, runtimeMode);
        return;
    }
    configureMode(chatId, info.runtimeMode, runtimeMode);
}

/* The mode a chat's body opens it in, when its maker asked for one. */
export function peekOpeningMode(endpointId: string, chatId: string): RuntimeMode | undefined {
    return pending.get(endpointKey(endpointId, chatId));
}

/* Called once the chat opened, for a mode that arrived while it was opening. */
export function settleOpeningMode(endpointId: string, chatId: string): void {
    const key = endpointKey(endpointId, chatId);
    const wanted = pending.get(key);
    const info = useChats.getState().statusByKey[key]?.info;
    if (wanted === undefined || info === undefined) {
        return;
    }
    pending.delete(key);
    configureMode(chatId, info.runtimeMode, wanted);
}

function configureMode(chatId: string, current: RuntimeMode, wanted: RuntimeMode): void {
    if (current !== wanted) {
        void perform('chat.configure', { chatId, model: null, option: null, runtimeMode: wanted }).catch(() => undefined);
    }
}
