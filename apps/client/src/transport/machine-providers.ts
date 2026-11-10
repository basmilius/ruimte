import { providerSinkFor } from '@adecore/agents-react/state';
import type { ProviderInfo } from '@ruimte/contracts';
import type { ConnectionState } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { pool } from '@/transport/index';

// The CLIs a machine forked before it listed `fork` among a provider's capabilities, in the same release as `project.watch`.
const FORKED_BEFORE_CAPABILITY: ReadonlySet<string> = new Set(['claude', 'codex']);

interface Received {
    providers: ProviderInfo[];
    namesFork: boolean;
}

// Per machine the list as it came, so a link that opens again naming other requests can put it through again.
const received = new Map<string, Received>();

function namesFork(connection: Pick<ConnectionState, 'features'> | undefined): boolean {
    return machineAnswers(connection, 'project.watch');
}

/* The providers as the client keeps them: a machine from before the `fork` capability gets the forks it offered then. */
export function providersOfMachine(connection: Pick<ConnectionState, 'features'> | undefined, providers: ProviderInfo[]): ProviderInfo[] {
    if (namesFork(connection)) {
        return providers;
    }

    return providers.map((provider) =>
        provider.capabilities.fork === undefined
            ? { ...provider, capabilities: { ...provider.capabilities, fork: FORKED_BEFORE_CAPABILITY.has(provider.kind) } }
            : provider
    );
}

/* Every list of providers a machine sends goes into the store through here. */
export function setMachineProviders(endpointId: string, providers: ProviderInfo[]): void {
    const connection = pool.statusOf(endpointId);

    received.set(endpointId, { providers, namesFork: namesFork(connection) });
    providerSinkFor(endpointId).setProviders(providersOfMachine(connection, providers));
}

/* What a machine's chat client fills, through the same door. */
export function machineProviderSink(endpointId: string): { setProviders(providers: ProviderInfo[]): void } {
    return {
        setProviders: (providers) => setMachineProviders(endpointId, providers)
    };
}

/* After a status change of the link; a closed link names no requests, so the list stays as the open one had it. */
export function reapplyMachineProviders(endpointId: string): void {
    const last = received.get(endpointId);
    const connection = pool.statusOf(endpointId);

    if (last === undefined || connection.status !== 'open' || last.namesFork === namesFork(connection)) {
        return;
    }

    setMachineProviders(endpointId, last.providers);
}

export function forgetMachineProviders(endpointId: string): void {
    received.delete(endpointId);
}
