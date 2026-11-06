import { contextActions } from '../actions/context-actions.ts';
import { contextToolkit } from '../tools/context-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const contextFeature = defineAgentFeature({
    name: 'context',
    toolkit: contextToolkit,
    actions: contextActions,
    host: ({ agents }) => ({ context: agents.context })
});
