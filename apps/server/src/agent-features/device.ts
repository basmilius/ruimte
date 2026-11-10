import { deviceActions } from '../actions/device-actions.ts';
import type { DeviceDriveHost } from '../devices/agent-host.ts';
import { deviceToolkit } from '../tools/device-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* Seeing, starting and operating the devices of this machine; absent on a host without devices. */
        devices?: DeviceDriveHost;
    }
}

export const deviceFeature = defineAgentFeature({
    name: 'device',
    toolkit: deviceToolkit,
    actions: deviceActions,
    host: ({ devices }) => ({ devices: devices.deviceDriver })
});
