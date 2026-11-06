import { Button, Icon, Menu } from '@adecore/ui';
import { formatMoment } from '@adecore/ui/format';
import { choiceFor, startDatabaseOf, storedPathOf, type DatabaseConnection, type SqlBinding, type SqlChoice } from '@ruimte/contracts';
import { ChevronDown, Database } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDatabasePanel } from '@/clients/database/state';
import { databaseClientFor } from '@/database/client';
import { asViewConnections, connectionName, ensureDatabaseConnections, useDatabaseConnectionList } from '@/database/connections';
import { ensureSqlBindings, refreshSqlSchemas, snapshotOf, sqlBindings, useSqlBindings } from '@/database/sql-bindings';
import { endpointKey } from '@/state/keys';
import { shownFolderOf, useProject } from '@/state/project';
import { useConnection } from '@/workspace/context';

/* The value of the choices that are no connection, which no connection id can be. */
const DEFAULT = 'default:';
const NONE = 'none:';
const CONNECTION = 'connection:';

/* The databases of a server connection, read when its submenu opens; empty for a SQLite file and while they are on their way. */
function useDatabases(connection: DatabaseConnection, open: boolean): string[] {
    const { endpointId } = useConnection();
    const projectId = useProject((state) => state.current?.projectId ?? '');
    const [databases, setDatabases] = useState<string[]>([]);

    useEffect(() => {
        if (!open || connection.config.engine !== 'mysql') {
            return;
        }
        let live = true;
        const [view] = asViewConnections([connection]);
        databaseClientFor(endpointKey(endpointId, projectId))
            .session(view!, 'sql-choice')
            .schemas()
            .then((schemas) => {
                if (live) {
                    setDatabases(schemas.filter((schema) => !schema.system).map((schema) => schema.name));
                }
            })
            // A connection that does not open here has no list to offer; the choice of the connection itself still stands.
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [open, connection, endpointId, projectId]);

    return databases;
}

/*
 * Which connection and database the SQL of a `.sql` file is read against, in the bar above its editor: the
 * project's default, no schema at all, or a connection of the project and one of its databases. The choice
 * is the person's own and the machine keeps it in the private project file; the language servers follow it
 * at once. A console reads the connection of its folder and has its own picker in its bar.
 */
export function SqlBindingPicker({ path }: { path: string }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();
    const sql = useSqlBindings((state) => state.sql);
    const snapshots = useSqlBindings((state) => state.snapshots);
    const folder = useProject((state) => shownFolderOf(state.current));

    useEffect(() => {
        ensureDatabaseConnections();
        ensureSqlBindings();
    }, []);

    const stored = folder === null ? path : storedPathOf(folder, path);
    const choice = choiceFor(folder, sql, connections, path);
    if (choice.source === 'console') {
        return null;
    }
    const bound = choice.source === 'none' || choice.source === 'unbound' ? null : choice;
    const connection = bound?.connection;
    const label =
        connection === undefined || bound === null
            ? t('sql.none')
            : bound.database === null || bound.database === startDatabaseOf(connection)
              ? connectionName(connection)
              : t('sql.connectionDatabase', { name: connectionName(connection), database: bound.database });
    const own = sql.files?.[stored];
    const value = own === undefined ? DEFAULT : own.connectionId === null ? NONE : `${CONNECTION}${own.connectionId}`;
    const fallback = sql.default === undefined ? undefined : connections.find((entry) => entry.id === sql.default?.connectionId);
    const bind = (binding: SqlBinding | null): void => void sqlBindings.bind(path, binding);

    return (
        <Menu.Root>
            <Menu.Trigger render={<Button size="sm" variant="ghost" aria-label={t('sql.label', { choice: label })} />}>
                <Icon icon={Database} size={12} />
                <span className="max-w-48 truncate">{label}</span>
                <Icon icon={ChevronDown} size={12} />
            </Menu.Trigger>
            <Menu.Popup align="end" className="min-w-64">
                <Menu.Group>
                    <Menu.GroupLabel>{t('sql.thisFile')}</Menu.GroupLabel>
                    <Menu.RadioGroup
                        value={value}
                        onValueChange={(next: string) => {
                            if (next === DEFAULT) {
                                bind(null);
                            } else if (next === NONE) {
                                bind({ connectionId: null });
                            } else {
                                bind({ connectionId: next.slice(CONNECTION.length) });
                            }
                        }}
                    >
                        <Menu.RadioItem value={DEFAULT}>
                            {fallback === undefined ? t('sql.projectDefaultNone') : t('sql.projectDefault', { name: connectionName(fallback) })}
                        </Menu.RadioItem>
                        <Menu.RadioItem value={NONE}>{t('sql.noneItem')}</Menu.RadioItem>
                        {connections.map((entry) =>
                            entry.config.engine === 'mysql' ? (
                                <DatabaseSubmenu
                                    key={entry.id}
                                    connection={entry}
                                    checked={own?.connectionId === entry.id}
                                    database={own?.connectionId === entry.id ? (own.database ?? null) : null}
                                    onPick={(database) => bind({ connectionId: entry.id, ...(database === null ? {} : { database }) })}
                                />
                            ) : (
                                <Menu.RadioItem key={entry.id} value={`${CONNECTION}${entry.id}`}>
                                    {connectionName(entry)}
                                </Menu.RadioItem>
                            )
                        )}
                    </Menu.RadioGroup>
                </Menu.Group>
                {connections.length === 0 && <Menu.Item onClick={() => useDatabasePanel.getState().openConnections()}>{t('sql.addConnection')}</Menu.Item>}
                <Menu.Separator />
                <Menu.Group>
                    <Menu.GroupLabel>{t('sql.defaultSection')}</Menu.GroupLabel>
                    {own?.connectionId != null &&
                        connection !== undefined &&
                        (sql.default?.connectionId !== own.connectionId || sql.default.database !== own.database) && (
                            <Menu.Item onClick={() => void sqlBindings.bind(undefined, own)}>{t('sql.makeDefault', { name: label })}</Menu.Item>
                        )}
                    {sql.default !== undefined && <Menu.Item onClick={() => void sqlBindings.bind(undefined, null)}>{t('sql.clearDefault')}</Menu.Item>}
                    {fallback === undefined && (own?.connectionId == null || connection === undefined) && <Menu.Label>{t('sql.noDefault')}</Menu.Label>}
                </Menu.Group>
                {connection !== undefined && bound !== null && (
                    <>
                        <Menu.Separator />
                        <SnapshotStatus choice={bound} snapshots={snapshots} />
                    </>
                )}
            </Menu.Popup>
        </Menu.Root>
    );
}

/* A server connection with its databases one level in: the database it starts in, or another one. */
function DatabaseSubmenu({
    connection,
    checked,
    database,
    onPick
}: {
    connection: DatabaseConnection;
    checked: boolean;
    database: string | null;
    onPick: (database: string | null) => void;
}) {
    const { t } = useTranslation('databases');
    const [open, setOpen] = useState(false);
    const databases = useDatabases(connection, open);
    const start = startDatabaseOf(connection);

    return (
        <Menu.SubmenuRoot open={open} onOpenChange={setOpen}>
            <Menu.SubmenuTrigger>
                <span className="flex min-w-0 grow items-center gap-2">
                    <Menu.Check kind="radio" checked={checked} />
                    <span className="truncate">{connectionName(connection)}</span>
                </span>
            </Menu.SubmenuTrigger>
            <Menu.Popup className="min-w-48">
                <Menu.RadioGroup
                    value={checked ? (database ?? '') : null}
                    onValueChange={(next: string) => {
                        onPick(next === '' ? null : next);
                    }}
                >
                    <Menu.RadioItem value="">{start === null ? t('sql.allDatabases') : t('sql.startDatabase', { database: start })}</Menu.RadioItem>
                    {databases
                        .filter((name) => name !== start)
                        .map((name) => (
                            <Menu.RadioItem key={name} value={name}>
                                {name}
                            </Menu.RadioItem>
                        ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

/* Whether the machine read the schema of the choice yet, and when; reading it again is one press. */
function SnapshotStatus({ choice, snapshots }: { choice: Exclude<SqlChoice, { source: 'none' | 'unbound' }>; snapshots: Parameters<typeof snapshotOf>[0] }) {
    const { t } = useTranslation('databases');
    const { connection } = choice;
    const snapshot = snapshotOf(snapshots, connection.id, choice.database);

    return (
        <Menu.Group>
            <Menu.Label>
                {snapshot === null
                    ? t('sql.noSnapshot', { name: connectionName(connection) })
                    : t('sql.snapshot', { count: snapshot.tables, time: formatMoment(new Date(snapshot.takenAt)) })}
            </Menu.Label>
            <Menu.Item onClick={() => void refreshSqlSchemas(connection.id)}>{t('sql.refresh')}</Menu.Item>
        </Menu.Group>
    );
}
