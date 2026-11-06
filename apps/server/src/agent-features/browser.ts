import { browserActions } from '../actions/browser-actions.ts';
import type { BrowserDriveHost } from '../browser/agent-host.ts';
import { browserToolkit } from '../tools/browser-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* Driving the page under a browser node, wherever that page is open; absent on a host without one. */
        browsers?: BrowserDriveHost;
    }
}

export const browserFeature = defineAgentFeature({
    name: 'browser',
    toolkit: browserToolkit,
    actions: browserActions,
    host: ({ devices }) => ({ browsers: devices.browserDriver })
});
