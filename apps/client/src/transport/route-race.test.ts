import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import type { IceServer } from '@ruimte/pulsar';
import type { LinkEvents, LinkOpener } from './link-transport';
import { LAN_HEAD_START_MS, LAN_SKIP_MS, LanSkips, lanDoorUrls, raceSignaling, routedLink, type RaceClock } from './route-race';
import type { Signal, SignalingEvents, SignalingOpener } from './signaling';
import type { SignalRoute } from './transport';

/* One route an attempt may take: it records what the race asked of it and lets the test answer for it. */
function fakeRoute() {
    const route = {
        opened: 0,
        closed: false,
        sent: [] as Signal[],
        events: null as SignalingEvents | null,
        opener: ((_connectionId, events) => {
            route.opened += 1;
            route.closed = false;
            route.events = events;
            return {
                send: (signal) => route.sent.push(signal),
                close: () => {
                    route.closed = true;
                }
            };
        }) as SignalingOpener,
        ready: (servers?: IceServer[]) => route.events!.ready(servers),
        fail: (reason: string) => route.events!.fail(reason),
        signal: (signal: Signal) => route.events!.signal(signal)
    };
    return route;
}

/* A clock that only moves when the test says so. */
function fakeClock() {
    let now = 0;
    const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
    const clock: RaceClock = {
        after: (ms, run) => {
            const timer = { at: now + ms, run, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        }
    };
    const advance = (ms: number): void => {
        now += ms;
        for (const timer of timers.filter((entry) => !entry.cancelled && entry.at <= now)) {
            timer.cancelled = true;
            timer.run();
        }
    };
    return { clock, advance };
}

function recorder() {
    const log = { ready: [] as Array<IceServer[] | undefined>, signals: [] as Signal[], failures: [] as string[], routes: [] as SignalRoute[] };
    const events: SignalingEvents = {
        ready: (servers) => log.ready.push(servers),
        signal: (signal) => log.signals.push(signal),
        fail: (reason) => log.failures.push(reason)
    };
    return { log, events, onRoute: (route: SignalRoute) => log.routes.push(route) };
}

describe('raceSignaling', () => {
    test('the first door that is ready carries the attempt, the others close and the broker is never asked', () => {
        const [first, second, broker] = [fakeRoute(), fakeRoute(), fakeRoute()];
        const { clock, advance } = fakeClock();
        const { log, events, onRoute } = recorder();
        const signaling = raceSignaling({ lan: [first.opener, second.opener], broker: broker.opener, clock, onRoute })('attempt-1', events);
        expect([first.opened, second.opened, broker.opened]).toEqual([1, 1, 0]);

        second.ready();
        expect(log.ready).toEqual([undefined]);
        expect(log.routes).toEqual(['lan']);
        expect(first.closed).toBe(true);
        expect(second.closed).toBe(false);

        advance(LAN_HEAD_START_MS);
        expect(broker.opened).toBe(0);

        signaling.send({ kind: 'offer', sdp: 'v=0' });
        expect(second.sent).toEqual([{ kind: 'offer', sdp: 'v=0' }]);
        expect(first.sent).toEqual([]);
        first.signal({ kind: 'answer', sdp: 'stale' });
        second.signal({ kind: 'answer', sdp: 'v=1' });
        expect(log.signals).toEqual([{ kind: 'answer', sdp: 'v=1' }]);
    });

    test('the broker joins after the head start, and carries the attempt when it is ready first', () => {
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const { clock, advance } = fakeClock();
        const { log, events, onRoute } = recorder();
        raceSignaling({ lan: [door.opener], broker: broker.opener, clock, onRoute })('attempt-1', events);

        advance(LAN_HEAD_START_MS - 1);
        expect(broker.opened).toBe(0);
        advance(1);
        expect(broker.opened).toBe(1);

        const turn = [{ urls: 'turn:turn.example.com', username: 'u', credential: 'c' }];
        broker.ready(turn);
        expect(log.ready).toEqual([turn]);
        expect(log.routes).toEqual(['broker']);
        expect(door.closed).toBe(true);
        // A door that answers late has lost already.
        door.ready();
        expect(log.ready).toHaveLength(1);
    });

    test('a door that fails before its head start is up brings the broker in at once', () => {
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const { clock } = fakeClock();
        const { log, events } = recorder();
        raceSignaling({ lan: [door.opener], broker: broker.opener, clock })('attempt-1', events);
        door.fail('connection refused');
        expect(broker.opened).toBe(1);
        expect(log.failures).toEqual([]);
    });

    test('without a door it is the broker alone, at once', () => {
        const broker = fakeRoute();
        const { clock } = fakeClock();
        const { log, events, onRoute } = recorder();
        raceSignaling({ lan: [], broker: broker.opener, clock, onRoute })('attempt-1', events);
        expect(broker.opened).toBe(1);
        broker.ready([]);
        expect(log.routes).toEqual(['broker']);
        broker.fail('The broker went away');
        expect(log.failures).toEqual(['The broker went away']);
    });

    test('with no broker and no door that works the attempt fails with a sentence', () => {
        const door = fakeRoute();
        const { clock, advance } = fakeClock();
        const failed = recorder();
        raceSignaling({ lan: [door.opener], broker: null, clock })('attempt-1', failed.events);
        advance(LAN_HEAD_START_MS * 10);
        expect(failed.log.failures).toEqual([]);
        door.fail('The door could not be reached');
        expect(failed.log.failures).toEqual(['The door could not be reached']);

        const nothing = recorder();
        raceSignaling({ lan: [], broker: null, clock })('attempt-2', nothing.events);
        expect(nothing.log.failures).toEqual([i18next.t('machines:route.none')]);
    });

    test('when every route failed, the broker says why', () => {
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const { clock, advance } = fakeClock();
        const { log, events } = recorder();
        raceSignaling({ lan: [door.opener], broker: broker.opener, clock })('attempt-1', events);
        advance(LAN_HEAD_START_MS);
        broker.fail('The machine is not connected to the broker');
        expect(log.failures).toEqual([]);
        door.fail('The door could not be reached');
        expect(log.failures).toEqual(['The machine is not connected to the broker']);
    });

    test('closing the attempt closes every route and keeps the broker from being asked', () => {
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const { clock, advance } = fakeClock();
        const { log, events } = recorder();
        const signaling = raceSignaling({ lan: [door.opener], broker: broker.opener, clock })('attempt-1', events);
        signaling.close();
        advance(LAN_HEAD_START_MS);
        expect(door.closed).toBe(true);
        expect(broker.opened).toBe(0);
        door.ready();
        expect(log.ready).toEqual([]);
    });
});

/* A link that runs on the race's signals and lets the test say whether its channel opened or failed. */
function fakeLink() {
    const link = {
        events: null as LinkEvents | null,
        signals: recorder(),
        opener: ((signaling: SignalingOpener): LinkOpener =>
            (_url, events) => {
                link.events = events;
                const opened = signaling('attempt', link.signals.events);
                return { send: () => undefined, close: () => opened.close() };
            }) as (signaling: SignalingOpener) => LinkOpener
    };
    return link;
}

function linkEvents() {
    const log = { opened: [] as Array<SignalRoute | undefined>, closed: [] as Array<string | null> };
    const events: LinkEvents = {
        open: (signaled) => log.opened.push(signaled),
        message: () => undefined,
        close: (failure) => log.closed.push(failure)
    };
    return { log, events };
}

describe('routedLink', () => {
    test('an open link says which route its signals took', () => {
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const link = fakeLink();
        const { log, events } = linkEvents();
        const { clock } = fakeClock();
        routedLink({ machineId: 'studio', lan: [door.opener], broker: broker.opener, skips: new LanSkips(), link: link.opener, clock })('wss://b', events);
        door.ready();
        link.events!.open();
        expect(log.opened).toEqual(['lan']);
    });

    test('an attempt through a door that never opened sends the next attempts to the broker for five minutes', () => {
        let now = 0;
        const skips = new LanSkips(() => now);
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const { clock } = fakeClock();
        const attempt = () => {
            const link = fakeLink();
            const { log, events } = linkEvents();
            routedLink({ machineId: 'studio', lan: [door.opener], broker: broker.opener, skips, link: link.opener, clock })('wss://b', events);
            return { link, log };
        };

        const first = attempt();
        door.ready();
        first.link.events!.close('No network path to the machine');
        expect(first.log.closed).toEqual(['No network path to the machine']);
        expect(skips.skips('studio')).toBe(true);

        const second = attempt();
        expect(door.opened).toBe(1);
        expect(broker.opened).toBe(1);
        broker.ready([]);
        second.link.events!.open();
        expect(second.log.opened).toEqual(['broker']);

        now += LAN_SKIP_MS;
        attempt();
        expect(door.opened).toBe(2);
    });

    test('a link that opened over a door, or one closed by a person, skips nothing', () => {
        const skips = new LanSkips(() => 0);
        const [door, broker] = [fakeRoute(), fakeRoute()];
        const { clock } = fakeClock();
        const opened = fakeLink();
        routedLink({ machineId: 'studio', lan: [door.opener], broker: broker.opener, skips, link: opened.opener, clock })('wss://b', linkEvents().events);
        door.ready();
        opened.events!.open();
        opened.events!.close('The direct connection closed');
        expect(skips.skips('studio')).toBe(false);

        const closed = fakeLink();
        routedLink({ machineId: 'studio', lan: [door.opener], broker: broker.opener, skips, link: closed.opener, clock })('wss://b', linkEvents().events);
        door.ready();
        closed.events!.close(null);
        expect(skips.skips('studio')).toBe(false);
    });

    test('without a broker the doors are tried whatever happened last time', () => {
        const skips = new LanSkips(() => 0);
        skips.note('studio');
        const door = fakeRoute();
        const { clock } = fakeClock();
        routedLink({ machineId: 'studio', lan: [door.opener], broker: null, skips, link: fakeLink().opener, clock })('', linkEvents().events);
        expect(door.opened).toBe(1);
    });
});

describe('lanDoorUrls', () => {
    const door = { port: 4220, addresses: ['192.168.1.20', 'fd00::5'] };

    test('every address the machine reported, an IPv6 one in brackets', () => {
        expect(lanDoorUrls(door, false)).toEqual(['ws://192.168.1.20:4220/signal', 'ws://[fd00::5]:4220/signal']);
        expect(lanDoorUrls(null, false)).toEqual([]);
        expect(lanDoorUrls(undefined, false)).toEqual([]);
    });

    test('the station never tries a door', () => {
        expect(lanDoorUrls(door, true)).toEqual([]);
    });
});
