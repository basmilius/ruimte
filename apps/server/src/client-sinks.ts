import type { SessionEvent, SessionSink } from './sessions/manager.ts';

/*
 * The clients listening to one part of the daemon, the `Subscribable` in `connection.ts` made real.
 * A client is one sink at a time; a socket that reconnects replaces the one before it.
 */
export class ClientSinks {
    private readonly sinks = new Map<string, SessionSink>();
    private readonly onRelease: ((clientId: string) => void) | null;

    /* What else a client leaves behind, for the parts that keep more than a sink per client. */
    constructor(onRelease: ((clientId: string) => void) | null = null) {
        this.onRelease = onRelease;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            // A client that subscribes again before it unsubscribes keeps its newer sink.
            if (this.sinks.get(clientId) !== sink) {
                return;
            }
            this.sinks.delete(clientId);
            this.onRelease?.(clientId);
        };
    }

    emit(event: SessionEvent): void {
        for (const sink of this.sinks.values()) {
            sink(event);
        }
    }

    to(clientId: string, event: SessionEvent): void {
        this.sinks.get(clientId)?.(event);
    }

    clientIds(): string[] {
        return [...this.sinks.keys()];
    }
}
