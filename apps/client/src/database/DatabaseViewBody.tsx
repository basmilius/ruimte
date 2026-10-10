import { useTranslation } from 'react-i18next';
import { Unplug } from 'lucide-react';
import type { ProjectDatabaseView } from '@ruimte/contracts';
import { Button, EmptyState } from '@adecore/ui';
import { DatabaseBody } from '@/database/DatabaseTabBody';
import { useDatabasePanel } from '@/database/state';

/*
 * A database view of the project, drawn the way the same table is in a loose tab. A connection this machine
 * lacks, or whose password has to be entered again, offers the connections instead of an error, since the
 * view may come from a colleague's file.
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
