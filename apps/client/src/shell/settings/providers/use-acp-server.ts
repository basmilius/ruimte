import { useEffect, useState } from 'react';
import type { AgentKind, AgentServerStatus } from '@ruimte/contracts';
import { useProvidersStore } from '@adecore/agents-react/state';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface AcpServer {
    /* Null while the machine has not answered, or answers no `provider.server`. */
    server: AgentServerStatus | null;
    error: string | null;
    /* Only the app on the machine itself may install it, since that downloads a program and makes it runnable there. */
    local: boolean;
    install(): Promise<void>;
}

/* Where the chat server of a CLI that ships one apart (Antigravity's) stands on a machine, and its install. */
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
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (e) {
            setError(messageOf(e));
            setServer((await link.request('provider.server', { provider: kind }).catch(() => null))?.server ?? server);
        }
    }

    return { server: answers ? server : null, error, local: endpointId === LOCAL_ENDPOINT_ID, install };
}
