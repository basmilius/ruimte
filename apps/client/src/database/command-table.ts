import { Cable, Database, DatabaseZap, SquareTerminal } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const DATABASE_COMMANDS = {
    'database-console-new': {
        key: 'newDatabaseConsole',
        icon: SquareTerminal,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 50, when: (context) => context.workspace && !context.scratch }
    },
    'database-connections': {
        key: 'databaseConnections',
        icon: Cable,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 80, when: (context) => context.workspace && !context.scratch }
    },
    'database-schemas-refresh': {
        key: 'refreshSqlSchemas',
        icon: DatabaseZap,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 90, when: (context) => context.workspace && !context.scratch }
    },
    'panel-databases': {
        key: 'toggleDatabases',
        icon: Database,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 30, when: (context) => !context.scratch, checked: (context) => context.panel === 'databases' }
    }
} satisfies Record<string, CommandSpec>;
