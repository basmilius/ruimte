import { Icon, IconButton, ScrollArea, SectionLabel, Tile } from '@adecore/ui';
import type { DevServer } from '@ruimte/contracts';
import clsx from 'clsx';
import { Cable, Globe, Link2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DEV_SERVER_PROBE_PORTS, devServerTiles, type DevServerTile } from '@/browser/dev-servers';
import { useDevTunnelRows, publicAddressOf } from '@/browser/dev-tunnel-rows';
import { openPage } from '@/browser/open-page';
import { useEndpointId } from '@/state/current-endpoint';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { fireAndForget } from '@/transport-api/transport';
import { useOptionalConnection } from '@/workspace/context';

/* How often the machine is asked again, so a server started after this node was opened shows up. */
const REFRESH_MS = 5_000;

/*
 * What a browser node shows before it has an address: the dev servers running on its machine, and
 * the ports one usually arrives on. Picking one gives the node its address, which is what starts the
 * page; the address bar over it does the same thing.
 *
 * A person on the machine itself can put a running port on a tunnel hostname here, for a browser outside Ruimte.
 */
export function BrowserSplash({ id, className }: { id: string; className?: string }) {
    const { t } = useTranslation('browser');
    const transport = useOptionalConnection()?.transport ?? null;
    const endpointId = useEndpointId();
    const [running, setRunning] = useState<readonly DevServer[]>([]);
    const isOwnMachine = endpointId === LOCAL_ENDPOINT_ID;
    const tunnelRows = useDevTunnelRows(endpointId, isOwnMachine);

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

    function tunnelAction(tile: DevServerTile): ReactNode {
        if (!isOwnMachine || !tile.running) {
            return null;
        }

        const address = publicAddressOf(tunnelRows, tile.port);

        return address !== null ? (
            <IconButton icon={Link2} size="sm" label={t('splash.tunnel.copyPublic', { address })} onClick={() => void navigator.clipboard.writeText(address)} />
        ) : (
            <IconButton
                icon={Cable}
                size="sm"
                label={t('splash.tunnel.putOnTunnel')}
                onClick={() => useUi.getState().setSettings({ open: true, section: 'tunnels' })}
            />
        );
    }

    const section = (label: string, list: DevServerTile[]): ReactNode => (
        <section className="flex flex-col gap-2">
            <SectionLabel render={<h2 />} className="px-1">
                {label}
            </SectionLabel>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {list.map((tile) => (
                    <div key={tile.port} className="flex flex-col gap-1">
                        <Tile
                            icon={tile.running ? <span className="size-2 rounded-full bg-positive" /> : <Icon icon={Globe} size={16} />}
                            title={`localhost:${tile.port}`}
                            description={tile.detail}
                            onClick={() => openPage(id, tile.url)}
                        />
                        {tunnelAction(tile)}
                    </div>
                ))}
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
        </ScrollArea>
    );
}
