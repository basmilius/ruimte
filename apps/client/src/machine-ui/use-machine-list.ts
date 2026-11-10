import { messageOf } from '@adecore/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { transportFor, type Transport } from '@/transport';
import { useEndpointConnection } from '@/transport/status';

export type ListWords = 'machine.access' | 'machine.links' | 'machine.clients';

/* A list the machine behind the socket keeps, so it loads again on every reconnect. */
export function useMachineList<Item>(endpointId: string, enabled: boolean, read: (transport: Transport) => Promise<Item[]>, words: ListWords) {
    const { t } = useTranslation('settings');
    const status = useEndpointConnection(endpointId).status;
    const [items, setItems] = useState<Item[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    const load = (): void => {
        const transport = transportFor(endpointId);

        if (!transport) {
            return;
        }

        read(transport)
            .then((next) => {
                setItems(next);
                setFailure(null);
            })
            .catch((e: unknown) => setFailure(messageOf(e, t(`${words}.listFailed`))));
    };

    useEffect(() => {
        if (status === 'open' && enabled) {
            load();
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [status, enabled, endpointId]);

    return { open: status === 'open', items, failure, setFailure, load };
}
