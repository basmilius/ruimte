import type { PortGrant } from '@ruimte/contracts';
import { create } from 'zustand';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { machineTransport } from '@/transport';
import { grantForUrl, currentProjectId, usePortGrants } from './grants';
import { PortStreamHub } from './stream-client';
import { PortTunnelHost } from './tunnel-host';

interface TunnelPage {
    readonly endpointId: string;
    readonly grantId: string;
    readonly tunnelId: string;
    readonly partition: string;
    readonly host: PortTunnelHost;
    readonly stopWatching: () => void;
}

interface TunnelPartitions {
    /* The partition of each page that is ready, so a node redraws when its tunnel is. */
    byKey: Record<string, string>;
}

export const usePortTunnelPartitions = create<TunnelPartitions>(() => ({ byKey: {} }));

export type TunnelRoute = { kind: 'none' } | { kind: 'pending' } | { kind: 'ready'; partition: string };

/*
 * The pages of browser nodes that show a port shared on another machine. Each has a tunnel in the shell, a
 * session of its own, and a host here that carries its bytes over the connection the client already has to that
 * machine. A node on this machine, or an address with no grant of this project, has none.
 */
class PortTunnelPages {
    private readonly pages = new Map<string, TunnelPage>();
    private readonly preparing = new Map<string, string>();
    private watching = false;

    /* Whether this shell can open a tunnel at all; an older shell, or the web client, cannot. */
    supported(): boolean {
        const shell = desktop();

        return (
            shell !== null &&
            typeof shell.openPortTunnel === 'function' &&
            typeof shell.onPortTunnel === 'function' &&
            typeof shell.portTunnelSend === 'function'
        );
    }

    /* The grant that would carry this address, for a page of a machine other than this one. */
    grantFor(endpointId: string, url: string): PortGrant | null {
        if (endpointId === LOCAL_ENDPOINT_ID || !this.supported()) {
            return null;
        }

        return grantForUrl(usePortGrants.getState().byEndpoint[endpointId], url, currentProjectId());
    }

    /* What the page of `key` needs for `url`: nothing, a tunnel that is being made, or the partition of a ready one. */
    routeFor(key: string, endpointId: string, url: string): TunnelRoute {
        const grant = this.grantFor(endpointId, url);

        if (grant === null) {
            // The address left the shared port, so the session made for it goes. A list that has not loaded says nothing.
            if (usePortGrants.getState().byEndpoint[endpointId] !== undefined) {
                this.release(key);
            }

            return { kind: 'none' };
        }

        const page = this.pages.get(key);

        if (page !== undefined && page.grantId === grant.id) {
            return { kind: 'ready', partition: page.partition };
        }

        this.prepare(key, endpointId, grant);

        return { kind: 'pending' };
    }

    partitionOf(key: string): string | null {
        return this.pages.get(key)?.partition ?? null;
    }

    /* Ends the tunnel of a page, for a node that went or an address that left the shared port. */
    release(key: string): void {
        this.preparing.delete(key);

        const page = this.pages.get(key);

        if (page === undefined) {
            return;
        }

        this.pages.delete(key);
        page.stopWatching();
        page.host.dispose('The page closed');
        desktop()?.closePortTunnel?.(page.tunnelId);
        usePortTunnelPartitions.setState((state) => {
            const byKey = { ...state.byKey };

            delete byKey[key];

            return { byKey };
        });
    }

    private prepare(key: string, endpointId: string, grant: PortGrant): void {
        const wanted = `${grant.id}:${grant.port}`;
        const shell = desktop();

        if (this.preparing.get(key) === wanted || shell?.openPortTunnel === undefined) {
            return;
        }

        this.release(key);
        this.preparing.set(key, wanted);
        this.watchGrants();

        void shell
            .openPortTunnel({ endpointId, grantId: grant.id, port: grant.port })
            .then((opened) => {
                // The page moved on, or the shell said no, while it was opening.
                if (this.preparing.get(key) !== wanted || opened === null) {
                    if (opened !== null) {
                        shell.closePortTunnel?.(opened.id);
                    }

                    this.preparing.delete(key);

                    return;
                }

                const transport = machineTransport(endpointId);
                const hub = new PortStreamHub(transport);
                const host = new PortTunnelHost({
                    id: opened.id,
                    grantId: grant.id,
                    shell: { onPortTunnel: shell.onPortTunnel!, portTunnelSend: shell.portTunnelSend! },
                    hub
                });
                // A lost link takes the streams with it, and the daemon cannot say so.
                const stopWatching = transport.subscribeStatus((status) => {
                    if (status === 'closed') {
                        hub.abortAll('The connection to the machine was lost');
                    }
                });

                host.start();
                this.preparing.delete(key);
                this.pages.set(key, { endpointId, grantId: grant.id, tunnelId: opened.id, partition: opened.partition, host, stopWatching });
                usePortTunnelPartitions.setState((state) => ({ byKey: { ...state.byKey, [key]: opened.partition } }));
            })
            .catch(() => this.preparing.delete(key));
    }

    /* A grant that is stopped takes the tunnels made from it with it. */
    private watchGrants(): void {
        if (this.watching) {
            return;
        }

        this.watching = true;
        usePortGrants.subscribe((state) => {
            for (const [key, page] of [...this.pages]) {
                const grants = state.byEndpoint[page.endpointId];

                if (grants !== undefined && !grants.some((grant) => grant.id === page.grantId)) {
                    this.release(key);
                }
            }
        });
    }
}

export const portTunnelPages = new PortTunnelPages();
