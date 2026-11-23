import type { AgentKind, AgentServerStatus } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import { type Dispatcher } from '../dispatcher.ts';

/*
 * The chat servers that came apart from their CLI. Antigravity's was the last, and its chats now run on `agy acp`,
 * so a client of an older Ruimte that still asks hears that there is none to install, which hides its server section.
 */
export function agentServersArea(): Area {
    return { name: 'agent servers', handlers: registerRequests };
}

function noServer(provider: AgentKind): { server: AgentServerStatus } {
    return { server: { provider, state: 'unsupported', version: '', installed: null } };
}

function registerRequests(dispatcher: Dispatcher): void {
    dispatcher.register('provider.server', (payload) => noServer(payload.provider));
    dispatcher.register('provider.installServer', (payload) => noServer(payload.provider), { owner: true });
}
