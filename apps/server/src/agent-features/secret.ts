import { secretActions } from '../actions/secret-actions.ts';
import { secretToolkit } from '../tools/secret-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const secretFeature = defineAgentFeature({
    name: 'secret',
    toolkit: secretToolkit,
    actions: secretActions,
    host: ({ launches }) => ({ secrets: launches.secrets })
});
