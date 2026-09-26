import type { ChatScope } from '@ruimte/agents-react/scope';
import { endpointKey } from '@/state/keys';
import { machineTransport } from '@/transport';
import { chatClient, chatClientFor } from '@/transport/connections';

const scopes = new Map<string, ChatScope>();

/*
 * One machine as the chat sees it: its rows keyed on the machine, its transport, and its chat client.
 * The same object for as long as the id stands, so what reads it through a context is not redrawn.
 * Both are looked up when asked for, since a row that learns its daemon id moves them under the new id.
 */
export const chatScopeOf = (endpointId: string): ChatScope => {
    let scope = scopes.get(endpointId);
    if (scope === undefined) {
        scope = {
            id: endpointId,
            keyOf: (chatId) => endpointKey(endpointId, chatId),
            get transport() {
                return machineTransport(endpointId);
            },
            // A machine this client no longer knows has no clients; the active machine's stand in, as they always did here.
            get chats() {
                return chatClientFor(endpointId) ?? chatClient;
            }
        };
        scopes.set(endpointId, scope);
    }
    return scope;
};
