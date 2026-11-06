import { launchActions } from '../actions/launch-actions.ts';
import { launchToolkit } from '../tools/launch-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const launchFeature = defineAgentFeature({
    name: 'launch',
    toolkit: launchToolkit,
    actions: launchActions,
    host: ({ launches }) => ({ launches: launches.agentHost })
});
