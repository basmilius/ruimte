import { describe, expect, test } from 'bun:test';
import type { RequestMap, RequestType } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { FakeLink } from '../../testing/fake-link';
import type { WatchablePool } from './pool-watch';
import { startStartupReport } from './startup-report';

class Link extends FakeLink {
    readonly asked: Array<{ type: string; payload: unknown }> = [];

    constructor(features: string[]) {
        super();
        this.connection = { status: 'open', attempts: 0, retryAt: null, failure: null, features };
    }

    override request<T extends RequestType>(type?: T, payload?: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.asked.push({ type: type as string, payload });

        return Promise.resolve({} as RequestMap[T]['result']);
    }
}

function poolOf(links: Record<string, Link>): WatchablePool & { replace(next: Record<string, Link>): void } {
    const handlers = new Set<() => void>();
    return {
        ids: () => Object.keys(links),
        peek: (endpointId) => links[endpointId] ?? null,
        subscribe: (handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        replace: (next) => {
            links = next;
            for (const handler of handlers) {
                handler();
            }
        }
    };
}

describe('the startup report', () => {
    test('sends the time the shell hands out to this machine only, once', async () => {
        const local = new Link(['usage.startup']);
        const other = new Link(['usage.startup']);
        const replacement = new Link(['usage.startup']);
        const source = poolOf({ elsewhere: other, [LOCAL_ENDPOINT_ID]: local });
        const startup = Promise.withResolvers<number | null>();
        let taken = 0;
        const stop = startStartupReport(() => {
            taken += 1;
            return startup.promise;
        }, source);
        try {
            local.setStatus('closed');
            local.setStatus('open');
            source.replace({ elsewhere: other });
            source.replace({ [LOCAL_ENDPOINT_ID]: replacement, elsewhere: other });
            startup.resolve(1834.4);
            await startup.promise;
            replacement.setStatus('closed');
            replacement.setStatus('open');
            await startup.promise;
            expect(taken).toBe(1);
            expect(local.asked).toEqual([{ type: 'usage.startup', payload: { ms: 1834 } }]);
            expect(replacement.asked).toEqual([]);
            expect(other.asked).toEqual([]);
        } finally {
            stop();
        }
    });

    test('asks nothing of a machine that does not answer it, and sends nothing the shell withholds', async () => {
        const older = new Link([]);
        let taken = 0;
        const stopOlder = startStartupReport(
            async () => {
                taken += 1;
                return null;
            },
            poolOf({ [LOCAL_ENDPOINT_ID]: older })
        );
        const current = new Link(['usage.startup']);
        const withheld = Promise.resolve(null);
        const stopCurrent = startStartupReport(() => withheld, poolOf({ [LOCAL_ENDPOINT_ID]: current }));
        try {
            await withheld;
            expect(taken).toBe(0);
            expect(current.asked).toEqual([]);
        } finally {
            stopOlder();
            stopCurrent();
        }
    });
});
