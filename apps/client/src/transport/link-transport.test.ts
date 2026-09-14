import { describe, expect, test } from 'bun:test';
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

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
