import i18next from 'i18next';
import { parseServerFrame } from '@ruimte/agent-contracts/envelope';
import type { FramePort } from '@ruimte/agent-contracts/port';
import { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS, type AgentEventType, type AgentRequestType } from '@ruimte/agent-contracts/protocol';
import { ChatTransportError, type ChatEventMap, type ChatRequestMap, type ChatTransport, type ChatTransportStatus } from './transport';

export interface PortTransport extends ChatTransport {
    /* Lets go of the port: every request still waiting fails with `disconnected`, and the status turns `closed` for good. */
    close(): void;
}

interface Pending {
    type: AgentRequestType;
    resolve(result: unknown): void;
    reject(error: ChatTransportError): void;
}

const isEventType = (event: string): event is AgentEventType => Object.hasOwn(AGENT_EVENT_SCHEMAS, event);

/*
 * A chat host at the other end of a port, such as a process that runs the chats beside the window.
 * A port does not drop and come back the way a socket does, so it is open from the first request
 * until `close`. Frames are checked where they arrive, and a frame that does not hold up is dropped
 * with a warning, the way the socket transport of an app drops one.
 */
export const portTransport = (port: FramePort): PortTransport => {
    let status: ChatTransportStatus = 'open';
    let nextId = 1;
    const pending = new Map<string, Pending>();
    const eventHandlers = new Map<AgentEventType, Set<(payload: never) => void>>();
    const statusHandlers = new Set<(status: ChatTransportStatus) => void>();

    const answer = (id: string, frame: { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }): void => {
        const entry = pending.get(id);
        if (!entry) {
            return;
        }
        pending.delete(id);
        if (!frame.ok) {
            entry.reject(new ChatTransportError(frame.error.code, frame.error.message));
            return;
        }
        const result = AGENT_REQUEST_SCHEMAS[entry.type].result.safeParse(frame.result);
        if (!result.success) {
            entry.reject(new ChatTransportError('bad-reply', i18next.t('agent-chat:transport.badReply', { type: entry.type })));
            return;
        }
        entry.resolve(result.data);
    };

    const dispatch = (event: string, payload: unknown): void => {
        if (!isEventType(event)) {
            console.warn('Dropped an unknown event', event);
            return;
        }
        const parsed = AGENT_EVENT_SCHEMAS[event].safeParse(payload);
        if (!parsed.success) {
            console.warn(`Dropped a malformed ${event} event`);
            return;
        }
        // A copy, so a handler that unsubscribes while it runs does not change the set being walked.
        for (const handler of [...(eventHandlers.get(event) ?? [])]) {
            (handler as (payload: unknown) => void)(parsed.data);
        }
    };

    const stopListening = port.onFrame((raw) => {
        if (status === 'closed') {
            return;
        }
        const parsed = parseServerFrame(raw);
        if (!parsed.ok) {
            console.warn('Dropped a malformed frame', parsed.message);
            return;
        }
        const frame = parsed.value;
        if ('event' in frame) {
            dispatch(frame.event, frame.payload);
            return;
        }
        if (frame.id === null) {
            // An answer without an id is about a frame the host could not read; nothing waits for it.
            console.warn('The chat host refused a frame', frame);
            return;
        }
        answer(frame.id, frame);
    });

    return {
        get status(): ChatTransportStatus {
            return status;
        },
        request<T extends AgentRequestType>(type: T, payload: ChatRequestMap[T]['payload']): Promise<ChatRequestMap[T]['result']> {
            if (status !== 'open') {
                return Promise.reject(new ChatTransportError('not-connected', i18next.t('agent-chat:transport.notConnected')));
            }
            const id = String(nextId++);
            const promise = new Promise<ChatRequestMap[T]['result']>((resolve, reject) => {
                pending.set(id, { type, resolve: resolve as (result: unknown) => void, reject });
            });
            port.send({ id, type, payload });
            return promise;
        },
        on<E extends AgentEventType>(event: E, handler: (payload: ChatEventMap[E]) => void): () => void {
            let handlers = eventHandlers.get(event);
            if (!handlers) {
                handlers = new Set();
                eventHandlers.set(event, handlers);
            }
            const set = handlers;
            set.add(handler);
            return () => {
                set.delete(handler);
            };
        },
        subscribeStatus(handler: (status: ChatTransportStatus) => void): () => void {
            statusHandlers.add(handler);
            return () => {
                statusHandlers.delete(handler);
            };
        },
        close(): void {
            if (status === 'closed') {
                return;
            }
            status = 'closed';
            stopListening();
            const waiting = [...pending.values()];
            pending.clear();
            for (const entry of waiting) {
                entry.reject(new ChatTransportError('disconnected', i18next.t('agent-chat:transport.closedBeforeAnswer')));
            }
            for (const handler of [...statusHandlers]) {
                handler(status);
            }
        }
    };
};
