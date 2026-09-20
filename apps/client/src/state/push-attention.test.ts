import { expect, test } from 'bun:test';
import type { PushAttentionEntry } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';
import { PushAttentionSync } from './push-attention';

const flush = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

test('only readable nodes acknowledge results, including results received after focusing', async () => {
    let receive = (_entry: PushAttentionEntry) => {};
    const reads: unknown[] = [];
    const transport = {
        status: 'open',
        on: (_event: string, listener: typeof receive) => {
            receive = listener;
            return () => {};
        },
        subscribeStatus: () => () => {},
        request: async (type: string, payload: unknown) => {
            if (type === 'push.attention') {
                return {
                    entries: [
                        { nodeId: 'one', issuedAt: 100, readThrough: 0 },
                        { nodeId: 'hidden', issuedAt: 101, readThrough: 0 }
                    ]
                };
            }
            reads.push(payload);
            return {};
        }
    } as unknown as Transport;
    const sync = new PushAttentionSync(transport);
    await flush();
    expect(reads).toEqual([]);
    sync.setVisible(new Set(['one']));
    await flush();
    expect(reads).toEqual([{ nodeId: 'one', issuedAt: 100 }]);
    receive({ nodeId: 'one', issuedAt: 200, readThrough: 100 });
    await flush();
    receive({ nodeId: 'one', issuedAt: 100, readThrough: 100 });
    await flush();
    expect(reads).toEqual([
        { nodeId: 'one', issuedAt: 100 },
        { nodeId: 'one', issuedAt: 200 }
    ]);
    sync.setVisible(new Set());
    receive({ nodeId: 'one', issuedAt: 300, readThrough: 200 });
    await flush();
    expect(reads.length).toBe(2);
    sync.dispose();
});

test('what the machine holds unread is known the moment a socket opens, and a read takes it off', async () => {
    const transport = {
        status: 'open',
        on: () => () => {},
        subscribeStatus: () => () => {},
        request: async (type: string) =>
            type === 'push.attention'
                ? {
                      entries: [
                          { nodeId: 'finished-while-away', issuedAt: 100, readThrough: 0 },
                          { nodeId: 'already-seen', issuedAt: 90, readThrough: 90 },
                          // Issued before the machine ran a version that marks nodes, so it never becomes a mark.
                          { nodeId: 'before-the-update', issuedAt: 40, readThrough: 0 }
                      ],
                      marksFrom: 50
                  }
                : {}
    } as unknown as Transport;
    const sync = new PushAttentionSync(transport);
    await flush();
    expect(sync.unread()).toEqual(['finished-while-away']);
    sync.markSeen('finished-while-away');
    await flush();
    expect(sync.unread()).toEqual([]);
});

test('a machine that does not say when marks start gives none', async () => {
    const transport = {
        status: 'open',
        on: () => () => {},
        subscribeStatus: () => () => {},
        request: async (type: string) => (type === 'push.attention' ? { entries: [{ nodeId: 'unread', issuedAt: 100, readThrough: 0 }] } : {})
    } as unknown as Transport;
    const sync = new PushAttentionSync(transport);
    await flush();
    expect(sync.unread()).toEqual([]);
    sync.dispose();
});
