import { deviceActions } from '../actions/device-actions.ts';
import { deviceToolkit } from '../tools/device-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const deviceFeature = defineAgentFeature({
    name: 'device',
    toolkit: deviceToolkit,
    actions: deviceActions,
    host: ({ devices }) => ({ devices: devices.deviceDriver })
});
