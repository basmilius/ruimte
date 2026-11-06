import { browserActions } from '../actions/browser-actions.ts';
import { browserToolkit } from '../tools/browser-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const browserFeature = defineAgentFeature({
    name: 'browser',
    toolkit: browserToolkit,
    actions: browserActions,
    host: ({ devices }) => ({ browsers: devices.browserDriver })
});
