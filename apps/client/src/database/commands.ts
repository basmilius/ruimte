import { useDatabasePanel } from '@/clients/database/state';
import { defineBehaviors } from '@/commands/behavior';
import { openNewConsole } from '@/database/console-file';
import { refreshSqlSchemas } from '@/database/sql-bindings';
import { useUi } from '@/state/ui';

const inProject = { offered: (moment: { inWorkspace: boolean; scratch: boolean }) => moment.inWorkspace && !moment.scratch };

export const DATABASE_BEHAVIORS = defineBehaviors({
    'database-console-new': { run: () => void openNewConsole(), ...inProject },
    'database-connections': { run: () => useDatabasePanel.getState().openConnections(), ...inProject },
    'database-schemas-refresh': { run: () => void refreshSqlSchemas(), ...inProject },
    'panel-databases': { run: () => useUi.getState().togglePanel('databases'), ...inProject }
});
