import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DevServer } from '@ruimte/contracts';
import { DEV_SERVER_PROBE_PORTS, devServerTiles, type DevServerTile } from '@/browser/dev-servers';
import { openPage } from '@/browser/open-page';
import { useOptionalConnection } from '@/transport/context';
import { SECTION_LABEL } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { Tile } from '@ruimte/ui/Tile';

/* How often the machine is asked again, so a server started after this node was opened shows up. */
const REFRESH_MS = 5_000;

/*
 * What a browser node shows before it has an address: the dev servers running on its machine, and
 * the ports one usually arrives on. Picking one gives the node its address, which is what starts the
 * page; the address bar over it does the same thing.
 */
export function BrowserSplash({ id, className }: { id: string; className?: string }) {
    const { t } = useTranslation('browser');
    const transport = useOptionalConnection()?.transport ?? null;
    const [running, setRunning] = useState<readonly DevServer[]>([]);

    useEffect(() => {
        if (transport === null) {
            return;
        }
        let alive = true;
        const ask = (): void => {
            transport
                .request('browser.devServers', { ports: DEV_SERVER_PROBE_PORTS })
                .then((answer) => {
                    if (alive) {
                        setRunning(answer.servers);
                    }
                })
                .catch(() => undefined);
        };
        ask();
        const timer = setInterval(ask, REFRESH_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [transport]);

    const tiles = useMemo(() => devServerTiles(running), [running]);
    const live = tiles.filter((tile) => tile.running);
    const rest = tiles.filter((tile) => !tile.running);

    const section = (label: string, list: DevServerTile[]): ReactNode => (
        <section className="flex flex-col gap-2">
            <h2 className={`${SECTION_LABEL} px-1`}>{label}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {list.map((tile) => (
                    <Tile
                        key={tile.port}
                        icon={tile.running ? <span className="size-2 rounded-full bg-positive" /> : <Icon icon={Globe} size={16} />}
                        title={`localhost:${tile.port}`}
                        description={tile.detail}
                        onClick={() => openPage(id, tile.url)}
                    />
                ))}
            </div>
        </section>
    );

    return (
        <div className={clsx('min-h-0 overflow-auto bg-surface-sunken px-4 py-6', className)}>
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
                <header className="flex flex-col gap-1 px-1">
                    <span className="text-sm font-medium text-text">{t('splash.title')}</span>
                    <span className="text-xs text-text-muted">{t('splash.hint')}</span>
                </header>
                {live.length > 0 && section(t('splash.running'), live)}
                {section(t('splash.common'), rest)}
            </div>
        </div>
    );
}
