import { computerActions } from '../actions/computer-actions.ts';
import type { ComputerHost } from '../computer/agent-host.ts';
import { computerToolkit } from '../tools/computer-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* Operating the apps of this machine through its helper; absent on a host without one. */
        computer?: ComputerHost;
    }
}

export const computerFeature = defineAgentFeature({
    name: 'computer',
    toolkit: computerToolkit,
    actions: computerActions,
    host: ({ devices }) => ({ computer: devices.computer })
});
