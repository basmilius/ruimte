import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Database, Unplug } from 'lucide-react';
import { StructureView, TableDesigner, TableView, useDatabaseClient, type Connection } from '@adecore/database';
import { Button, EmptyState, Icon } from '@adecore/ui';
import { asViewConnections, ensureDatabaseConnections, useDatabaseConnectionList, useDatabaseConnections } from '@/database/connections';
import { DatabaseTabProvider, RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { useFiles, type DatabaseTab } from '@/state/files';

/*
 * One database tab of the files cell: a table's rows, its structure or the designer, on the connection the
 * tab names, with where the table is at the start of the view's own bar. Each tab answers its views' actions
 * itself, so a designer that saved a table turns its own tab into that table's designer.
 */
export function DatabaseTabBody({ tab }: { tab: DatabaseTab }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();
    const status = useDatabaseConnections((state) => state.status);
    const found = connections.find((connection) => connection.id === tab.connectionId);

    useEffect(() => ensureDatabaseConnections(), []);

    if (found === undefined) {
        // While the list is read a tab cannot know yet whether its connection is still there.
        return status === 'ready' ? (
            <EmptyState
                icon={Unplug}
                className="h-full"
                action={
                    <Button size="sm" variant="secondary" onClick={() => useFiles.getState().close(tab.key)}>
                        {t('tab.close')}
                    </Button>
                }
            >
                {t('tab.gone')}
            </EmptyState>
        ) : null;
    }
    const [connection] = asViewConnections([found]);
    if (connection === undefined) {
        return null;
    }
    const location = <DatabaseLocation connection={connection} schema={tab.schema} />;

    return (
        <RuimteDatabaseProvider>
            <DatabaseTabProvider tabKey={tab.key}>
                <TableKindCheck tab={tab} connection={connection} />
                {tab.kind === 'table' && (
                    <TableView
                        connection={connection}
                        schema={tab.schema}
                        table={tab.table}
                        toolbarStart={location}
                        defaultWhere={tab.where}
                        onDirtyChange={(dirty) => useFiles.getState().setUnsubmitted(tab.key, dirty)}
                        className="h-full"
                    />
                )}
                {tab.kind === 'structure' && (
                    <StructureView connection={connection} schema={tab.schema} table={tab.table} toolbarStart={location} className="h-full" />
                )}
                {tab.kind === 'designer' && (
                    <TableDesigner connection={connection} schema={tab.schema} table={tab.table} toolbarStart={location} className="h-full" />
                )}
            </DatabaseTabProvider>
        </RuimteDatabaseProvider>
    );
}

/* What the database says the table of a tab is, which corrects a tab that was opened without knowing or before the table became a view. */
function TableKindCheck({ tab, connection }: { tab: DatabaseTab; connection: Connection }) {
    const client = useDatabaseClient();
    const table = tab.kind === 'designer' ? undefined : tab.table;
    const { key, schema } = tab;

    useEffect(() => {
        if (table === undefined) {
            return;
        }
        const controller = new AbortController();
        client
            .session(connection)
            .tables(schema, { signal: controller.signal })
            .then((tables) => {
                const kind = tables.find((entry) => entry.name === table)?.kind;
                if (kind !== undefined) {
                    useFiles.getState().setTableKind(key, kind);
                }
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [client, connection, key, schema, table]);

    return null;
}

/* Where the tab's table is, at the start of the view's own bar; the tab names the table itself. */
function DatabaseLocation({ connection, schema }: { connection: Connection; schema: string }) {
    const { t } = useTranslation('databases');
    return (
        <nav aria-label={t('tab.where')} className="flex min-w-0 shrink items-center gap-1 text-xs text-text-muted">
            <Icon icon={Database} size={14} className="shrink-0" />
            <span className="max-w-40 truncate">{connection.name}</span>
            <Icon icon={ChevronRight} size={12} className="shrink-0 text-text-faint" />
            <span className="max-w-40 truncate text-text">{schema}</span>
        </nav>
    );
}
