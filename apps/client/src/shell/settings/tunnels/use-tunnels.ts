import { messageOf } from '@adecore/ui';
import type { Credential, RequestType, TunnelState } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

/*
 * The tunnels of one machine and the credentials of the clients elsewhere, read again whenever the machine says they
 * moved. Each change is a request that answers with the state it left, so the screen never waits for the event.
 */
export function useTunnels(endpointId: string) {
    const { t } = useTranslation('settings');
    const status = useEndpointConnection(endpointId).status;
    // The newest request of the section, so a machine with an older shape of the state offers no Tunnels.
    const answers = useMachineAnswers(endpointId, 'tunnel.link');
    const [state, setState] = useState<TunnelState | null>(null);
    const [credentials, setCredentials] = useState<Credential[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    const load = (): void => {
        const transport = transportFor(endpointId);

        if (!transport) {
            return;
        }

        transport
            .request('tunnel.state', {})
            .then((next) => {
                setState(next);
                setFailure(null);
            })
            .catch((e: unknown) => setFailure(messageOf(e, t('tunnels.loadFailed'))));
        // Only the local secret lists credentials; another client reads the state alone.
        transport
            .request('credential.list', {})
            .then((next) => setCredentials(next.credentials))
            .catch(() => setCredentials(null));
    };

    useEffect(() => {
        if (status !== 'open' || !answers) {
            return;
        }

        load();

        return transportFor(endpointId)?.on('tunnel.changed', load);
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [status, answers, endpointId]);

    /* A request that answers with the new state. A refusal shows as the sentence the machine gave. */
    const change = async (type: Extract<RequestType, `tunnel.${string}`>, payload: object = {}): Promise<void> => {
        const transport = transportFor(endpointId);

        if (!transport) {
            return;
        }

        try {
            const next = (await transport.request(type as 'tunnel.install', payload as never)) as TunnelState;

            setState(next);
            setFailure(null);
        } catch (e) {
            setFailure(messageOf(e, t('tunnels.changeFailed')));
        }
    };

    return { answers, open: status === 'open', state, credentials, failure, setFailure, load, change };
}
