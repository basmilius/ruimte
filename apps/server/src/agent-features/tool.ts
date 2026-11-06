import { toolActions } from '../actions/tool-actions.ts';
import { toolToolkit } from '../tools/tool-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const toolFeature = defineAgentFeature({
    name: 'tool',
    toolkit: toolToolkit,
    actions: toolActions,
    host: ({ extensions }) => ({ extensions })
});
