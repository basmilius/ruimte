import type { HostsAgentHost } from '../hosts/agent-host.ts';
import { hostToolkit } from '../tools/host-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The code hosts and issue trackers of a project as an agent reads them; absent on a host that reads none. */
        hosts?: HostsAgentHost;
    }
}

export const hostFeature = defineAgentFeature({
    name: 'hosts',
    toolkit: hostToolkit,
    host: ({ hosts }) => ({ hosts: { hosts: hosts.hosts, links: hosts.links } })
});
