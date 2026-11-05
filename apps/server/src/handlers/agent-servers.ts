import { CodedError } from '@adecore/agents';
import type { AgentKind } from '@ruimte/contracts';
import { type Dispatcher } from '../dispatcher.ts';
import type { AcpServerInstall } from '../providers/acp-server.ts';

export interface AgentServers {
    of(kind: AgentKind): AcpServerInstall | undefined;
    // Called after an Install, so the next `provider.list` asks again whether the provider is there.
    installed(kind: AgentKind): void;
}

/*
 * The chat servers that come apart from their CLI. Installing one downloads a program and makes it runnable
 * on this machine, so only the local secret may press Install; any client the machine let in may see where it stands.
 */
export function registerAgentServerHandlers(dispatcher: Dispatcher, servers: AgentServers): void {
    const serverOf = (kind: AgentKind): AcpServerInstall => {
        const server = servers.of(kind);
        if (server === undefined) {
            throw new CodedError('no-agent-server', `${kind} has no server of its own to install`);
        }
        return server;
    };

    dispatcher.register('provider.server', (payload) => ({ server: serverOf(payload.provider).status() }));

    dispatcher.register(
        'provider.installServer',
        async (payload) => {
            const server = await serverOf(payload.provider).install();
            servers.installed(payload.provider);
            return { server };
        },
        { owner: true }
    );
}
