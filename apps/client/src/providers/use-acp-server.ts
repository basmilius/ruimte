import { messageOf } from '@adecore/ui';
import type { AgentKind, AgentServerStatus } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { listProvidersAgain } from '@/providers/use-provider-installs';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';
import { transportFor } from '@/transport/index';

export interface AcpServer {
    server: AgentServerStatus | null;
    error: string | null;
    /* Only the app on the machine itself may install it, since that downloads a program and makes it runnable there. */
    local: boolean;
    install(): Promise<void>;
}

export function useAcpServer(endpointId: string, kind: AgentKind): AcpServer {
    const answers = useMachineAnswers(endpointId, 'provider.server');
    const [server, setServer] = useState<AgentServerStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link || !answers) {
            return;
        }
        let live = true;
        link.request('provider.server', { provider: kind }).then(
            (result) => {
                if (live) {
                    setServer(result.server);
                }
            },
            (e: unknown) => {
                if (live) {
                    setError(messageOf(e));
                }
            }
        );
        return () => {
            live = false;
        };
    }, [endpointId, answers, kind]);

    async function install(): Promise<void> {
        const link = transportFor(endpointId);
        if (!link || server === null) {
            return;
        }
        setError(null);
        setServer({ ...server, state: 'installing' });
        try {
            setServer((await link.request('provider.installServer', { provider: kind })).server);
            await listProvidersAgain(endpointId);
        } catch (e) {
            setError(messageOf(e));
            setServer((await orNull('provider.server', link.request('provider.server', { provider: kind })))?.server ?? server);
        }
    }

    return { server: answers ? server : null, error, local: endpointId === LOCAL_ENDPOINT_ID, install };
}
