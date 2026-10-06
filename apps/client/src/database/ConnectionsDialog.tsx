import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionManager } from '@adecore/database';
import type { DatabaseConnection } from '@ruimte/contracts';
import { Button, Dialog, FormError, Switch } from '@adecore/ui';
import {
    asViewConnections,
    databaseConnections,
    ensureDatabaseConnections,
    fromViewConnections,
    isOutsideProject,
    useDatabaseConnectionList,
    useDatabaseConnections
} from '@/database/connections';
import { databaseBrowse } from '@/database/environment';
import { RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { useDatabaseTabs } from '@/database/state';
import { desktop } from '@/desktop/bridge';
import { useProject } from '@/state/project';
import { useConnection } from '@/transport/context';

/*
 * The connections of the project: every add, edit and delete is saved as it happens, the passwords
 * to this computer's secret store and the rest to the project. Under the manager the connection it
 * shows can be shared with everyone who works on the project.
 */
export function DatabaseConnectionsDialog() {
    const { t } = useTranslation(['databases', 'common']);
    const open = useDatabaseTabs((state) => state.dialog.open);
    const selected = useDatabaseTabs((state) => state.dialog.selected);
    const saveError = useDatabaseConnections((state) => state.saveError);
    const connections = useDatabaseConnectionList();
    const { endpointId } = useConnection();
    const browse = useMemo(() => databaseBrowse(endpointId, desktop()), [endpointId]);
    const shown = connections.find((connection) => connection.id === selected) ?? connections[0] ?? null;

    useEffect(() => {
        if (open) {
            ensureDatabaseConnections();
        }
    }, [open]);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => useDatabaseTabs.getState().setConnectionsOpen(next)}>
            <Dialog.Popup className="flex h-[600px] w-[900px] flex-col overflow-hidden">
                <RuimteDatabaseProvider>
                    <div className="shrink-0 border-b border-border px-4 py-3">
                        <Dialog.Title>{t('dialog.title')}</Dialog.Title>
                    </div>
                    <ConnectionManager
                        value={asViewConnections(connections)}
                        onValueChange={(next) => void databaseConnections.edit(fromViewConnections(next))}
                        selected={shown?.id ?? null}
                        onSelectedChange={(id) => useDatabaseTabs.getState().selectConnection(id)}
                        onBrowse={browse}
                        className="min-h-0 flex-1"
                    />
                    {shown !== null && <ShareRow connection={shown} connections={connections} />}
                    <Dialog.Footer className="mt-0 shrink-0 border-t border-border px-4 py-3">
                        {saveError !== null && <FormError className="mr-auto min-w-0 truncate">{t('dialog.saveFailed', { reason: saveError })}</FormError>}
                        <Dialog.Close render={<Button variant="secondary" />}>{t('common:action.done')}</Dialog.Close>
                    </Dialog.Footer>
                </RuimteDatabaseProvider>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Whether the connection goes into the repository's file or stays this person's. A SQLite file outside the project folder can only stay. */
function ShareRow({ connection, connections }: { connection: DatabaseConnection; connections: readonly DatabaseConnection[] }) {
    const { t } = useTranslation('databases');
    const folder = useProject((state) => state.current?.folder ?? null);
    const outside = isOutsideProject(folder, connection);

    const share = (shared: boolean): void => {
        void databaseConnections.edit(connections.map((entry) => (entry.id === connection.id ? { ...entry, shared } : entry)));
    };

    return (
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3">
            <div className="flex min-w-0 grow flex-col">
                <span className="text-sm text-text">{t('dialog.share.label')}</span>
                <span className="text-sm text-text-muted">{outside ? t('dialog.share.outside') : t('dialog.share.description')}</span>
            </div>
            <Switch label={t('dialog.share.label')} checked={connection.shared && !outside} disabled={outside} onCheckedChange={share} />
        </div>
    );
}
