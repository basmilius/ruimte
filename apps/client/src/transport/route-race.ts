import i18next from 'i18next';
import type { LanDoor } from '@ruimte/contracts';
import { lanDoorUrl } from '@ruimte/pulsar';
import type { LinkOpener } from './link-transport';
import type { Signaling, SignalingOpener } from './signaling';
import type { SignalRoute } from './transport';

/* How long the doors on the local network have to themselves before the broker is asked as well. */
export const LAN_HEAD_START_MS = 1_000;

/* How long a machine's doors are left alone after an attempt through one of them came to nothing. */
export const LAN_SKIP_MS = 5 * 60_000;

/* The one timer a race needs, so a test moves it by hand. Returns what cancels it. */
export interface RaceClock {
    after(ms: number, run: () => void): () => void;
}

const systemClock: RaceClock = {
    after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};

export interface RaceOptions {
    /* One opener per door address the machine reported; empty where the local network is not tried. */
    lan: readonly SignalingOpener[];
    broker: SignalingOpener | null;
    /* The route that carries the attempt, once one is ready. */
    onRoute?(route: SignalRoute): void;
    clock?: RaceClock;
    headStartMs?: number;
}

interface Candidate {
    route: SignalRoute;
    signaling: Signaling | null;
    done: boolean;
}

/*
 * The signals of one attempt over whichever route answers first. Every door on the local network is
 * tried at once and the broker joins after the head start, or as soon as every door has failed. The
 * first that is ready carries the attempt and the others close, so there is one peer connection per
 * attempt whatever the route. Without a door to try it is the broker alone, as it always was.
 */
export function raceSignaling(options: RaceOptions): SignalingOpener {
    return (connectionId, events) => {
        const clock = options.clock ?? systemClock;
        const candidates: Candidate[] = [];
        let winner: Candidate | null = null;
        let finished = false;
        let starting = true;
        let brokerOpened = false;
        let lanFailure: string | null = null;
        let brokerFailure: string | null = null;
        let cancelHeadStart: (() => void) | null = null;

        const stopHeadStart = (): void => {
            cancelHeadStart?.();
            cancelHeadStart = null;
        };

        const closeAll = (keep: Candidate | null): void => {
            for (const candidate of candidates) {
                if (candidate !== keep && !candidate.done) {
                    candidate.done = true;
                    candidate.signaling?.close();
                }
            }
        };

        const finish = (reason: string): void => {
            if (finished) {
                return;
            }
            finished = true;
            stopHeadStart();
            closeAll(null);
            events.fail(reason);
        };

        const openBroker = (): void => {
            if (brokerOpened || options.broker === null || finished || winner !== null) {
                return;
            }
            brokerOpened = true;
            stopHeadStart();
            launch('broker', options.broker);
        };

        const afterLoss = (): void => {
            if (starting || winner !== null || finished) {
                return;
            }
            const lanLeft = candidates.some((candidate) => candidate.route === 'lan' && !candidate.done);
            if (!lanLeft && !brokerOpened && options.broker !== null) {
                openBroker();
                return;
            }
            if (candidates.every((candidate) => candidate.done)) {
                finish(brokerFailure ?? lanFailure ?? i18next.t('machines:route.none'));
            }
        };

        const launch = (route: SignalRoute, opener: SignalingOpener): void => {
            const candidate: Candidate = { route, signaling: null, done: false };
            candidates.push(candidate);
            const signaling = opener(connectionId, {
                ready: (iceServers) => {
                    if (candidate.done || finished || winner !== null) {
                        return;
                    }
                    winner = candidate;
                    stopHeadStart();
                    closeAll(candidate);
                    options.onRoute?.(route);
                    events.ready(iceServers);
                },
                signal: (signal) => {
                    if (winner === candidate && !finished) {
                        events.signal(signal);
                    }
                },
                fail: (reason) => {
                    if (candidate.done || finished) {
                        return;
                    }
                    candidate.done = true;
                    if (winner === candidate) {
                        finished = true;
                        events.fail(reason);
                        return;
                    }
                    if (route === 'lan') {
                        lanFailure = reason;
                    } else {
                        brokerFailure = reason;
                    }
                    afterLoss();
                }
            });
            candidate.signaling = signaling;
            // A route that failed while it was being opened has nothing left to hold on to.
            if (candidate.done) {
                signaling.close();
            }
        };

        if (options.lan.length === 0 && options.broker === null) {
            events.fail(i18next.t('machines:route.none'));
            return { send: () => undefined, close: () => undefined };
        }
        for (const opener of options.lan) {
            if (winner !== null || finished) {
                break;
            }
            launch('lan', opener);
        }
        starting = false;
        if (options.lan.length === 0) {
            openBroker();
        } else if (options.broker !== null && winner === null && !finished) {
            cancelHeadStart = clock.after(options.headStartMs ?? LAN_HEAD_START_MS, openBroker);
        }
        afterLoss();

        return {
            send: (signal) => {
                if (!finished) {
                    winner?.signaling?.send(signal);
                }
            },
            close: () => {
                finished = true;
                stopHeadStart();
                closeAll(null);
            }
        };
    };
}

