import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionManager } from '@adecore/database';
import type { DatabaseAgentAccess, DatabaseConnection } from '@ruimte/contracts';
import { Database, KeyRound } from 'lucide-react';
import { Button, CloseButton, Dialog, Field, FormError, Icon, Select, Switch } from '@adecore/ui';
import {
    asViewConnections,
    databaseConnections,
    ensureDatabaseConnections,
    fromViewConnections,
    isOutsideProject,
    useDatabaseConnectionList,
    useDatabaseConnections,
    useWithheldPasswords
} from '@/database/connections';
import { databaseBrowse } from '@/database/environment';
import { RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { useDatabasePanel } from '@/database/state';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useConnection } from '@/transport/context';

/*
 * The connections of the project: every add, edit and delete is saved as it happens, the passwords
 * to this computer's secret store and the rest to the project. After its form fields a connection can
 * be shared with everyone who works on the project, and says what agents may do with it.
 */
export function DatabaseConnectionsDialog() {
    const { t } = useTranslation(['databases', 'common']);
    const open = useDatabasePanel((state) => state.dialog.open);
    const selected = useDatabasePanel((state) => state.dialog.selected);
    const saveError = useDatabaseConnections((state) => state.saveError);
    const connections = useDatabaseConnectionList();
    const withheld = useWithheldPasswords();
    const { endpointId } = useConnection();
    const browse = useMemo(() => databaseBrowse(endpointId, desktop()), [endpointId]);
    const shown = connections.find((connection) => connection.id === selected) ?? connections[0] ?? null;
    const held = shown === null ? undefined : withheld[shown.id];

    useEffect(() => {
        if (open) {
            ensureDatabaseConnections();
        }
    }, [open]);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => useDatabasePanel.getState().setConnectionsOpen(next)}>
            <Dialog.Popup className="flex h-[640px] w-[800px] flex-col overflow-hidden">
                <RuimteDatabaseProvider>
                    <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-4">
                        <Dialog.Title className="flex grow items-center gap-2">
                            <Icon icon={Database} size={16} /> {t('dialog.title')}
                        </Dialog.Title>
                        <CloseButton label={t('common:action.close')} dialog />
                    </div>
                    <Dialog.Description className="sr-only">{t('dialog.description')}</Dialog.Description>
                    {held !== undefined && (
                        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-5 py-2" role="status">
                            <Icon icon={KeyRound} size={14} className="shrink-0 text-status-needs-you" />
                            <span className="min-w-0 grow text-sm text-text">{t(`dialog.withheld.${held}`)}</span>
                        </div>
                    )}
                    <ConnectionManager
                        value={asViewConnections(connections)}
                        onValueChange={(next) => void databaseConnections.edit(fromViewConnections(next))}
                        selected={shown?.id ?? null}
                        onSelectedChange={(id) => useDatabasePanel.getState().selectConnection(id)}
                        onBrowse={browse}
                        renderFields={(connection) => {
                            const found = connections.find((entry) => entry.id === connection.id);
                            return found === undefined ? null : (
                                <>
                                    <ShareField connection={found} connections={connections} />
                                    <AgentsField connection={found} local={endpointId === LOCAL_ENDPOINT_ID} />
                                </>
                            );
                        }}
                        className="min-h-0 flex-1"
                    />
                    <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
                        <span className="min-w-0 grow">
                            {saveError !== null && <FormError className="truncate">{t('dialog.saveFailed', { reason: saveError })}</FormError>}
                        </span>
                        <Dialog.Close render={<Button variant="secondary" />}>{t('common:action.done')}</Dialog.Close>
                    </div>
                </RuimteDatabaseProvider>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Whether the connection goes into the repository's file or stays this person's. A SQLite file outside the project folder can only stay. */
function ShareField({ connection, connections }: { connection: DatabaseConnection; connections: readonly DatabaseConnection[] }) {
    const { t } = useTranslation('databases');
    const folder = useProject((state) => state.current?.folder ?? null);
    const outside = isOutsideProject(folder, connection);

    const share = (shared: boolean): void => {
        void databaseConnections.edit(connections.map((entry) => (entry.id === connection.id ? { ...entry, shared } : entry)));
    };

    return (
        <Field label={t('dialog.share.label')} hint={outside ? t('dialog.share.outside') : t('dialog.share.description')} orientation="horizontal" group>
            <Switch label={t('dialog.share.label')} checked={connection.shared && !outside} disabled={outside} onCheckedChange={share} />
        </Field>
    );
}

/*
 * What the agents of the project may do with the connection. The machine keeps the choice outside
 * the project, and lets agents write only when a person on that machine says so, which is why a
 * window on another computer cannot pick it.
 */
function AgentsField({ connection, local }: { connection: DatabaseConnection; local: boolean }) {
    const { t } = useTranslation('databases');
    const access = useDatabaseConnections((state) => state.agentAccess[connection.id] ?? 'read');
    const items = [
        { value: 'off' as const, label: t('dialog.agents.off') },
        { value: 'read' as const, label: t('dialog.agents.read') },
        { value: 'write' as const, label: t('dialog.agents.write'), ...(local ? {} : { description: t('dialog.agents.writeRemote'), disabled: true }) }
    ];

    const choose = (next: DatabaseAgentAccess): void => {
        void databaseConnections.setAgentAccess(connection.id, next);
    };

    return (
        <Field label={t('dialog.agents.label')} hint={t('dialog.agents.description')} orientation="horizontal" group>
            <Select<DatabaseAgentAccess> value={access} onValueChange={choose} items={items} label={t('dialog.agents.label')} />
        </Field>
    );
}
