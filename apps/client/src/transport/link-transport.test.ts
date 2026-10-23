import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { PROTOCOL_VERSION, REQUEST_SCHEMAS, encodeBytesReply, encodeLiveFrame } from '@ruimte/contracts';
import i18next from 'i18next';
import type { LinkProblem } from '@/telemetry/events';
import { linkMetrics, type PageMetric } from '@/telemetry/metrics';
import { LinkTransport, type Link, type LinkEvents } from './link-transport';
import type { SignalRoute, TransportStatus } from './transport';

class FakeLink implements Link {
    // The frames of requests; the protocol check the transport sends on its own lands in `checks`.
    readonly sent: string[] = [];
    readonly checks: string[] = [];
    closed = false;
    readonly events: LinkEvents;

    constructor(events: LinkEvents) {
        this.events = events;
    }

    send(data: string): void {
        (data.includes('"id":"protocol"') ? this.checks : this.sent).push(data);
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        queueMicrotask(() => this.events.close(null));
    }
}

function answerCheck(link: FakeLink, features: readonly string[]): void {
    link.events.message(JSON.stringify({ id: 'protocol', ok: true, result: { protocol: PROTOCOL_VERSION, features } }));
}

// Opens the link and answers the transport's protocol check, the way a current machine does.
function open(link: FakeLink, signaled?: SignalRoute, features: readonly string[] = Object.keys(REQUEST_SCHEMAS)): void {
    link.events.open(signaled);
    answerCheck(link, features);
}

