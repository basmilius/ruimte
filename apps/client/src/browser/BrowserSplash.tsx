import { Button, Icon, IconButton, ScrollArea, SectionLabel, Tile } from '@adecore/ui';
import { ConfirmDialog } from '@adecore/ui/settings';
import type { DevServer, PortGrant } from '@ruimte/contracts';
import clsx from 'clsx';
import { Cable, Globe, Link2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DEV_SERVER_PROBE_PORTS, devServerTiles, type DevServerTile } from '@/browser/dev-servers';
import { openPage } from '@/browser/open-page';
import { isDesktop } from '@/desktop/bridge';
import { useDevTunnelRows, publicAddressOf } from '@/port-tunnel/dev-tunnel-rows';
import { currentProjectId, usePortGrants, usePortGrantWatch } from '@/port-tunnel/grants';
import { portTunnelPages } from '@/port-tunnel/tunnel-pages';
import { useEndpointId } from '@/state/current-endpoint';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { fireAndForget } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';
import { useOptionalConnection } from '@/workspace/context';

/* How often the machine is asked again, so a server started after this node was opened shows up. */
const REFRESH_MS = 5_000;

/*
 * What a browser node shows before it has an address: the dev servers running on its machine, and
 * the ports one usually arrives on. Picking one gives the node its address, which is what starts the
 * page; the address bar over it does the same thing.
 *
 * A person on the machine itself can share a running port with their other devices here, and put it on a
 * tunnel hostname for a browser outside Ruimte. Another desktop opens only what was shared.
 */
export function BrowserSplash({ id, className }: { id: string; className?: string }) {
    const { t } = useTranslation('browser');
    const transport = useOptionalConnection()?.transport ?? null;
    const endpointId = useEndpointId();
    const machine = useEndpoints((store) => store.endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? '');
    const [running, setRunning] = useState<readonly DevServer[]>([]);
    const grants = usePortGrants((store) => store.byEndpoint[endpointId]);
    const answersList = useMachineAnswers(endpointId, 'port.list');
    const isOwnMachine = endpointId === LOCAL_ENDPOINT_ID;
    const answersShare = useMachineAnswers(endpointId, 'port.share');
    const canShare = isOwnMachine && answersShare;
    const projectId = currentProjectId();
    const tunnelRows = useDevTunnelRows(endpointId, canShare);
    const [asking, setAsking] = useState<number | null>(null);

    usePortGrantWatch(endpointId);

    useEffect(() => {
        if (transport === null) {
            return;
        }
        let alive = true;
        const ask = (): void => {
            void fireAndForget(
                'browser.devServers',
                transport.request('browser.devServers', { ports: DEV_SERVER_PROBE_PORTS }).then((answer) => {
                    if (alive) {
                        setRunning(answer.servers);
                    }
                })
            );
        };
        ask();
        const timer = setInterval(ask, REFRESH_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [transport]);

    const tiles = devServerTiles(running);
    const live = tiles.filter((tile) => tile.running);
    const rest = tiles.filter((tile) => !tile.running);
    const grantOf = (port: number): PortGrant | undefined => grants?.find((grant) => grant.port === port && grant.projectId === projectId);

    // A desktop page of another machine opens only a port that machine shares; elsewhere the machine draws the page itself.
    const behindTunnel = isDesktop() && !isOwnMachine;
    const tunnelSupported = portTunnelPages.supported();

    function reasonFor(tile: DevServerTile): string | null {
        if (!behindTunnel || grantOf(tile.port) !== undefined) {
            return null;
        }

        if (!tunnelSupported) {
            return t('splash.share.oldApp');
        }

        return answersList ? t('splash.share.notShared', { machine }) : t('splash.share.oldMachine', { machine });
    }

    async function share(port: number): Promise<void> {
        if (transport === null || projectId === null) {
            return;
        }

        try {
            await transport.request('port.share', { projectId, port });
        } catch (e) {
            useToasts
                .getState()
                .show({ id: 'port-share', kind: 'error', title: t('splash.share.failed'), description: e instanceof Error ? e.message : undefined });
        }
    }

    async function stop(grant: PortGrant): Promise<void> {
        try {
            await transport?.request('port.revoke', { id: grant.id });
        } catch (e) {
            useToasts
                .getState()
                .show({ id: 'port-share', kind: 'error', title: t('splash.share.stopFailed'), description: e instanceof Error ? e.message : undefined });
        }
    }

    function actions(tile: DevServerTile): ReactNode {
        const grant = grantOf(tile.port);

        if (!canShare || !tile.running) {
            return grant !== undefined && behindTunnel ? <span className="px-1 text-xs text-text-muted">{t('splash.share.sharedBy', { machine })}</span> : null;
        }

        const address = publicAddressOf(tunnelRows, tile.port);

        return (
            <div className="flex items-center gap-1">
                {grant === undefined ? (
                    <Button variant="ghost" size="sm" onClick={() => setAsking(tile.port)}>
                        {t('splash.share.action')}
                    </Button>
                ) : (
                    <Button variant="ghost" size="sm" onClick={() => void stop(grant)}>
                        {t('splash.share.stop')}
                    </Button>
                )}
                {address !== null ? (
                    <IconButton
                        icon={Link2}
                        size="sm"
                        label={t('splash.share.copyPublic', { address })}
                        onClick={() => void navigator.clipboard.writeText(address)}
                    />
                ) : (
                    <IconButton
                        icon={Cable}
                        size="sm"
                        label={t('splash.share.putOnTunnel')}
                        onClick={() => useUi.getState().setSettings({ open: true, section: 'tunnels' })}
                    />
                )}
            </div>
        );
    }

    const section = (label: string, list: DevServerTile[]): ReactNode => (
        <section className="flex flex-col gap-2">
            <SectionLabel render={<h2 />} className="px-1">
                {label}
            </SectionLabel>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {list.map((tile) => {
                    const reason = reasonFor(tile);

                    return (
                        <div key={tile.port} className="flex flex-col gap-1">
                            <Tile
                                icon={tile.running ? <span className="size-2 rounded-full bg-positive" /> : <Icon icon={Globe} size={16} />}
                                title={`localhost:${tile.port}`}
                                description={reason ?? tile.detail}
                                disabled={reason !== null}
                                onClick={() => openPage(id, tile.url)}
                            />
                            {actions(tile)}
                        </div>
                    );
                })}
            </div>
        </section>
    );

    return (
        <ScrollArea className={clsx('bg-surface-sunken', className)} viewportClassName="px-4 py-6">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
                <header className="flex flex-col gap-1 px-1">
                    <span className="text-sm font-medium text-text">{t('splash.title')}</span>
                    <span className="text-xs text-text-muted">{t('splash.hint')}</span>
                </header>
                {live.length > 0 && section(t('splash.running'), live)}
                {section(t('splash.common'), rest)}
            </div>
            <ConfirmDialog
                open={asking !== null}
                onOpenChange={(next) => (next ? undefined : setAsking(null))}
                title={t('splash.share.confirm.title', { port: asking ?? 0 })}
                description={t('splash.share.confirm.description', { port: asking ?? 0, machine })}
                confirmLabel={t('splash.share.confirm.action')}
                onConfirm={async () => {
                    const port = asking;

                    if (port !== null) {
                        await share(port);
                    }
                }}
            />
        </ScrollArea>
    );
}
