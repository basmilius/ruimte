import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { PortTransport } from './stream-client';

type Handler = (payload: never) => void;
type Responder = (payload: never) => unknown;

/* A machine connection a test answers by hand: each request waits in `asked` until `answer` or `fail` settles it, or `reply` answers it at once. */
export class FakePortTransport implements PortTransport {
    readonly asked: Array<{ type: string; payload: Record<string, unknown>; resolve(value: unknown): void; reject(error: Error): void }> = [];
    private readonly handlers = new Map<string, Set<Handler>>();
    private readonly responders = new Map<string, Responder>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        const responder = this.responders.get(type);

        if (responder !== undefined) {
            this.asked.push({ type, payload: payload as Record<string, unknown>, resolve: () => undefined, reject: () => undefined });

            return Promise.resolve(responder(payload as never) as RequestMap[T]['result']);
        }

        return new Promise((resolve, reject) => {
            this.asked.push({ type, payload: payload as Record<string, unknown>, resolve: resolve as (value: unknown) => void, reject });
        });
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const set = this.handlers.get(event) ?? new Set<Handler>();

        set.add(handler as Handler);
        this.handlers.set(event, set);

        return () => set.delete(handler as Handler);
    }

    /* Answers every request of this type from now on with what the function returns. */
    reply(type: RequestType, responder: Responder): void {
        this.responders.set(type, responder);
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(payload as never);
        }
    }

    of(type: RequestType): Array<Record<string, unknown>> {
        return this.asked.filter((request) => request.type === type).map((request) => request.payload);
    }

    get listening(): number {
        return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0);
    }
}
