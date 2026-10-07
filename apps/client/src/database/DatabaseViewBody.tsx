import { useTranslation } from 'react-i18next';
import { Unplug } from 'lucide-react';
import type { ProjectDatabaseView } from '@ruimte/contracts';
import { Button, EmptyState } from '@adecore/ui';
import { DatabaseBody } from '@/database/DatabaseTabBody';
import { useDatabasePanel } from '@/database/state';

/*
 * A database view of the project: the table of a connection as its rows or its structure, drawn the way
 * the same table is in a loose tab. A connection that this machine does not have, or whose password has to
 * be entered again, leaves the cell with a way to the connections instead of an error, since the view came
 * from a colleague's file and nothing here is broken.
 */
export function DatabaseViewBody({ view }: { view: ProjectDatabaseView }) {
    const { t } = useTranslation('databases');
    return (
        <DatabaseBody
            stateKey={view.id}
            needsPassword
            surface={
                view.mode === 'data'
                    ? { kind: 'table', connectionId: view.connectionId, schema: view.schema, table: view.table, where: view.where }
                    : { kind: 'structure', connectionId: view.connectionId, schema: view.schema, table: view.table }
            }
            unavailable={(reason) => (
                <EmptyState
                    icon={Unplug}
                    className="h-full"
                    action={
                        <Button size="sm" variant="secondary" onClick={() => useDatabasePanel.getState().openConnections(view.connectionId)}>
                            {t('view.manage')}
                        </Button>
                    }
                >
                    {t(reason === 'gone' ? 'view.gone' : 'view.withheld', { table: view.table })}
                </EmptyState>
            )}
        />
    );
}
