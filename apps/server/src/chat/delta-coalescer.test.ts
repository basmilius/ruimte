import { describe, expect, test } from 'bun:test';
import type { ChatEvent, ChatItem } from '@ruimte/contracts';
import { DeltaCoalescer } from './delta-coalescer.ts';

const delta = (itemId: string, text: string): ChatEvent => ({ type: 'delta', itemId, text });

const note: ChatItem = { kind: 'note', id: 'n', turnId: null, level: 'info', text: 'hi', createdAt: 0 };

const recorder = () => {
    const sent: ChatEvent[] = [];
    return { sent, coalescer: new DeltaCoalescer((event) => sent.push(event), 5) };
};

describe('DeltaCoalescer', () => {
    test('ten deltas on one item within a tick go out as one delta with the joined text', async () => {
        const { sent, coalescer } = recorder();
        for (let i = 0; i < 10; i++) {
            coalescer.push(delta('a', String(i)));
        }
        expect(sent).toEqual([]);
        await Bun.sleep(20);
        expect(sent).toEqual([delta('a', '0123456789')]);
    });

    test('an item event in between sends what was held first', () => {
        const { sent, coalescer } = recorder();
        coalescer.push(delta('a', 'one '));
        coalescer.push(delta('a', 'two'));
        coalescer.push({ type: 'item', item: note });
        coalescer.push(delta('a', ' three'));
        expect(sent).toEqual([delta('a', 'one two'), { type: 'item', item: note }]);
        coalescer.flush();
        expect(sent[2]).toEqual(delta('a', ' three'));
    });

    test('a delta on another item sends the run before it', () => {
        const { sent, coalescer } = recorder();
        coalescer.push(delta('a', 'x'));
        coalescer.push(delta('b', 'y'));
        coalescer.push(delta('a', 'z'));
        expect(sent).toEqual([delta('a', 'x'), delta('b', 'y')]);
    });

    test('dispose drops what was held and the tick sends nothing', async () => {
        const { sent, coalescer } = recorder();
        coalescer.push(delta('a', 'x'));
        coalescer.dispose();
        await Bun.sleep(20);
        expect(sent).toEqual([]);
    });
});