// Fake timers leave setImmediate alone. Each step runs the timers due in that millisecond, then every promise they started.
async function tick(ms = 0): Promise<void> {
    for (let i = 0; i < ms; i++) {
        jest.advanceTimersByTime(1);
        await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

function setup(onOpen?: (events: LinkEvents) => void) {
    const links: FakeLink[] = [];
    const transport = new LinkTransport('ws://machine/ws', (_url, events) => {
        onOpen?.(events);
        const link = new FakeLink(events);
        links.push(link);
        return link;
    });
    return { transport, links };
}

describe('LinkTransport', () => {
    const piece = { mime: 'video/mp4', size: 3, version: '1-3', offset: 0 };
    const resource = { kind: 'file', path: 'clip.mp4' } as const;

    test('readBytes asks for a binary reply and resolves with the bytes it carries', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
        const read = transport.readBytes({ resource, offset: 0, length: 3 });
        const frame = JSON.parse(links[0]!.sent[0]!) as { id: string; type: string; payload: { binary?: boolean } };
        expect(frame).toMatchObject({ type: 'bytes.read', payload: { binary: true } });
        links[0]!.events.message(encodeBytesReply(frame.id, piece, new Uint8Array([7, 8, 9])));
        expect(await read).toEqual({ ...piece, bytes: new Uint8Array([7, 8, 9]) });
    });

    test('readBytes rejects a JSON answer, since a machine answers a binary request in binary', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
        const read = transport.readBytes({ resource, offset: 0, length: 3 });
        const { id } = JSON.parse(links[0]!.sent[0]!) as { id: string };
        links[0]!.events.message(JSON.stringify({ id, ok: true, result: { ...piece, data: Buffer.from([7, 8, 9]).toString('base64') } }));
        await expect(read).rejects.toMatchObject({ code: 'bad-reply' });
    });

    test('a binary reply to a request that did not ask for one is dropped', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
        let settled = false;
        void transport.request('bytes.read', { resource, offset: 0, length: 3 }).finally(() => {
            settled = true;
        });
        const { id } = JSON.parse(links[0]!.sent[0]!) as { id: string };
        links[0]!.events.message(encodeBytesReply(id, piece, new Uint8Array([7, 8, 9])));
        await tick();
        expect(settled).toBe(false);
    });

    test('a live frame reaches the handlers of its event with its header and bytes', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
        const received: Array<[unknown, number[]]> = [];
        const stop = transport.onLiveFrame('browser.frame', (header, bytes) => received.push([header, [...bytes]]));
        transport.onLiveFrame('device.frame', () => received.push(['device', []]));
        const header = { browserId: 'node-1', sequence: 3, width: 800, height: 600 };
        links[0]!.events.message(encodeLiveFrame({ event: 'browser.frame', payload: header, bytes: new Uint8Array([4, 5]) }));
        stop();
        links[0]!.events.message(encodeLiveFrame({ event: 'browser.frame', payload: header, bytes: new Uint8Array([6]) }));
        expect(received).toEqual([[header, [4, 5]]]);
    });

    test('a request goes out on the link and its reply comes back', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
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
        open(links[0]!);
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
        open(links[0]!, 'lan');
        expect(transport.connection.signaled).toBe('lan');
        links[0]!.events.close('The direct connection closed');
        expect(transport.connection.signaled).toBeNull();
    });

    test('a link opens only once the machine answered the protocol check, and carries the features it named', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        expect(transport.status).toBe('connecting');
        expect(links[0]!.checks).toHaveLength(1);
        answerCheck(links[0]!, ['chat.list']);
        expect(transport.connection).toMatchObject({ status: 'open', features: ['chat.list'] });

        transport.reconnect();
        await tick(600);
        expect(transport.connection.features).toEqual(['chat.list']);
        open(links[1]!, undefined, ['chat.list', 'session.attach']);
        expect(transport.connection.features).toEqual(['chat.list', 'session.attach']);
        transport.dispose();
    });

    test('a machine that names no features is refused as older, on whatever link it comes over', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        links[0]!.events.message(JSON.stringify({ id: 'protocol', ok: true, result: { protocol: PROTOCOL_VERSION } }));
        expect(transport.status).toBe('closed');
        expect(transport.connection.failure).toBe(i18next.t('machines:protocol.daemon-older'));
        expect(links[0]!.closed).toBe(true);
        await tick(600);
        expect(links).toHaveLength(2);
        transport.dispose();
    });

    test('a machine that never answers the protocol check fails the attempt and is tried again', async () => {
        const transport = new LinkTransport(
            'ws://machine/ws',
            (_url, events) => {
                const link = new FakeLink(events);
                links.push(link);
                return link;
            },
            { gateTimeoutMs: 20 }
        );
        const links: FakeLink[] = [];
        await tick();
        links[0]!.events.open();
        await tick(19);
        expect(transport.status).toBe('connecting');
        await tick(2);
        expect(transport.status).toBe('closed');
        expect(transport.connection.failure).toBe(i18next.t('machines:connection.noAnswer', { seconds: 0 }));
        expect(links[0]!.closed).toBe(true);
        await tick(600);
        expect(links).toHaveLength(2);
        transport.dispose();
    });

    test('an answer to the protocol check ends the wait', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
        await tick(30_000);
        expect(transport.status).toBe('open');
        transport.dispose();
    });

    test('a route the link names while the protocol check is out is the route the open link has', async () => {
        const { transport, links } = setup();
        await tick();
        links[0]!.events.open();
        links[0]!.events.route?.(true);
        expect(transport.status).toBe('connecting');
        answerCheck(links[0]!, ['chat.list']);
        expect(transport.connection).toMatchObject({ status: 'open', relayed: true });
        transport.dispose();
    });

    test('a link that opens before the opener returned still gets the protocol check', async () => {
        const links: FakeLink[] = [];
        const transport = new LinkTransport('ws://machine/ws', (_url, events) => {
            events.open();
            const link = new FakeLink(events);
            links.push(link);
            return link;
        });
        await tick();
        expect(links[0]!.checks).toHaveLength(1);
        answerCheck(links[0]!, ['chat.list']);
        expect(transport.status).toBe('open');
        transport.dispose();
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
        open(links[1]!);
        expect(transport.connection).toMatchObject({ status: 'open', attempts: 0, failure: null });
        expect(statuses).toEqual(['closed', 'connecting', 'open']);
        transport.dispose();
    });

    test('reconnect replaces the link and nothing the old one says afterwards counts', async () => {
        const { transport, links } = setup();
        const events: unknown[] = [];
        transport.on('session.list-changed', (payload) => events.push(payload));
        await tick();
        open(links[0]!);

        transport.reconnect();
        expect(links[0]!.closed).toBe(true);
        await tick(600);
        expect(links).toHaveLength(2);
        links[0]!.events.message(JSON.stringify({ type: 'event', event: 'session.list-changed', payload: {} }));
        open(links[0]!);
        expect(events).toEqual([]);
        expect(transport.status).toBe('connecting');

        open(links[1]!);
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
        open(opened[1]!);
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
        open(links[0]!);
        const reply = transport.request('session.list', {});
        transport.reconnect();
        expect(links[0]!.closed).toBe(true);
        await expect(reply).rejects.toThrow(/closed before the machine answered/);
        await tick();
        expect(links).toHaveLength(2);
        expect(transport.status).toBe('connecting');
        open(links[1]!);
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
        open(links[0]!);
        links[0]!.events.close('The machine stopped answering over the direct connection');
        expect(lines.some((line) => line.includes('The machine stopped answering over the direct connection'))).toBe(true);
        transport.dispose();
    });

    describe('request timeout', () => {
        async function opened() {
            const links: FakeLink[] = [];
            const transport = new LinkTransport(
                'ws://machine/ws',
                (_url, events) => {
                    const link = new FakeLink(events);
                    links.push(link);
                    return link;
                },
                { requestTimeoutMs: 50 }
            );
            await tick();
            open(links[0]!);
            return { transport, link: links[0]! };
        }

        function idOf(link: FakeLink, index: number): string {
            return (JSON.parse(link.sent[index]!) as { id: string }).id;
        }

        test('a request the machine never answers fails once its time is up, and a late reply is dropped', async () => {
            const { transport, link } = await opened();
            const reply = transport.request('session.list', {});
            let settled = false;
            reply.catch(() => undefined).finally(() => (settled = true));
            await tick(49);
            expect(settled).toBe(false);
            await tick(1);
            await expect(reply).rejects.toMatchObject({ code: 'timeout' });
            link.events.message(JSON.stringify({ id: idOf(link, 0), ok: true, result: { sessions: [] } }));
        });

        test('a reply in time settles the request and no timeout follows it', async () => {
            const { transport, link } = await opened();
            const reply = transport.request('session.list', {});
            link.events.message(JSON.stringify({ id: idOf(link, 0), ok: true, result: { sessions: [] } }));
            expect(await reply).toEqual({ sessions: [] });
            await tick(60);
        });

        test('a long request waits past the timeout for its answer', async () => {
            const { transport } = await opened();
            const reply = transport.request('ondevice.generate', { id: 'g1', purpose: 'explain', prompt: 'What does this do?' });
            let settled = false;
            reply.catch(() => undefined).finally(() => (settled = true));
            await tick(60);
            expect(settled).toBe(false);
            transport.dispose();
            await expect(reply).rejects.toThrow(/closed before the machine answered/);
        });

        test('bundling and fetching a whole history wait past the timeout', async () => {
            const { transport } = await opened();
            const replies = [transport.request('git.bundle', {} as never), transport.request('git.fetchBundle', {} as never)];
            let settled = 0;
            for (const reply of replies) {
                reply.catch(() => undefined).finally(() => settled++);
            }
            await tick(60);
            expect(settled).toBe(0);
            transport.dispose();
            await Promise.allSettled(replies);
        });

        test('installing an agent and updating a CLI wait past the timeout, since the machine downloads them', async () => {
            const { transport } = await opened();
            const replies = [transport.request('provider.installAgent', { id: 'agent' }), transport.request('provider.update', { provider: 'claude' })];
            let settled = 0;
            for (const reply of replies) {
                reply.catch(() => undefined).finally(() => settled++);
            }
            await tick(60);
            expect(settled).toBe(0);
            transport.dispose();
            await Promise.allSettled(replies);
        });
    });

    test('pending requests fail when the link goes, and a disposed transport stays down', async () => {
        const { transport, links } = setup();
        await tick();
        open(links[0]!);
        const reply = transport.request('session.list', {});
        transport.dispose();
        await expect(reply).rejects.toThrow(/closed before the machine answered/);
        await tick(600);
        expect(links).toHaveLength(1);
    });

    describe('reconnect jitter', () => {
        function jittered(random: () => number) {
            const links: FakeLink[] = [];
            const transport = new LinkTransport(
                'ws://machine/ws',
                (_url, events) => {
                    const link = new FakeLink(events);
                    links.push(link);
                    return link;
                },
                { random }
            );
            return { transport, links };
        }

        test('the first retry waits half the backoff at least', async () => {
            const { transport, links } = jittered(() => 0);
            await tick();
            links[0]!.events.close(null);
            await tick(249);
            expect(links).toHaveLength(1);
            await tick(1);
            expect(links).toHaveLength(2);
            transport.dispose();
        });

        test('the first retry waits the whole backoff at most', async () => {
            const { transport, links } = jittered(() => 1);
            await tick();
            links[0]!.events.close(null);
            await tick(499);
            expect(links).toHaveLength(1);
            await tick(1);
            expect(links).toHaveLength(2);
            transport.dispose();
        });

        test('dispose leaves no timer behind', async () => {
            const { transport, links } = jittered(() => 0.5);
            await tick();
            links[0]!.events.close(null);
            await tick();
            transport.dispose();
            expect(jest.getTimerCount()).toBe(0);
        });
    });
    describe('reports', () => {
        function reported(options: { requestTimeoutMs?: number } = {}) {
            const links: FakeLink[] = [];
            const problems: LinkProblem[] = [];
            const transport = new LinkTransport(
                'ws://machine/ws',
                (_url, events) => {
                    const link = new FakeLink(events);
                    links.push(link);
                    return link;
                },
                { ...options, report: (problem) => problems.push(problem), log: { info: () => undefined, warn: () => undefined } }
            );
            return { transport, links, problems };
        }

        test('a link that drops while open, with its close code, and not one this transport closed itself', async () => {
            const { transport, links, problems } = reported();
            await tick();
            open(links[0]!);
            links[0]!.events.close(null, 1006);
            expect(problems).toEqual([{ kind: 'dropped', code: 1006 }]);
            await tick(600);
            open(links[1]!);
            transport.reconnect();
            await tick();
            open(links[2]!);
            transport.dispose();
            await tick();
            expect(problems).toEqual([{ kind: 'dropped', code: 1006 }]);
        });

        test('an attempt that fails before it opened is no drop', async () => {
            const { transport, links, problems } = reported();
            await tick();
            links[0]!.events.close(null, 1006);
            expect(problems).toEqual([]);
            transport.dispose();
        });

        test('a request without an answer in time, by its type only', async () => {
            const { transport, links, problems } = reported({ requestTimeoutMs: 50 });
            await tick();
            open(links[0]!);
            const reply = transport.request('session.list', {});
            reply.catch(() => undefined);
            await tick(50);
            expect(problems).toEqual([{ kind: 'timeout', request: 'session.list' }]);
            transport.dispose();
        });

        test('a machine refused at the protocol check, with the reason', async () => {
            const { transport, links, problems } = reported();
            await tick();
            links[0]!.events.open();
            links[0]!.events.message(JSON.stringify({ id: 'protocol', ok: true, result: { protocol: PROTOCOL_VERSION } }));
            expect(problems).toEqual([{ kind: 'refused', mismatch: 'daemon-older' }]);
            transport.dispose();
        });
    });
});

