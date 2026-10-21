import { useEffect } from 'react';
import type { ProviderInfo } from '@ruimte/contracts';
import { useProvidersStore } from '@adecore/agents-react/state';
import { currentEndpointId, useEndpointId } from '@/state/keys';
import { pool, transportFor } from '@/transport';
import { machineAnswers } from './features';
import type { Transport } from './transport';

// The machine guards its own probes as well; this only keeps one client from asking on every menu it opens.
const DETECT_INTERVAL_MS = 10_000;

// Per link, so a machine that connected again, or a new machine in a test, is asked at once.
const askedAt = new WeakMap<Transport, number>();

/*
 * Asks a machine to look for its agent CLIs again, so one a person installed while Ruimte was open shows up
 * when they come back to it. A machine before `provider.detect` answers its list as it has it.
 */
export function detectProviders(endpointId: string): void {
    const link = transportFor(endpointId);
    const connection = pool.statusOf(endpointId);
    if (!link || connection.status !== 'open') {
        return;
    }
    const last = askedAt.get(link);
    if (last !== undefined && Date.now() - last < DETECT_INTERVAL_MS) {
        return;
    }
    askedAt.set(link, Date.now());
    const reply: Promise<{ providers: ProviderInfo[] }> = machineAnswers(connection, 'provider.detect')
        ? link.request('provider.detect', {})
        : link.request('provider.list', {});
    void reply.then(({ providers }) => useProvidersStore.getState().setProviders(endpointId, providers)).catch(() => undefined);
}

/* For a menu or pane that offers the machine's agents: asks again each time it opens. */
export function useDetectProviders(): void {
    const endpointId = useEndpointId();
    useEffect(() => detectProviders(endpointId), [endpointId]);
}

/* A window that gets the focus back asks for the machine it shows; one listener per window. */
export function startProviderDetection(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
    const onFocus = (): void => detectProviders(currentEndpointId());
    target.addEventListener('focus', onFocus);
    return () => target.removeEventListener('focus', onFocus);
}
