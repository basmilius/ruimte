import { desktop } from '@/desktop/bridge';
import { followDevLinks, syncExtensions } from '@/extensions/loader';
import { extensionRequest } from '@/extensions/machine-request';
import { useEndpoints } from '@/state/endpoints';
import { isThisMachine } from '@/state/local-machine';
import { IS_STATION } from '@/station';
import type { Transport } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { watchPool } from '@/transport/pool-watch';

/* What this computer has installed, and what the machine on it has linked for development. */
export function startExtensions(): () => void {
    void syncExtensions();

    // Station runs what the machine of this window has, so another machine in the pool changes nothing.
    const stopFollowing = IS_STATION
        ? useEndpoints.subscribe((state, before) => {
              if (state.activeId !== before.activeId) {
                  void syncExtensions();
              }
          })
        : undefined;
    const stopWatching = watchPool((link: Transport, endpointId: string) => {
        const follow = (): void => {
            if (IS_STATION) {
                if (endpointId === useEndpoints.getState().activeId) {
                    void syncExtensions();
                }
            } else if (isThisMachine(endpointId)) {
                // A machine without extensions links none, and a link that fails is tried again on the next change.
                void fireAndForget(
                    'extensionRequest',
                    extensionRequest(link, 'extension.list', {}).then(({ extensions }) => followDevLinks(extensions))
                );
            }
        };

        return { onOpen: follow, subscriptions: [link.on('extension.changed', follow)] };
    });

    // Another window installed, removed or turned one off in the shell; this one may be on no machine to hear it otherwise.
    const stopShell = desktop()?.extensions?.onChanged?.(() => void syncExtensions());

    return () => {
        stopFollowing?.();
        stopWatching();
        stopShell?.();
    };
}
