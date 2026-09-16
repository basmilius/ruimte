import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';
import { COUNTS_QUIET_MS, WorktreeLists } from './worktrees';

type Call = { type: RequestType; payload: unknown };

/* A transport that records every request and answers a worktree list with no worktrees. */
const fakeTransport = (): { transport: Transport; calls: Call[] } => {
    const calls: Call[] = [];
    const transport: Transport = {
        status: 'open',
        request: <T extends RequestType>(type: T, payload: RequestMap[T]['payload']) => {
            calls.push({ type, payload });
            return Promise.resolve({ worktrees: [] } as unknown as RequestMap[T]['result']);
        },
        on:
            <E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void) =>
            () =>
                undefined,
        subscribeStatus: () => () => undefined
    };
    return { transport, calls };
};

describe('WorktreeLists.refreshCounts', () => {
    test('counts again once the quiet window after the last count has passed', () => {
        let now = 1000;
        const lists = new WorktreeLists(() => now);
        const { transport, calls } = fakeTransport();
        lists.hold(transport, 'machine', '/repo', true);
        expect(calls).toHaveLength(1);

        lists.refreshCounts('machine', '/repo');
        now += COUNTS_QUIET_MS - 1;
        lists.refreshCounts('machine', '/repo');
        expect(calls).toHaveLength(1);

        now += 1;
        lists.refreshCounts('machine', '/repo');
        lists.refreshCounts('machine', '/repo');
        expect(calls).toHaveLength(2);
        expect(calls[1]?.payload).toEqual({ repo: '/repo', inspect: true });
    });

    test('a count asked for another reason starts the window over', () => {
        let now = 0;
        const lists = new WorktreeLists(() => now);
        const { transport, calls } = fakeTransport();
        lists.hold(transport, 'machine', '/repo', true);
        now += COUNTS_QUIET_MS;
        lists.reload('machine', '/repo');
        now += 1;
        lists.refreshCounts('machine', '/repo');
        expect(calls).toHaveLength(2);
    });

    test('asks nothing for a list nobody wants counted, or nobody holds', () => {
        let now = 0;
        const lists = new WorktreeLists(() => now);
        const { transport, calls } = fakeTransport();
        lists.hold(transport, 'machine', '/repo', false);
        now += COUNTS_QUIET_MS * 2;
        lists.refreshCounts('machine', '/repo');
        lists.refreshCounts('machine', '/elsewhere');
        expect(calls).toHaveLength(1);
    });
});
