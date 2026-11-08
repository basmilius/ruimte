import { describe, expect, test } from 'bun:test';
import { PORT_TUNNEL_MAX_STREAMS, PORT_TUNNEL_MESSAGE_BYTES, PORT_TUNNEL_WINDOW_BYTES, type PortTunnelToPage } from '@ruimte/desktop-bridge';
import { IpcRelay } from './ipc-relay';
import type { TunnelStream, TunnelStreamEvents } from './relay';

function setup() {
    const sent: PortTunnelToPage[] = [];
    const relay = new IpcRelay('tunnel-1', (message) => sent.push(message));
    const log = { data: [] as Uint8Array[], consumers: [] as Array<() => void>, drains: 0, ends: [] as Array<string | null> };
    const events: TunnelStreamEvents = {
        data: (bytes, consumed) => {
            log.data.push(bytes);
            log.consumers.push(consumed);
        },
        drain: () => {
            log.drains += 1;
        },
        end: (reason) => log.ends.push(reason)
    };

    async function open(): Promise<{ stream: TunnelStream; number: number }> {
        const opening = relay.open(events);
        const number = (sent.at(-1) as { stream: number }).stream;

        relay.receive({ kind: 'opened', id: 'tunnel-1', stream: number, error: null });

        return { stream: await opening, number };
    }

    return { relay, sent, log, events, open };
}

describe('IpcRelay', () => {
    test('opens a stream when the page says it opened and fails it when the page says why not', async () => {
        const { relay, sent, events, open } = setup();
        const { number } = await open();

        expect(sent[0]).toEqual({ kind: 'open', id: 'tunnel-1', stream: number });

        const failing = relay.open(events);
        relay.receive({ kind: 'opened', id: 'tunnel-1', stream: number + 1, error: 'Nothing answers' });

        await expect(failing).rejects.toThrow('Nothing answers');
        expect(relay.count).toBe(1);
    });

    test('refuses a seventeenth stream', async () => {
        const { relay, events, open } = setup();

        for (let i = 0; i < PORT_TUNNEL_MAX_STREAMS; i += 1) {
            await open();
        }

        await expect(relay.open(events)).rejects.toThrow('Too many');
    });

    test('cuts writes into small messages and blocks at the window until the page says bytes were flushed', async () => {
        const { relay, sent, log, open } = setup();
        const { stream, number } = await open();
        const writes = (): PortTunnelToPage[] => sent.filter((message) => message.kind === 'write');

        expect(stream.write(new Uint8Array(PORT_TUNNEL_MESSAGE_BYTES * 2 + 5))).toBe(true);
        expect(writes()).toHaveLength(3);

        expect(stream.write(new Uint8Array(PORT_TUNNEL_WINDOW_BYTES))).toBe(false);

        relay.receive({ kind: 'flushed', id: 'tunnel-1', stream: number, bytes: PORT_TUNNEL_MESSAGE_BYTES * 2 });
        expect(log.drains).toBe(0);

        relay.receive({ kind: 'flushed', id: 'tunnel-1', stream: number, bytes: PORT_TUNNEL_MESSAGE_BYTES * 2 + 5 + PORT_TUNNEL_WINDOW_BYTES });
        expect(log.drains).toBe(1);
    });

    test('ignores a flushed count that goes back or past what was written', async () => {
        const { relay, log, open } = setup();
        const { stream, number } = await open();

        stream.write(new Uint8Array(PORT_TUNNEL_WINDOW_BYTES));
        relay.receive({ kind: 'flushed', id: 'tunnel-1', stream: number, bytes: 10 * PORT_TUNNEL_WINDOW_BYTES });
        relay.receive({ kind: 'flushed', id: 'tunnel-1', stream: number, bytes: 0 });

        expect(log.drains).toBe(1);
    });

    test('hands data to the proxy and tells the page it was used once the proxy says so', async () => {
        const { relay, sent, log, open } = setup();
        const { number } = await open();

        relay.receive({ kind: 'data', id: 'tunnel-1', stream: number, data: new Uint8Array(100) });

        expect(log.data).toHaveLength(1);
        expect(sent.some((message) => message.kind === 'consumed')).toBe(false);

        log.consumers[0]!();

        expect(sent.at(-1)).toEqual({ kind: 'consumed', id: 'tunnel-1', stream: number, bytes: 100 });
    });

    test('closes a stream whose machine sends a message that is too large', async () => {
        const { relay, sent, log, open } = setup();
        const { number } = await open();

        relay.receive({ kind: 'data', id: 'tunnel-1', stream: number, data: new Uint8Array(PORT_TUNNEL_MESSAGE_BYTES + 1) });

        expect(sent.at(-1)).toEqual({ kind: 'close', id: 'tunnel-1', stream: number });
        expect(log.ends).toEqual(['The machine sent a malformed answer']);
        expect(relay.count).toBe(0);
    });

    test('closes a stream whose machine sends more than the window while nothing was used', async () => {
        const { relay, log, open } = setup();
        const { number } = await open();

        for (let sentBytes = 0; sentBytes <= PORT_TUNNEL_WINDOW_BYTES + PORT_TUNNEL_MESSAGE_BYTES; sentBytes += PORT_TUNNEL_MESSAGE_BYTES) {
            relay.receive({ kind: 'data', id: 'tunnel-1', stream: number, data: new Uint8Array(PORT_TUNNEL_MESSAGE_BYTES) });
        }

        expect(log.ends).toEqual(['The machine sent more than the window allowed']);
    });

    test('ends a stream when the page says so, and ignores messages for other tunnels and unknown streams', async () => {
        const { relay, log, open } = setup();
        const { number } = await open();

        relay.receive({ kind: 'end', id: 'other', stream: number, reason: null });
        relay.receive({ kind: 'end', id: 'tunnel-1', stream: 999, reason: null });
        expect(log.ends).toEqual([]);

        relay.receive({ kind: 'end', id: 'tunnel-1', stream: number, reason: null });
        expect(log.ends).toEqual([null]);
    });

    test('closes everything when the tunnel closes and fails the streams still opening', async () => {
        const { relay, sent, log, events, open } = setup();
        const { number } = await open();
        const opening = relay.open(events);

        relay.closeAll('The window closed');

        await expect(opening).rejects.toThrow('The window closed');
        expect(log.ends).toEqual(['The window closed']);
        expect(sent.filter((message) => message.kind === 'close').map((message) => message.stream)).toContain(number);
        expect(relay.count).toBe(0);
    });
});
