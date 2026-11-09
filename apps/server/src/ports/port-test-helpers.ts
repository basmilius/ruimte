import type { ServerFrame } from '@ruimte/contracts';
import type { ClientConnection } from '../wire.ts';
import { PortGrants, portsStore } from './port-grants.ts';
import type { PortConnect, PortSocket, PortSocketHandlers, PortTimers } from './port-streams.ts';

export class FakeService implements PortSocket {
    readonly written: Uint8Array[] = [];
    readonly handlers: PortSocketHandlers;
    pauses = 0;
    resumes = 0;
    closed = false;
    shut = false;
    /* Writes wait here until the test lets them through, like a service that does not read. */
    stalled = false;
    private readonly pending: Array<() => void> = [];

    constructor(handlers: PortSocketHandlers) {
        this.handlers = handlers;
    }

    write(bytes: Uint8Array): Promise<void> {
        this.written.push(bytes);

        if (!this.stalled) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this.pending.push(resolve);
        });
    }

    release(): void {
        this.stalled = false;
        this.pending.splice(0).forEach((resolve) => resolve());
    }

    shutdownWrite(): void {
        this.shut = true;
    }

    close(): void {
        this.closed = true;
    }

    pause(): void {
        this.pauses += 1;
    }

    resume(): void {
        this.resumes += 1;
    }
}

/* A connector that records what it was asked and hands out `FakeService`s. */
export class FakeNetwork {
    readonly asked: Array<{ host: string; port: number }> = [];
    readonly services: FakeService[] = [];
    refuse = false;

    readonly connect: PortConnect = async (host, port, handlers) => {
        this.asked.push({ host, port });

        if (this.refuse) {
            throw new Error('connection refused');
        }

        const service = new FakeService(handlers);
        this.services.push(service);

        return service;
    };
}

export class FakeTimers implements PortTimers {
    private readonly waiting = new Map<number, { ms: number; fire: () => void }>();
    private next = 1;

    after(ms: number, fire: () => void): () => void {
        const id = this.next++;
        this.waiting.set(id, { ms, fire });

        return () => {
            this.waiting.delete(id);
        };
    }

    get pending(): number[] {
        return [...this.waiting.values()].map((timer) => timer.ms);
    }

    /* Fires the timers waiting for `ms`, or all of them. */
    fire(ms?: number): void {
        for (const [id, timer] of [...this.waiting]) {
            if (ms === undefined || timer.ms === ms) {
                this.waiting.delete(id);
                timer.fire();
            }
        }
    }
}

export interface FakeClient extends ClientConnection {
    readonly frames: ServerFrame[];
    buffered: number;
    drains: Array<() => void>;
    closed: boolean;
    drain(): void;
}

/* A client whose channel holds `buffered` bytes until the test drains it. */
export function fakeClient(id: string, options: { bounded?: boolean } = {}): FakeClient {
    const frames: ServerFrame[] = [];
    const drains: Array<() => void> = [];
    const client: FakeClient = {
        id,
        frames,
        buffered: 0,
        drains,
        closed: false,
        send: (frame) => {
            frames.push(frame);
        },
        drain() {
            client.buffered = 0;
            drains.slice().forEach((listener) => listener());
        }
    };

    if (options.bounded === true) {
        client.bufferedAmount = () => client.buffered;
        client.onDrain = (listener) => {
            drains.push(listener);

            return () => {
                drains.splice(drains.indexOf(listener), 1);
            };
        };
    }

    return client;
}

export function eventsOf(client: FakeClient, event: string): Array<Record<string, unknown>> {
    return client.frames.flatMap((frame) => ('event' in frame && frame.event === event ? [frame.payload as Record<string, unknown>] : []));
}

export function testGrants(denied: number[] = [4210]): { grants: PortGrants; changes: () => number } {
    let changes = 0;
    let counter = 0;
    const grants = new PortGrants({
        store: portsStore(undefined),
        deniedPorts: () => denied,
        random: () => `grant-${++counter}`,
        now: () => 1000,
        changed: () => {
            changes += 1;
        }
    });

    return { grants, changes: () => changes };
}

export function base64Of(text: string): string {
    return Buffer.from(text).toString('base64');
}
