import type { RequestMap, RequestType } from '@ruimte/contracts';
import { machineTransport, pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import type { Transport } from '../transport-api/transport';

/* A request the machine takes with nothing in it, which is what a watch and its end are. */
export type BareRequest = { [K in RequestType]: Record<string, never> extends RequestMap[K]['payload'] ? K : never }[RequestType];

/*
 * One watch of a machine, held while a surface needs it. It asks the machine to watch on an open link
 * and again after every reconnect, and lets go on the way out. `listen` binds what the caller hears
 * from the link; `refresh` reads the caller's lists again whenever a link has just opened.
 */
export function startMachineWatch(
    endpointId: string,
    { watch, unwatch, refresh, listen }: { watch: BareRequest; unwatch: BareRequest; refresh(): void; listen(transport: Transport): (() => void)[] }
): () => void {
    const transport = machineTransport(endpointId);
    const ask = (): void => {
        if (transport.status === 'open' && machineAnswers(pool.statusOf(endpointId), watch)) {
            transport.request(watch, {}).catch(() => undefined);
        }
    };
    const offListen = listen(transport);
    const offStatus = transport.subscribeStatus((status) => {
        if (status === 'open') {
            ask();
            refresh();
        }
    });

    ask();

    return () => {
        for (const off of offListen) {
            off();
        }

        offStatus();

        if (transport.status === 'open' && machineAnswers(pool.statusOf(endpointId), unwatch)) {
            transport.request(unwatch, {}).catch(() => undefined);
        }
    };
}
