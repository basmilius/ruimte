import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { encodeBytesReply } from '@ruimte/contracts';
import i18next from 'i18next';
import { LinkTransport, type Link, type LinkEvents } from './link-transport';
import type { TransportStatus } from './transport';

class FakeLink implements Link {
    readonly sent: string[] = [];
    closed = false;
    readonly events: LinkEvents;

    constructor(events: LinkEvents) {
        this.events = events;
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        queueMicrotask(() => this.events.close(null));
    }
}

// Fake timers leave setImmediate alone. Each step runs the timers due in that millisecond, then every promise they started.
const tick = async (ms = 0): Promise<void> => {
    for (let i = 0; i < ms; i++) {
        jest.advanceTimersByTime(1);
        await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

const setup = (onOpen?: (events: LinkEvents) => void) => {
    const links: FakeLink[] = [];
    const transport = new LinkTransport('ws://machine/ws', (_url, events) => {
        onOpen?.(events);
        const link = new FakeLink(events);
        links.push(link);
        return link;
    });
    return { transport, links };
};

describe('LinkTransport', () => {
    const piece = { mime: 'video/mp4', size: 3, version: '1-3', offset: 0 };
    const resource = { kind: 'file', path: 'clip.mp4' } as const;

    test('readBytes asks for a binary reply and resolves with the bytes it carries', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        const read = transport.readBytes({ resource, offset: 0, length: 3 });
        const frame = JSON.parse(links[0]!.sent[0]!) as { id: string; type: string; payload: { binary?: boolean } };
        expect(frame).toMatchObject({ type: 'bytes.read', payload: { binary: true } });
        links[0]!.events.message(encodeBytesReply(frame.id, piece, new Uint8Array([7, 8, 9])));
        expect(await read).toEqual({ ...piece, bytes: new Uint8Array([7, 8, 9]) });
    });

    test('readBytes takes base64 in JSON from a machine that sends no binary replies', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        const read = transport.readBytes({ resource, offset: 0, length: 3 });
        const { id } = JSON.parse(links[0]!.sent[0]!) as { id: string };
        links[0]!.events.message(JSON.stringify({ id, ok: true, result: { ...piece, data: Buffer.from([7, 8, 9]).toString('base64') } }));
        expect(await read).toEqual({ ...piece, bytes: new Uint8Array([7, 8, 9]) });
    });

    test('a binary reply to a request that did not ask for one is dropped', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        let settled = false;
        void transport.request('bytes.read', { resource, offset: 0, length: 3 }).finally(() => {
            settled = true;
        });
        const { id } = JSON.parse(links[0]!.sent[0]!) as { id: string };
        links[0]!.events.message(encodeBytesReply(id, piece, new Uint8Array([7, 8, 9])));
        await tick();
        expect(settled).toBe(false);
    });

    test('a request goes out on the link and its reply comes back', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        expect(transport.status).toBe('open');
        const reply = transport.request('session.detach', { sessionId: 'node-1' });
        const frame = JSON.parse(links[0]!.sent[0]!) as { id: string; type: string };
        expect(frame.type).toBe('session.detach');
        links[0]!.events.message(JSON.stringify({ id: frame.id, ok: true, result: {} }));
        expect(await reply).toEqual({});
    });

    test('an open link that moves onto a relay says so to the subscribers, and a closed one is never relayed', async () => {
        const { transport, links } = setup();
        await tick();
        const heard: TransportStatus[] = [];
        transport.subscribeStatus((status) => heard.push(status));
        links[0]!.events.open();
        expect(transport.connection.relayed).toBe(false);
        links[0]!.events.route?.(true);
        expect(transport.connection.relayed).toBe(true);
        expect(heard).toEqual(['open', 'open']);
        links[0]!.events.route?.(true);
        expect(heard).toHaveLength(2);

        links[0]!.events.close('The machine stopped answering over the direct connection');
        expect(transport.connection.relayed).toBe(false);
        links[0]!.events.route?.(true);
        expect(transport.connection.relayed).toBe(false);
    });

    test('an open link says which route its signals took, and a closed one took none', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open('lan');
        expect(transport.connection.signaled).toBe('lan');
        links[0]!.events.close('The direct connection closed');
        expect(transport.connection.signaled).toBeNull();
    });

    test('a link that fails says why, and the reason stays until a link opens again', async () => {
        const { transport, links } = setup();
        const statuses: TransportStatus[] = [];
        transport.subscribeStatus((status) => statuses.push(status));
        await tick();
        links[0]!.events.close('No network path to the machine');
        expect(transport.connection).toMatchObject({ status: 'closed', attempts: 1, failure: 'No network path to the machine' });

        await tick(600);
        expect(links).toHaveLength(2);
        expect(transport.connection).toMatchObject({ status: 'connecting', failure: 'No network path to the machine' });
        links[1]!.events.open();
        expect(transport.connection).toMatchObject({ status: 'open', attempts: 0, failure: null });
        expect(statuses).toEqual(['closed', 'connecting', 'open']);
        transport.dispose();
    });

    test('reconnect replaces the link and nothing the old one says afterwards counts', async () => {
        const { transport, links } = setup();
        const events: unknown[] = [];
        transport.on('session.list-changed', (payload) => events.push(payload));
        await tick();
        links[0]!.events.open();

        transport.reconnect();
        expect(links[0]!.closed).toBe(true);
        await tick(600);
        expect(links).toHaveLength(2);
        links[0]!.events.message(JSON.stringify({ type: 'event', event: 'session.list-changed', payload: {} }));
        links[0]!.events.open();
        expect(events).toEqual([]);
        expect(transport.status).toBe('connecting');

        links[1]!.events.open();
        links[1]!.events.message(JSON.stringify({ type: 'event', event: 'session.list-changed', payload: {} }));
        expect(events).toEqual([{}]);
        transport.dispose();
    });

    test('a link that fails while it is being opened is not kept as the link', async () => {
        let failFirst = true;
        const { transport } = setup((events) => {
            if (failFirst) {
                failFirst = false;
                events.close('The machine could not be reached');
            }
        });
        await tick();
        expect(transport.connection).toMatchObject({ status: 'closed', failure: 'The machine could not be reached' });
        await expect(transport.request('session.list', {})).rejects.toThrow(/not connected/);
        transport.dispose();
    });

    test('an opener that throws is a failed attempt, and the loop tries again', async () => {
        const opened: FakeLink[] = [];
        const warnings: unknown[][] = [];
        const transport = new LinkTransport(
            'ws://machine/ws',
            (_url, events) => {
                if (opened.length === 0) {
                    opened.push(new FakeLink(events));
                    throw new Error('RTCPeerConnection is not available');
                }
                const link = new FakeLink(events);
                opened.push(link);
                return link;
            },
            { log: { info: () => undefined, warn: (...parts: unknown[]) => warnings.push(parts) } }
        );
        await tick();
        expect(transport.connection).toMatchObject({
            status: 'closed',
            attempts: 1,
            failure: 'Could not open a connection: RTCPeerConnection is not available'
        });
        await tick(600);
        expect(opened).toHaveLength(2);
        opened[1]!.events.open();
        expect(transport.status).toBe('open');
        expect(warnings.length).toBeGreaterThan(0);
        transport.dispose();
    });

    test('an address that never resolves gives up and tries again', async () => {
        let asked = 0;
        const links: FakeLink[] = [];
        const transport = new LinkTransport(
            () => {
                asked += 1;
                return asked === 1 ? new Promise<string>(() => undefined) : Promise.resolve('ws://machine/ws');
            },
            (_url, events) => {
                const link = new FakeLink(events);
                links.push(link);
                return link;
            },
            { addressTimeoutMs: 20, log: { info: () => undefined, warn: () => undefined } }
        );
        await tick(40);
        expect(transport.connection).toMatchObject({ status: 'closed', attempts: 1, failure: i18next.t('machines:connection.noAddress', { seconds: 0 }) });
        await tick(600);
        expect(asked).toBe(2);
        expect(links).toHaveLength(1);
        transport.dispose();
    });

    test('reconnect opens a new link even when the old one never reports its close', async () => {
        const links: FakeLink[] = [];
        const transport = new LinkTransport('ws://machine/ws', (_url, events) => {
            const link = new FakeLink(events);
            // A link that closes without a word, which a transport must not wait on forever.
            link.close = () => {
                link.closed = true;
            };
            links.push(link);
            return link;
        });
        await tick();
        links[0]!.events.open();
        const reply = transport.request('session.list', {});
        transport.reconnect();
        expect(links[0]!.closed).toBe(true);
        await expect(reply).rejects.toThrow(/closed before the machine answered/);
        await tick();
        expect(links).toHaveLength(2);
        expect(transport.status).toBe('connecting');
        links[1]!.events.open();
        expect(transport.status).toBe('open');
        transport.dispose();
    });

    test('the reason a link closed is logged', async () => {
        const lines: string[] = [];
        const links: FakeLink[] = [];
        const transport = new LinkTransport(
            'ws://machine/ws',
            (_url, events) => {
                const link = new FakeLink(events);
                links.push(link);
                return link;
            },
            { log: { info: (...parts: unknown[]) => lines.push(parts.join(' ')), warn: (...parts: unknown[]) => lines.push(parts.join(' ')) } }
        );
        await tick();
        links[0]!.events.open();
        links[0]!.events.close('The machine stopped answering over the direct connection');
        expect(lines.some((line) => line.includes('The machine stopped answering over the direct connection'))).toBe(true);
        transport.dispose();
    });

    test('pending requests fail when the link goes, and a disposed transport stays down', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        const reply = transport.request('session.list', {});
        transport.dispose();
        await expect(reply).rejects.toThrow(/closed before the machine answered/);
        await tick(600);
        expect(links).toHaveLength(1);
    });
});