/* Which machines' doors this page leaves alone for now, in memory only: a reload tries the local network again. */
export class LanSkips {
    private readonly until = new Map<string, number>();
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    note(machineId: string): void {
        this.until.set(machineId, this.now() + LAN_SKIP_MS);
    }

    skips(machineId: string): boolean {
        const until = this.until.get(machineId);
        if (until === undefined) {
            return false;
        }
        if (until <= this.now()) {
            this.until.delete(machineId);
            return false;
        }
        return true;
    }
}

export const lanSkips = new LanSkips();

/*
 * The door URLs an attempt tries for a row. None on the station: a page served over https may not
 * open a plain ws:// socket, and least of all to a private address.
 */
export function lanDoorUrls(lan: LanDoor | null | undefined, station: boolean): string[] {
    return station || !lan ? [] : lan.addresses.map((address) => lanDoorUrl(address, lan.port));
}

export interface RoutedLinkOptions {
    /* The machine's own id, which the doors are skipped under. */
    machineId: string;
    lan: readonly SignalingOpener[];
    broker: SignalingOpener | null;
    skips: LanSkips;
    /* The link that runs on the race's signals: a WebRTC link in the app, a fake in a test. */
    link(signaling: SignalingOpener): LinkOpener;
    clock?: RaceClock;
    headStartMs?: number;
}

/*
 * A link to a machine reached through a route rather than its own address. The open link says which
 * route its signals took. An attempt the door carried that never opened is most likely a door this
 * network cannot use (a guest network, ICE that does not cross a VPN), so the next attempts go
 * straight to the broker for a while instead of failing the same way again.
 */
export function routedLink(options: RoutedLinkOptions): LinkOpener {
    return (url, events) => {
        let route: SignalRoute | null = null;
        let opened = false;
        // Without a broker the doors are the only way in, so they are tried whatever happened last time.
        const skipLan = options.broker !== null && options.skips.skips(options.machineId);
        const signaling = raceSignaling({
            lan: skipLan ? [] : options.lan,
            broker: options.broker,
            onRoute: (winner) => {
                route = winner;
            },
            ...(options.clock ? { clock: options.clock } : {}),
            ...(options.headStartMs === undefined ? {} : { headStartMs: options.headStartMs })
        });
        return options.link(signaling)(url, {
            message: (data) => events.message(data),
            route: (relayed) => events.route?.(relayed),
            open: () => {
                opened = true;
                events.open(route ?? undefined);
            },
            close: (failure) => {
                if (!opened && failure !== null && route === 'lan') {
                    options.skips.note(options.machineId);
                }
                events.close(failure);
            }
        });
    };
}
