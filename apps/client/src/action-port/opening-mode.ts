import { useChats } from '@adecore/agents-react/state';
import { RuntimeModeSchema, type RuntimeMode } from '@ruimte/contracts';
import { perform } from '@/action-port/perform';
import { endpointKey } from '@/state/keys';
import { fireAndForget } from '@/transport-api/transport';

/* The mode a chat made a moment ago opens in, until its body opened it. */
const pending = new Map<string, RuntimeMode>();

/*
 * Has a new chat run in this mode as its own, leaving the machine's default alone. The chat may
 * already have opened by the time its maker knows its id, so an open one is configured instead.
 */
/* A mode a machine reported, when this version knows it; one of a newer machine is never passed on as another. */
export function knownRuntimeMode(word: string): RuntimeMode | undefined {
    const known = RuntimeModeSchema.safeParse(word);

    return known.success ? known.data : undefined;
}

export function openChatInMode(endpointId: string, chatId: string, runtimeMode: RuntimeMode): void {
    const key = endpointKey(endpointId, chatId);
    const info = useChats.getState().statusByKey[key]?.info;
    if (info === undefined) {
        pending.set(key, runtimeMode);
        return;
    }
    configureMode(chatId, info.runtimeMode, runtimeMode);
}

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

// `current` as the machine reports it, possibly a mode of a newer machine, which is only compared here.
function configureMode(chatId: string, current: string, wanted: RuntimeMode): void {
    if (current !== wanted) {
        void fireAndForget('chat.configure', perform('chat.configure', { chatId, model: null, option: null, runtimeMode: wanted }));
    }
}
