import { followDevLinks, syncExtensions } from '@/extensions/loader';
import { isThisMachine } from '@/state/local-machine';
import { watchPool } from '@/transport/pool-watch';
import type { Transport } from '@/transport';

/* What this computer has installed, and what the machine on it has linked for development. */
export function startExtensions(): () => void {
    void syncExtensions();

    return watchPool((link: Transport, endpointId: string) => {
        const follow = (): void => {
            if (isThisMachine(endpointId)) {
                void link.request('extension.list', {}).then(({ extensions }) => followDevLinks(extensions));
            }
        };

        return { onOpen: follow, subscriptions: [link.on('extension.changed', follow)] };
    });
}
