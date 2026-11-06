import { databaseActions } from '../actions/database-actions.ts';
import { databaseToolkit } from '../tools/database-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const databaseFeature = defineAgentFeature({
    name: 'database',
    toolkit: databaseToolkit,
    actions: databaseActions,
    host: ({ databases }) => ({ databases: databases.agents })
});
