import type { z } from 'zod';
import type { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS, AgentEventType, AgentRequestType } from '@ruimte/agent-contracts/protocol';

export type ChatRequestMap = {
    [T in AgentRequestType]: {
        payload: z.infer<(typeof AGENT_REQUEST_SCHEMAS)[T]['payload']>;
        result: z.infer<(typeof AGENT_REQUEST_SCHEMAS)[T]['result']>;
    };
};

export type ChatEventMap = {
    [E in AgentEventType]: z.infer<(typeof AGENT_EVENT_SCHEMAS)[E]>;
};

export type ChatTransportStatus = 'connecting' | 'open' | 'closed';

/*
 * What the chat, its providers and their usage need of whatever runs the chats: a request with its
 * typed answer, the events, and whether the link is up. A link that comes back is a fresh one to the
 * host, so everything that holds state there says it again when the status turns `open`. An app that
 * talks to several hosts has one of these per host; nothing here assumes there is only one.
 */
export interface ChatTransport {
    request<T extends AgentRequestType>(type: T, payload: ChatRequestMap[T]['payload']): Promise<ChatRequestMap[T]['result']>;
    on<E extends AgentEventType>(event: E, handler: (payload: ChatEventMap[E]) => void): () => void;
    readonly status: ChatTransportStatus;
    subscribeStatus(handler: (status: ChatTransportStatus) => void): () => void;
}

/* A refused request always carries a code, so a caller branches on it instead of on the message. */
export class ChatTransportError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ChatTransportError';
        this.code = code;
    }
}

/* The code of a refusal from any transport, this package's or the app's own: every one of them carries it the same way. */
export const errorCode = (error: unknown): string | null =>
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;

/* Whether a request failed because the link was down rather than because the host refused it; the reconnect asks again. */
export const isConnectionError = (error: unknown): boolean => {
    const code = errorCode(error);
    return code === 'not-connected' || code === 'disconnected';
};
