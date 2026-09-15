import { useEndpoints } from '@/state/endpoints';
import { serverInfoOf, useServers } from '@/state/server';
import { pool, transportFor } from '@/transport';
import { usePulsarAccount, withAccessToken } from './account';
import { AutoRegistrar } from './auto-register';
import { refreshAccountMachines, usePulsarMachines } from './machines';

/*
 * Wires `AutoRegistrar` to what this client knows: the account it is signed in to, the list the address
 * book last answered, and the machines whose connection is open. The daemon signs, this client posts
 * with its own session, as the button did. A sweep runs when any of those or what a machine says about
 * itself change, and once more when
 * the earliest machine that failed may be asked again.
 */
export const startAutoRegistration = (): (() => void) => {
    const registrar = new AutoRegistrar({
        sign: async (endpointId, accountId) => {
            const link = transportFor(endpointId);
            if (!link) {
                throw new Error('That machine is no longer in the list');
            }
            return (await link.request('endpoint.signRegistration', { accountId })).registration;
        },
        register: async (payload) => {
            await withAccessToken((client, token) => client.registerMachine(token, payload));
        }
    });

    let queued = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let listAsked: string | null = null;
    const statusOffs = new Map<string, () => void>();

    const sweep = async (): Promise<void> => {
        const { status, account } = usePulsarAccount.getState();
        const accountId = status === 'signed-in' ? (account?.id ?? null) : null;
        registrar.setAccount(accountId);
        if (accountId === null) {
            listAsked = null;
            return;
        }
        const { machines, removedMachineIds } = usePulsarMachines.getState();
        if (machines === null) {
            // Signing in, or a restart that restored a session: the list is what says what is missing.
            if (listAsked !== accountId) {
                listAsked = accountId;
                void refreshAccountMachines();
            }
            return;
        }
        const list = { records: new Map(machines.map((machine) => [machine.id, machine])), removed: new Set(removedMachineIds) };
        const { endpoints } = useEndpoints.getState();
        const open = endpoints.filter((endpoint) => endpoint.daemonId !== null && pool.statusOf(endpoint.id).status === 'open');
        const outcomes = await Promise.all(
            open.map((endpoint) => {
                const { label, icon } = serverInfoOf(endpoint.id);
                // The label and the broker arrive in one `endpoint.info`, so a known label means the broker is known too.
                const current =
                    label === null || endpoint.daemonPublicKey === null
                        ? null
                        : { name: label, icon, brokerUrl: endpoint.brokerUrl ?? null, publicKey: endpoint.daemonPublicKey };
                return registrar.consider(endpoint.id, endpoint.daemonId!, list, current);
            })
        );
        if (outcomes.some((outcome) => outcome === 'registered' || outcome === 'removed')) {
            await refreshAccountMachines();
        }
        const retryAt = registrar.nextRetryAt();
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        if (retryAt !== null) {
            retryTimer = setTimeout(queue, Math.max(0, retryAt - Date.now()));
        }
    };

    // Several stores change in one tick when a connection opens; one sweep is enough for all of them.
    const queue = (): void => {
        if (queued) {
            return;
        }
        queued = true;
        setTimeout(() => {
            queued = false;
            void sweep().catch((e: unknown) => console.warn('Adding machines to the account failed', e));
        }, 0);
    };

    const watchStatuses = (): void => {
        const ids = new Set(pool.ids());
        for (const [endpointId, off] of statusOffs) {
            if (!ids.has(endpointId)) {
                off();
                statusOffs.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            if (!statusOffs.has(endpointId)) {
                statusOffs.set(endpointId, pool.subscribeStatus(endpointId, queue));
            }
        }
    };

    watchStatuses();
    const offPool = pool.subscribe(() => {
        watchStatuses();
        queue();
    });
    const offAccount = usePulsarAccount.subscribe(queue);
    const offMachines = usePulsarMachines.subscribe(queue);
    const offEndpoints = useEndpoints.subscribe(queue);
    // `endpoint.changed` lands here, so a machine renamed from any client updates its record.
    const offServers = useServers.subscribe(queue);
    queue();

    return () => {
        offPool();
        offAccount();
        offMachines();
        offEndpoints();
        offServers();
        for (const off of statusOffs.values()) {
            off();
        }
        statusOffs.clear();
        if (retryTimer) {
            clearTimeout(retryTimer);
        }
    };
};
