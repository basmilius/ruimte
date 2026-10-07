import { useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Database, Unplug } from 'lucide-react';
import { StructureView, TableDesigner, TableView, useDatabaseClient, type Connection } from '@adecore/database';
import type { TableKind } from '@adecore/database/protocol';
import { Button, EmptyState, Icon } from '@adecore/ui';
import { asViewConnections, ensureDatabaseConnections, useDatabaseConnectionList, useDatabaseConnections, useWithheldPasswords } from '@/database/connections';
import { DatabaseTabProvider, RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { useFiles, type DatabaseTab } from '@/state/files';

/* What a database body draws: a table's rows, its structure or the designer, and the filter the rows open with. */
export type DatabaseSurface =
    | { kind: 'table'; connectionId: string; schema: string; table: string; where?: string | undefined }
    | { kind: 'structure'; connectionId: string; schema: string; table: string }
    | { kind: 'designer'; connectionId: string; schema: string; table?: string | undefined };

/*
 * A table, its structure or its designer on the connection it names, with where the table is at the start
 * of the view's own bar. A loose tab and a database view of the project draw the same body, so the toolbar
 * and the guards are one thing; `stateKey` is what a body with edits nobody submitted is remembered under,
 * and `unavailable` is what stands in the cell when the connection is not there. Each body answers its
 * views' actions itself, so a designer that saved a table turns its own tab into that table's designer.
 */
export function DatabaseBody({
    stateKey,
    surface,
    unavailable,
    onTableKind,
    needsPassword = false
}: {
    stateKey: string;
    surface: DatabaseSurface;
    unavailable: (reason: 'gone' | 'withheld') => ReactNode;
    /* What the database says the table is, for a body that keeps it. */
    onTableKind?: (kind: TableKind) => void;
    /* A password a person has to enter again leaves the cell empty rather than a table that cannot sign in. */
    needsPassword?: boolean;
}) {
    const connections = useDatabaseConnectionList();
    const status = useDatabaseConnections((state) => state.status);
    const withheld = useWithheldPasswords();
    const found = connections.find((connection) => connection.id === surface.connectionId);

    useEffect(() => ensureDatabaseConnections(), []);
    // The edits go with the body, so a view that comes back later does not claim edits it no longer holds.
    useEffect(() => () => useFiles.getState().setUnsubmitted(stateKey, false), [stateKey]);

    if (found === undefined) {
        // While the list is read a body cannot know yet whether its connection is still there.
        return status === 'ready' ? unavailable('gone') : null;
    }
    if (needsPassword && withheld[found.id] !== undefined) {
        return unavailable('withheld');
    }
    const [connection] = asViewConnections([found]);
    if (connection === undefined) {
        return null;
    }
    const location = <DatabaseLocation connection={connection} schema={surface.schema} />;

    return (
        <RuimteDatabaseProvider>
            <DatabaseTabProvider tabKey={stateKey}>
                {onTableKind !== undefined && surface.kind !== 'designer' && (
                    <TableKindCheck connection={connection} schema={surface.schema} table={surface.table} onKind={onTableKind} />
                )}
                {surface.kind === 'table' && (
                    <TableView
                        connection={connection}
                        schema={surface.schema}
                        table={surface.table}
                        toolbarStart={location}
                        defaultWhere={surface.where}
                        onDirtyChange={(dirty) => useFiles.getState().setUnsubmitted(stateKey, dirty)}
                        className="h-full"
                    />
                )}
                {surface.kind === 'structure' && (
                    <StructureView connection={connection} schema={surface.schema} table={surface.table} toolbarStart={location} className="h-full" />
                )}
                {surface.kind === 'designer' && (
                    <TableDesigner connection={connection} schema={surface.schema} table={surface.table} toolbarStart={location} className="h-full" />
                )}
            </DatabaseTabProvider>
        </RuimteDatabaseProvider>
    );
}

/* One database tab of a tab host. */
export function DatabaseTabBody({ tab }: { tab: DatabaseTab }) {
    const { t } = useTranslation('databases');
    const onTableKind = useCallback((kind: TableKind) => useFiles.getState().setTableKind(tab.key, kind), [tab.key]);
    return (
        <DatabaseBody
            stateKey={tab.key}
            surface={tab}
            onTableKind={onTableKind}
            unavailable={() => (
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
            )}
        />
    );
}

/* What the database says the table is, which corrects a tab that was opened without knowing or before the table became a view. */
function TableKindCheck({ connection, schema, table, onKind }: { connection: Connection; schema: string; table: string; onKind: (kind: TableKind) => void }) {
    const client = useDatabaseClient();

    useEffect(() => {
        const controller = new AbortController();
        client
            .session(connection)
            .tables(schema, { signal: controller.signal })
            .then((tables) => {
                const kind = tables.find((entry) => entry.name === table)?.kind;
                if (kind !== undefined) {
                    onKind(kind);
                }
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [client, connection, onKind, schema, table]);

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
