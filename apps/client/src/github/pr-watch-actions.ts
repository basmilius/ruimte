import { endpointKey } from '@/state/keys';
import { usePrWatches } from '@/github/pr-watches';
import { machineTransport } from '@/transport/index';

/* The watch a chat has on a machine, read now, for a command that is only offered while there is one. */
export function hasPrWatch(endpointId: string, chatId: string | undefined): boolean {
    return chatId !== undefined && usePrWatches.getState().byChat[endpointKey(endpointId, chatId)] !== undefined;
}

/* A person's Stop; the machine tells every client the watch is gone. */
export async function stopPrWatch(endpointId: string, chatId: string): Promise<void> {
    await machineTransport(endpointId).request('git.pr-unwatch', { chatId });
}
