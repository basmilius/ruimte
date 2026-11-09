import { beforeEach, describe, expect, test } from 'bun:test';
import { PORT_CHUNK_BYTES, PORT_WINDOW_BYTES } from '@ruimte/contracts';
import type { PortTunnelToPage, PortTunnelToShell } from '@ruimte/desktop-bridge';
import { FakePortTransport } from './port-test-transport';
import { PortStreamHub } from './stream-client';
import { PortTunnelHost } from './tunnel-host';

let transport: FakePortTransport;
let sent: PortTunnelToShell[];
let listeners: Array<(message: PortTunnelToPage) => void>;
let host: PortTunnelHost;

beforeEach(() => {
    transport = new FakePortTransport();
    sent = [];
    listeners = [];
    host = new PortTunnelHost({
        id: 'tunnel-1',
        grantId: 'grant-1',
        hub: new PortStreamHub(transport),
        shell: {
            onPortTunnel: (listener) => {
                listeners.push(listener);

                return () => listeners.splice(listeners.indexOf(listener), 1);
            },
            portTunnelSend: (message) => sent.push(message)
        }
    });
    host.start();
});

function fromShell(message: PortTunnelToPage): void {
    listeners.forEach((listener) => listener(message));
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
        await Promise.resolve();
    }
}

async function openStream(number = 1): Promise<string> {
    transport.reply('port.open', () => ({ window: PORT_WINDOW_BYTES }));
    fromShell({ kind: 'open', id: 'tunnel-1', stream: number });
    await settle();

    return transport.of('port.open').at(-1)!.streamId as string;
}

describe('PortTunnelHost', () => {
    test('opens a stream on the grant and tells the shell it opened', async () => {
        await openStream();

        expect(transport.of('port.open')).toEqual([{ streamId: expect.any(String), grantId: 'grant-1' }]);
        expect(sent).toEqual([{ kind: 'opened', id: 'tunnel-1', stream: 1, error: null }]);
    });

    test('tells the shell why a stream did not open', async () => {
        transport.reply('port.open', () => Promise.reject(new Error('Nothing answers on 127.0.0.1 port 3000')));
        fromShell({ kind: 'open', id: 'tunnel-1', stream: 1 });
        await settle();

        expect(sent).toEqual([{ kind: 'opened', id: 'tunnel-1', stream: 1, error: 'Nothing answers on 127.0.0.1 port 3000' }]);
    });

    test('ignores messages meant for another tunnel', async () => {
        fromShell({ kind: 'open', id: 'other', stream: 1 });
        await settle();

        expect(transport.of('port.open')).toEqual([]);
        expect(host.count).toBe(0);
    });

    test('carries writes, data and flushed counts, with the answer only after the opened message', async () => {
        const streamId = await openStream();

        fromShell({ kind: 'write', id: 'tunnel-1', stream: 1, data: new Uint8Array([1, 2, 3]) });
        transport.emit('port.data', { streamId, offset: 0, data: Buffer.from('abc').toString('base64') });

        expect(transport.of('port.write')).toEqual([{ streamId, offset: 0, data: Buffer.from([1, 2, 3]).toString('base64') }]);
        expect(sent.at(-1)).toEqual({ kind: 'data', id: 'tunnel-1', stream: 1, data: new Uint8Array(Buffer.from('abc')) });

        transport.asked.find((request) => request.type === 'port.write')!.resolve({ flushed: 3 });
        await settle();

        expect(sent.at(-1)).toEqual({ kind: 'flushed', id: 'tunnel-1', stream: 1, bytes: 3 });
    });

    test('holds data that arrives before the shell heard the stream opened', async () => {
        let answerOpen: (value: unknown) => void = () => undefined;

        transport.reply('port.open', () => new Promise((resolve) => (answerOpen = resolve)));
        fromShell({ kind: 'open', id: 'tunnel-1', stream: 1 });
        await settle();

        const streamId = transport.of('port.open')[0]!.streamId as string;

        transport.emit('port.data', { streamId, offset: 0, data: Buffer.from('early').toString('base64') });

        expect(sent).toEqual([]);

        answerOpen({ window: PORT_WINDOW_BYTES });
        await settle();

        expect(sent.map((message) => message.kind)).toEqual(['opened', 'data']);
    });

    test('credits the machine for what the shell used and closes the stream when told to', async () => {
        const streamId = await openStream();

        fromShell({ kind: 'consumed', id: 'tunnel-1', stream: 1, bytes: PORT_CHUNK_BYTES });
        fromShell({ kind: 'close', id: 'tunnel-1', stream: 1 });

        expect(transport.of('port.credit')).toEqual([{ streamId, offset: PORT_CHUNK_BYTES }]);
        expect(transport.of('port.close')).toEqual([{ streamId }]);
        expect(host.count).toBe(0);
    });

    test('says the stream ended, with the reason, when the machine ends it', async () => {
        const streamId = await openStream();

        transport.emit('port.end', { streamId, offset: 0, reason: 'revoked', message: 'Sharing this port was stopped' });

        expect(sent.at(-1)).toEqual({ kind: 'end', id: 'tunnel-1', stream: 1, reason: 'Sharing this port was stopped' });
        expect(host.count).toBe(0);
    });

    test('closes every stream and stops listening when disposed', async () => {
        const streamId = await openStream();

        host.dispose('The page closed');

        expect(transport.of('port.close')).toEqual([{ streamId }]);
        expect(listeners).toEqual([]);
        expect(transport.listening).toBe(0);
    });
});
