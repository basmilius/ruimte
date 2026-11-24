import { expect, test } from 'bun:test';
import { compileUi } from '@adecore/intelligent-ui';
import type { SessionEvent } from '../wire.ts';
import { UiDiagnosticTally } from './ui-diagnostics.ts';
import type { UsageStateStore } from './usage-counter.ts';

function rig(initial: string | null = null) {
    let file = initial;
    let run: (() => void) | null = null;
    const store: UsageStateStore = {
        read: async () => file,
        write: async (text) => {
            file = text;
        }
    };

    const tally = new UiDiagnosticTally({
        store,
        schedule: (next) => {
            run = next;

            return () => {
                run = null;
            };
        }
    });

    return { tally, file: () => file, due: () => run };
}

function reply(id: string, source: string, streaming = false): SessionEvent {
    const ui = compileUi('```ruimte-ui\n' + source + '\n```', { id, final: true, fenceLanguage: 'ruimte-ui' });

    return {
        event: 'chat.event',
        payload: { chatId: 'chat-1', event: { type: 'item', item: { id, kind: 'assistant', text: source, streaming, ui } } }
    } as SessionEvent;
}

test('counts each block once, under the code, the component and the prop of every diagnostic', () => {
    const { tally } = rig();
    tally.observe(reply('a', '<Stats><Stat label="Tests" value="42" tone="loud"/></Stats>'));
    tally.observe(reply('b', '<Dial/>'));
    tally.observe(reply('c', '<Summary>Fine</Summary>'));
    expect(tally.snapshot()).toEqual({
        version: 1,
        blocks: 3,
        flawed: 2,
        counts: { 'coerced_prop Stat.value': 1, 'dropped_prop Stat.tone': 1, 'unknown_component Dial': 1 }
    });
});

test('a reply sent again, a reply still streaming and another kind of event count nothing', () => {
    const { tally } = rig();
    const flawed = reply('a', '<Dial/>');
    tally.observe(flawed);
    tally.observe(flawed);
    tally.observe(reply('b', '<Dial/>', true));
    tally.observe({ event: 'chat.status', payload: {} } as unknown as SessionEvent);
    expect(tally.snapshot().blocks).toBe(1);
    expect(tally.snapshot().counts).toEqual({ 'unknown_component Dial': 1 });
});

test('holds names only, never a value or a word of the block', async () => {
    const { tally, file } = rig();
    tally.observe(reply('a', '<Stats><Stat label="Quarterly revenue" value="secret 42"/></Stats><Callout tone="classified">Private words</Callout>'));
    await tally.persist();
    expect(file()).not.toContain('Quarterly');
    expect(file()).not.toContain('secret');
    expect(file()).not.toContain('classified');
    expect(file()).not.toContain('Private');
});

test('writes once a minute after a change, and reads back what it wrote', async () => {
    const first = rig();
    expect(first.due()).toBeNull();
    first.tally.observe(reply('a', '<Dial/>'));
    first.tally.observe(reply('b', '<Dial/>'));
    first.due()!();
    await Promise.resolve();
    const second = rig(first.file());
    await second.tally.load();
    expect(second.tally.snapshot().counts).toEqual({ 'unknown_component Dial': 2 });
});

test('a file that will not read starts the tally over', async () => {
    const { tally } = rig('{"version":7}');
    await tally.load();
    expect(tally.snapshot().blocks).toBe(0);
});
