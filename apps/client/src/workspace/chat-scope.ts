import type { ChatScope } from '@adecore/agents-react';
import { ChatClient } from '@adecore/agents-react/chat';
import { chatSinkFor } from '@/state/chats';
import { endpointKey, isOfEndpoint } from '@/state/keys';
import { DormantTransport } from '@/transport/dormant-transport';
import { machineTransport } from '@/transport/index';
import { chatClientFor } from '@/workspace/connections';

const scopes = new Map<string, ChatScope>();
const strangers = new Map<string, ChatClient>();

/* The chats of a machine this client has no row for: every request refuses with `no-machine`, so none lands on the active machine. */
function strangerChats(endpointId: string): ChatClient {
    let chats = strangers.get(endpointId);
    if (chats === undefined) {
        chats = new ChatClient(new DormantTransport(), chatSinkFor(endpointId));
        strangers.set(endpointId, chats);
    }
    return chats;
}

/*
 * One machine as the chat sees it: its rows keyed on the machine, its transport, and its chat client.
 * The same object for as long as the id stands, so what reads it through a context is not redrawn.
 * Both are looked up when asked for, since a row that learns its daemon id moves them under the new id.
 */
export function chatScopeOf(endpointId: string): ChatScope {
    let scope = scopes.get(endpointId);
    if (scope === undefined) {
        scope = {
            id: endpointId,
            keyOf: (chatId) => endpointKey(endpointId, chatId),
            owns: (key) => isOfEndpoint(key, endpointId),
            get transport() {
                return machineTransport(endpointId);
            },
            get chats() {
                return chatClientFor(endpointId) ?? strangerChats(endpointId);
            }
        };
        scopes.set(endpointId, scope);
    }
    return scope;
}
