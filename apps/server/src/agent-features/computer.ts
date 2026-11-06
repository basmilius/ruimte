import { computerActions } from '../actions/computer-actions.ts';
import { computerToolkit } from '../tools/computer-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const computerFeature = defineAgentFeature({
    name: 'computer',
    toolkit: computerToolkit,
    actions: computerActions,
    host: ({ devices }) => ({ computer: devices.computer })
});
