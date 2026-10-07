import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Container, Database, KeyRound, Plus, Settings2, SquareTerminal } from 'lucide-react';
import { connectionFromContainer, containerTitle, DatabaseExplorer, useDatabaseClient } from '@adecore/database';
import type { DockerContainer } from '@adecore/database/protocol';
import type { DatabaseConnection } from '@ruimte/contracts';
import { Button, ButtonGroup, Icon, IconButton, ListRow, PanelEmpty, SectionLabel } from '@adecore/ui';
import {
    asViewConnections,
    databaseConnections,
    ensureDatabaseConnections,
    fromViewConnections,
    useDatabaseConnectionList,
    useDatabaseConnections,
    useWithheldPasswords
} from '@/database/connections';
import { containersFor } from '@/database/docker';
import { RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { openNewConsole } from '@/database/console-file';
import { useConsoleFolders } from '@/database/console-folders';
import { useDatabasePanel } from '@/database/state';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { basenameOf } from '@/shell/panels/files-tree';
import { useProject } from '@/state/project';

/*
 * The connections of the project, with their schemas, tables and columns, and the consoles of each. A table
 * or a console opens in the files cell on a click, the way a file does in the files panel, and a double click
 * keeps its tab. The keyboard stays in the tree, since the next arrow key is the tree's.
 */
export function DatabasesPanel() {
    useEffect(() => ensureDatabaseConnections(), []);
    return (
        <RuimteDatabaseProvider keepTableFocus>
            <div className="flex min-h-0 grow flex-col">
                <DatabasesPanelBody />
            </div>
        </RuimteDatabaseProvider>
    );
}

function DatabasesPanelBody() {
    const { t } = useTranslation(['databases', 'common']);
    const status = useDatabaseConnections((state) => state.status);
    const error = useDatabaseConnections((state) => state.error);
    const connections = useDatabaseConnectionList();
    const selection = useDatabasePanel((state) => state.selection);
    const consoles = useConsoleFolders();

    const header = (
        <PanelHeaderSlot>
            <span className="grow" />
            <ButtonGroup>
                <IconButton icon={SquareTerminal} label={t('panel.newConsole')} disabled={connections.length === 0} onClick={() => void openNewConsole()} />
                <IconButton icon={Settings2} label={t('panel.manage')} onClick={() => useDatabasePanel.getState().openConnections()} />
            </ButtonGroup>
        </PanelHeaderSlot>
    );

    if (status === 'failed') {
        return (
            <>
                {header}
                <PanelEmpty
                    icon={CircleAlert}
                    action={
                        <Button size="sm" variant="secondary" onClick={() => void databaseConnections.reload()}>
                            {t('common:action.retry')}
                        </Button>
                    }
                >
                    {t('panel.failed', { reason: error ?? '' })}
                </PanelEmpty>
            </>
        );
    }
    if (status !== 'ready') {
        return (
            <>
                {header}
                <PanelEmpty busy>{t('panel.reading')}</PanelEmpty>
            </>
        );
    }
    if (connections.length === 0) {
        return (
            <>
                {header}
                <NoConnections />
            </>
        );
    }
    return (
        <>
            {header}
            <WithheldPasswords connections={connections} />
            <DatabaseExplorer
                connections={asViewConnections(connections)}
                value={selection}
                onValueChange={(next) => useDatabasePanel.getState().setSelection(next)}
                openOnClick
                folders={consoles.folders}
                className="min-h-0 grow"
            />
            {consoles.dialogs}
        </>
    );
}

/* A connection pointed elsewhere outside Ruimte opens without its saved password until a person enters it again. */
function WithheldPasswords({ connections }: { connections: readonly DatabaseConnection[] }) {
    const { t } = useTranslation('databases');
    const withheld = useWithheldPasswords();

    return (
        <>
            {connections.map((connection) => {
                const reason = withheld[connection.id];
                if (reason === undefined) {
                    return null;
                }
                return (
                    <div key={connection.id} className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                        <Icon icon={KeyRound} size={14} className="shrink-0 text-status-needs-you" />
                        <span className="min-w-0 grow text-xs text-text">
                            {t(`panel.withheld.${reason}`, { name: connection.name || t('console.untitled') })}
                        </span>
                        <Button size="sm" variant="secondary" onClick={() => useDatabasePanel.getState().openConnections(connection.id)}>
                            {t('panel.withheld.enter')}
                        </Button>
                    </div>
                );
            })}
        </>
    );
}

/* A project without connections: a way to add one, and the database containers running on the machine, the project's own first. */
function NoConnections() {
    const { t } = useTranslation('databases');
    const client = useDatabaseClient();
    const folder = useProject((state) => state.current?.folder ?? null);
    const [containers, setContainers] = useState<readonly DockerContainer[]>([]);

    useEffect(() => {
        let live = true;
        // Without Docker, or with it stopped, there is simply nothing to offer.
        client
            .discover('docker')
            .then((found) => {
                if (live) {
                    setContainers(found);
                }
            })
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [client]);

    const offered = containersFor(containers, folder === null ? null : basenameOf(folder));

    const add = (container: DockerContainer): void => {
        void databaseConnections.edit(fromViewConnections([connectionFromContainer(crypto.randomUUID(), container)]));
    };

    return (
        <div className="flex min-h-0 grow flex-col">
            <PanelEmpty
                icon={Database}
                action={
                    <Button size="sm" variant="secondary" onClick={() => useDatabasePanel.getState().openConnections()}>
                        <Icon icon={Plus} size={14} /> {t('panel.add')}
                    </Button>
                }
            >
                {t('panel.empty')}
            </PanelEmpty>
            {offered.length > 0 && (
                <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
                    <SectionLabel className="px-2 py-1">{t('panel.containers')}</SectionLabel>
                    {offered.map((container) => (
                        <ListRow key={container.id} variant="inset" className="gap-2 hover:bg-surface-hover">
                            <Icon icon={Container} size={14} className="shrink-0 text-text-muted" />
                            <span className="flex min-w-0 grow flex-col">
                                <span className="truncate text-sm text-text">{containerTitle(container)}</span>
                            </span>
                            <span className="min-w-0 shrink truncate text-xs text-text-faint">{container.image}</span>
                            <IconButton
                                icon={Plus}
                                size="sm"
                                label={t('panel.addContainer', { name: containerTitle(container) })}
                                onClick={() => add(container)}
                            />
                        </ListRow>
                    ))}
                </div>
            )}
        </div>
    );
}
