import { portShareHost, type PortShareHost } from '../ports/agent-host.ts';
import { portToolkit } from '../tools/port-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* Sharing a development port with the person's other devices; absent on a host without ports. */
        ports?: PortShareHost;
    }
}

export const portFeature = defineAgentFeature({
    name: 'port',
    toolkit: portToolkit,
    host: ({ identity, later }) => ({ ports: portShareHost({ allowed: () => identity.agentsSharePorts, grants: () => later.ports().grants }) })
});
