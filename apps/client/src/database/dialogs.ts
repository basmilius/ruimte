import { lazyDialog } from '@adecore/ui';
import { useDatabasePanel } from '@/clients/database/state';
import type { DialogContribution } from '@/registry/dialogs';

const DatabaseConnectionsDialog = lazyDialog(
    () => import('@/database/ConnectionsDialog'),
    'DatabaseConnectionsDialog',
    useDatabasePanel,
    (s) => s.dialog.open
);

export const DATABASE_DIALOGS: readonly DialogContribution[] = [{ id: 'database-connections', surface: 'dialog', component: DatabaseConnectionsDialog }];
