import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Container, Database, Plus, Settings2, SquareTerminal } from 'lucide-react';
import { DatabaseExplorer, useDatabaseClient } from '@adecore/database';
import type { DockerContainer } from '@adecore/database/protocol';
import { Button, ButtonGroup, Icon, IconButton, ListRow, PanelEmpty, SectionLabel } from '@adecore/ui';
import { asViewConnections, databaseConnections, ensureDatabaseConnections, useDatabaseConnectionList, useDatabaseConnections } from '@/database/connections';
import { containerConnection, containersFor, containerTitle } from '@/database/docker';
import { RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { openNewConsole, useDatabaseTabs } from '@/database/state';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { basenameOf } from '@/shell/panels/files-tree';
import { useProject } from '@/state/project';

/*
 * The connections of the project, with their schemas, tables and columns. What a row opens lands in
 * the databases cell; a table leaves the keyboard in the tree, since the next arrow key is the tree's.
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
    const selection = useDatabaseTabs((state) => state.selection);

    const header = (
        <PanelHeaderSlot>
            <span className="grow" />
            <ButtonGroup>
                <IconButton icon={SquareTerminal} label={t('panel.newConsole')} disabled={connections.length === 0} onClick={() => void openNewConsole()} />
                <IconButton icon={Settings2} label={t('panel.manage')} onClick={() => useDatabaseTabs.getState().openConnections()} />
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
            <DatabaseExplorer
                connections={asViewConnections(connections)}
                value={selection}
                onValueChange={(next) => useDatabaseTabs.getState().setSelection(next)}
                className="min-h-0 grow"
            />
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
        void databaseConnections.edit([containerConnection(crypto.randomUUID(), container)]);
    };

    return (
        <div className="flex min-h-0 grow flex-col">
            <PanelEmpty
                icon={Database}
                action={
                    <Button size="sm" variant="secondary" onClick={() => useDatabaseTabs.getState().openConnections()}>
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
