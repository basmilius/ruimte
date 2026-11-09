import { messageOf } from '@adecore/ui';
import type { Credential, RequestType, TunnelState } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

export type TunnelChangeType = Extract<RequestType, `tunnel.${string}`>;

export type TunnelChange = (type: TunnelChangeType, payload?: object) => Promise<void>;

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

    /* A request that answers with the new state, or the sentence the machine refused it with, for a dialog to show itself. */
    const attempt = async (type: TunnelChangeType, payload: object = {}): Promise<string | null> => {
        const transport = transportFor(endpointId);

        if (!transport) {
            return null;
        }

        try {
            setState((await transport.request(type as 'tunnel.install', payload as never)) as TunnelState);

            return null;
        } catch (e) {
            return messageOf(e, t('tunnels.changeFailed'));
        }
    };

    /* A request whose refusal shows under the section. */
    const change = async (type: TunnelChangeType, payload: object = {}): Promise<void> => {
        setFailure(await attempt(type, payload));
    };

    return { answers, open: status === 'open', state, credentials, failure, load, attempt, change };
}