describe('what the transport measures', () => {
    function measured(options: { gateTimeoutMs?: number; socket?: boolean } = {}) {
        let clock = 1_000;
        const metrics: PageMetric[] = [];
        const links: FakeLink[] = [];
        const transport = new LinkTransport(
            'ws://machine/ws',
            (_url, events) => {
                const link = new FakeLink(events);
                links.push(link);
                return link;
            },
            {
                now: () => clock,
                random: () => 0,
                ...(options.gateTimeoutMs === undefined ? {} : { gateTimeoutMs: options.gateTimeoutMs }),
                meter: linkMetrics(
                    (metric) => metrics.push(metric),
                    () => options.socket ?? false
                )
            }
        );
        return {
            transport,
            links,
            metrics,
            advance(ms: number) {
                clock += ms;
            }
        };
    }

    test('link.connect: the time an attempt took to open, by the path it went', async () => {
        const run = measured();
        await tick();
        run.advance(240);
        run.links[0]!.events.route?.(true);
        open(run.links[0]!, 'broker');
        expect(run.metrics).toEqual([{ kind: 'distribution', name: 'link.connect', value: 240, attributes: { path: 'turn', outcome: 'ok' } }]);
        run.transport.dispose();
    });

    test('link.connect and link.reconnect: a failed attempt, with the time until it failed and why', async () => {
        const run = measured({ gateTimeoutMs: 20 });
        await tick();
        run.links[0]!.events.open('lan');
        run.advance(20);
        await tick(21);
        expect(run.metrics).toEqual([
            { kind: 'distribution', name: 'link.connect', value: 20, attributes: { path: 'lan', outcome: 'failed' } },
            { kind: 'count', name: 'link.reconnect', attributes: { reason: 'timeout' } }
        ]);
        run.transport.dispose();
    });

    test('link.reconnect: an open link that drops, and this machine socket as the local path', async () => {
        const run = measured({ socket: true });
        await tick();
        open(run.links[0]!);
        run.links[0]!.events.close('gone', 1006);
        expect(run.metrics.map((metric) => (metric.name === 'link.reconnect' ? metric.attributes.reason : metric.attributes))).toEqual([
            { path: 'local', outcome: 'ok' },
            'dropped'
        ]);
        run.transport.dispose();
    });

    test('request.duration: the wait for an answer, by the area of the request and nothing else', async () => {
        const run = measured();
        await tick();
        open(run.links[0]!);
        const reply = run.transport.request('session.detach', { sessionId: 'node-1' });
        const frame = JSON.parse(run.links[0]!.sent[0]!) as { id: string };
        run.advance(35);
        run.links[0]!.events.message(JSON.stringify({ id: frame.id, ok: true, result: {} }));
        await reply;
        expect(run.metrics.at(-1)).toEqual({ kind: 'distribution', name: 'request.duration', value: 35, attributes: { area: 'session' } });
        run.transport.dispose();
    });
});
