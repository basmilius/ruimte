import { databaseActions } from '../actions/database-actions.ts';
import type { DatabaseAgentHost } from '../database/agent-databases.ts';
import { databaseToolkit } from '../tools/database-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The databases of the caller's project as an agent may reach them; absent on a host without them. */
        databases?: DatabaseAgentHost;
    }
}

export const databaseFeature = defineAgentFeature({
    name: 'database',
    toolkit: databaseToolkit,
    actions: databaseActions,
    host: ({ databases }) => ({ databases: databases.agents })
});
