import { ToolRefusal } from '@adecore/agents/context';
import { PORT_HOSTS } from '@ruimte/contracts';
import { z } from 'zod';
import { PortGrantError } from '../ports/port-grants.ts';
import { placeOf } from './host.ts';
import { defineTool } from './tool.ts';

export const portShare = defineTool('browser', {
    name: 'port_share',
    description: "Shares a dev server's port with the person's other devices, or stops a share you made. Needs the machine's Agents setting.",
    input: z.object({
        port: z
            .number({ error: 'port needs a port number' })
            .int('port is a whole number')
            .min(1, 'port is 1 to 65535')
            .max(65535, 'port is 1 to 65535')
            .optional(),
        host: z
            .enum(PORT_HOSTS, { error: `host takes ${PORT_HOSTS.join(' or ')}` })
            .optional()
            .describe('Where the server listens, 127.0.0.1 unless it listens on IPv6 only'),
        stop: z.boolean({ error: 'stop is true or false' }).optional().describe('Ends a share you made')
    }),
    async run(input, call) {
        const ports = call.host.ports;

        if (ports === undefined) {
            throw new ToolRefusal('unsupported', 'This host shares no ports');
        }

        if (!ports.allowed()) {
            throw new ToolRefusal('setting-off', 'A person has not let agents share ports', [
                "setting\tagentsSharePorts in this machine's endpoint.json lets agents share a dev port; a person turns it on under Agents in Settings"
            ]);
        }

        const { projectId } = placeOf(call);

        if (input.port === undefined) {
            return ports.list(projectId).map((grant) => `shared\t${grant.port}\t${grant.host}\t${grant.sharedBy}`);
        }

        const host = input.host ?? '127.0.0.1';

        if (input.stop === true) {
            return [
                ports.stop(projectId, input.port, host)
                    ? `stopped\t${input.port}\t${host}`
                    : `unchanged\t${input.port}\t${host}\tNo share of an agent was there to stop`
            ];
        }

        // A person shares any port; an agent shares a dev server, never whatever else listens on loopback.
        const launched = ((await call.host.launches?.list(projectId)) ?? []).some((launch) => launch.port === input.port);

        if (!launched && !(await ports.answersHttp(input.port, host))) {
            throw new ToolRefusal(
                'not-a-dev-server',
                `Nothing answers HTTP on ${host === '::1' ? '[::1]' : host} port ${input.port}, and no launch of this project uses it; start the dev server first`
            );
        }

        try {
            const grant = ports.share(projectId, input.port, host);

            return [`shared\t${grant.port}\t${grant.host}\t${grant.sharedBy}`];
        } catch (e) {
            if (e instanceof PortGrantError) {
                throw new ToolRefusal(e.code, e.message);
            }

            throw e;
        }
    }
});
