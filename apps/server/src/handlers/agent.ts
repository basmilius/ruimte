import type { AgentHandler, AgentHandlers } from '@ruimte/agents/host/handlers';
import { translate, type Dispatcher } from '../dispatcher.ts';

/* Registers requests the chat host in `@ruimte/agents` answers as well, through the very same handlers. */
export const registerAgentHandlers = <T extends keyof AgentHandlers>(dispatcher: Dispatcher, handlers: { [K in T]: AgentHandler<K> }): void => {
    for (const type of Object.keys(handlers) as T[]) {
        const handler = handlers[type] as AgentHandler<keyof AgentHandlers>;
        dispatcher.register(type, (payload, client) => translate(() => handler(payload as never, client.id)) as never);
    }
};
