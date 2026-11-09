import { tunnelToolkit } from '../tools/tunnel-tools.ts';
import { tunnelAgentHost, type TunnelAgentHost } from '../tunnels/agent-host.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* This machine's tunnel as an agent reads it, and the cards in which it suggests a change; absent on a host without tunnels. */
        tunnels?: TunnelAgentHost;
    }
}

export const tunnelFeature = defineAgentFeature({
    name: 'tunnel',
    toolkit: tunnelToolkit,
    host: ({ later }) => ({ tunnels: tunnelAgentHost(() => later.tunnels()) })
});
