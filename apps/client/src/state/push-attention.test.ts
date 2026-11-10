import { expect, test } from 'bun:test';
import type { PushAttentionEntry } from '@ruimte/contracts';
import type { Transport } from '@/transport-api/transport';
import { PushAttentionSync } from './push-attention';

async function flush() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

/* An open link that answers `push.attention` with `held`, notes every read, and hands an event to `receive`. */
function machine(held: { entries: PushAttentionEntry[]; marksFrom?: number }) {
    const reads: unknown[] = [];
    let receive = (_entry: PushAttentionEntry): void => undefined;
    const transport = {
        status: 'open',
        on: (_event: string, listener: typeof receive) => {
            receive = listener;
            return () => undefined;
        },
        subscribeStatus: () => () => undefined,
        request: async (type: string, payload: unknown) => {
            if (type === 'push.attention') {
                return held;
            }
            reads.push(payload);
            return {};
        }
    } as unknown as Transport;
    return { transport, reads, receive: (entry: PushAttentionEntry) => receive(entry) };
}

test('only readable nodes acknowledge results, including results received after focusing', async () => {
    const { transport, reads, receive } = machine({
        entries: [
            { nodeId: 'one', issuedAt: 100, readThrough: 0 },
            { nodeId: 'hidden', issuedAt: 101, readThrough: 0 }
        ]
    });
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
    const { transport } = machine({
        entries: [
            { nodeId: 'finished-while-away', issuedAt: 100, readThrough: 0 },
            { nodeId: 'already-seen', issuedAt: 90, readThrough: 90 },
            // Issued before the machine ran a version that marks nodes, so it never becomes a mark.
            { nodeId: 'before-the-update', issuedAt: 40, readThrough: 0 }
        ],
        marksFrom: 50
    });
    const sync = new PushAttentionSync(transport);
    await flush();
    expect(sync.unread()).toEqual(['finished-while-away']);
    sync.markSeen('finished-while-away');
    await flush();
    expect(sync.unread()).toEqual([]);
});

test('a machine that does not say when marks start gives none', async () => {
    const sync = new PushAttentionSync(machine({ entries: [{ nodeId: 'unread', issuedAt: 100, readThrough: 0 }] }).transport);
    await flush();
    expect(sync.unread()).toEqual([]);
    sync.dispose();
});
