import type { UiMapSource } from '@adecore/agents-react';
import { MAPS_URL, type MapsTicket } from '@ruimte/pulsar';

// A ticket is asked for again this long before it ends, so a map being panned never meets the end of one.
const REFRESH_MARGIN_MS = 5 * 60_000;

// The shortest wait before a renewal, so a ticket that arrives nearly over cannot start a loop.
const MIN_RENEW_DELAY_MS = 30_000;

// What a ticket lasts when the address book does not say when it issued it; the lifetime a client accepts is capped at twice that.
const DEFAULT_LIFETIME_MS = 3_600_000;

// After a failed ask the next one waits this long, doubling with every failure in a row up to the cap, so a service that is down is not asked for with every tile.
const RETRY_AFTER_FAILURE_MS = 60_000;
const MAX_RETRY_MS = 10 * 60_000;

type MapTicketState = { state: 'none' } | { state: 'ready'; ticket: MapsTicket } | { state: 'failed'; since: number };

interface MapTicketsOptions {
    /* One ask of the address book for a ticket, with the session of the person signed in. */
    fetchTicket(): Promise<MapsTicket>;
    now(): number;
    /* Runs `run` after `ms`; the handle goes back to `cancel`. Injected so a test holds the clock still. */
    timers?: { after(run: () => void, ms: number): unknown; cancel(handle: unknown): void };
}

const REAL_TIMERS = { after: (run: () => void, ms: number): unknown => setTimeout(run, ms), cancel: (handle: unknown): void => clearTimeout(handle as number) };

interface Held {
    ticket: MapsTicket;
    /* On this client's clock: when the ticket arrived plus what it lasts, which the address book's clock cannot be trusted to give. */
    validUntil: number;
    renewAt: number;
}

/* A ticket as the client keeps it: its lifetime counted from its arrival, so a clock that is wrong in either direction changes nothing. */
function held(ticket: MapsTicket, arrived: number): Held {
    const stated = ticket.issuedAt === undefined ? DEFAULT_LIFETIME_MS : ticket.expiresAt - ticket.issuedAt;
    const lifetime = Math.min(Math.max(stated, 2 * MIN_RENEW_DELAY_MS), 2 * DEFAULT_LIFETIME_MS);
    return { ticket, validUntil: arrived + lifetime, renewAt: arrived + Math.max(MIN_RENEW_DELAY_MS, lifetime - REFRESH_MARGIN_MS, lifetime / 2) };
}

/*
 * The ticket the maps service accepts, held and renewed for every map on the page. A tile asks for
 * `header()` on each request, which is a read that also starts a renewal when one is due. While a map
 * listens, a timer asks again before the ticket ends and another after a failed ask; the ticket held
 * stays in use until it really ends, so a service that is down for a while does not blank a map that
 * had tiles. A ticket belongs to the account that asked for it: when the account changes or the source
 * goes inactive the ticket is dropped, and an ask still under way for the old one is thrown away.
 */
export class MapTickets {
    private readonly options: MapTicketsOptions;
    private readonly timers: NonNullable<MapTicketsOptions['timers']>;
    private current: Held | null = null;
    private failedAt: number | null = null;
    private failures = 0;
    private snapshot: MapTicketState = { state: 'none' };
    private pending: Promise<void> | null = null;
    private readonly listeners = new Set<() => void>();
    private refresh: unknown = null;
    private expiry: unknown = null;
    private identity: string | null = '';
    /* Bumped whenever the ticket stops belonging to whoever asked, so a late answer can be told from a current one. */
    private generation = 0;

    constructor(options: MapTicketsOptions) {
        this.options = options;
        this.timers = options.timers ?? REAL_TIMERS;
    }

    state(): MapTicketState {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        this.arm();
        return () => {
            this.listeners.delete(listener);
            this.arm();
        };
    }

    /*
     * For whom tickets are asked: the id of the account signed in, or null while the setting is off or nobody is signed in,
     * when nothing is asked, no timer runs and the ticket held is dropped. Another account is another ticket.
     */
    setIdentity(identity: string | null): void {
        if (this.identity === identity) {
            return;
        }
        this.identity = identity;
        this.generation++;
        this.current = null;
        this.failedAt = null;
        this.failures = 0;
        this.pending = null;
        this.publish();
    }

    ensure(): Promise<void> {
        if (this.pending !== null || this.identity === null) {
            return this.pending ?? Promise.resolve();
        }
        const now = this.options.now();
        const due = this.current === null || this.current.renewAt <= now;
        if (!due || (this.failedAt !== null && now < this.failedAt + this.retryDelay())) {
            return Promise.resolve();
        }
        const generation = this.generation;
        const ask: Promise<void> = this.options
            .fetchTicket()
            .then(
                (ticket) => {
                    if (generation === this.generation) {
                        this.current = held(ticket, this.options.now());
                        this.failedAt = null;
                        this.failures = 0;
                    }
                },
                () => {
                    if (generation === this.generation) {
                        this.failedAt = this.options.now();
                        this.failures++;
                    }
                }
            )
            .finally(() => {
                if (generation === this.generation) {
                    this.pending = null;
                    this.publish();
                }
            });
        this.pending = ask;
        return ask;
    }

    /* The `authorization` header of a request to the maps service, or null while inactive or when no ticket is held; a held ticket past its end counts as none. */
    header(): string | null {
        if (this.identity === null) {
            return null;
        }
        void this.ensure();
        const ticket = this.current;
        return ticket !== null && ticket.validUntil > this.options.now() ? `Bearer ${ticket.ticket.ticket}` : null;
    }

    private retryDelay(): number {
        return Math.min(RETRY_AFTER_FAILURE_MS * 2 ** Math.max(0, this.failures - 1), MAX_RETRY_MS);
    }

    private derive(): MapTicketState {
        if (this.current !== null && this.current.validUntil > this.options.now()) {
            return { state: 'ready', ticket: this.current.ticket };
        }
        return this.failedAt === null ? { state: 'none' } : { state: 'failed', since: this.failedAt };
    }

    private publish(): void {
        const next = this.derive();
        const same =
            next.state === this.snapshot.state && (next.state !== 'ready' || (this.snapshot.state === 'ready' && this.snapshot.ticket === next.ticket));
        if (!same) {
            this.snapshot = next;
            for (const listener of this.listeners) {
                listener();
            }
        }
        this.arm();
    }

    /* Timers run only while a map listens: one for the renewal or the retry, one for the moment the ticket ends. */
    private arm(): void {
        for (const handle of [this.refresh, this.expiry]) {
            if (handle !== null) {
                this.timers.cancel(handle);
            }
        }
        this.refresh = null;
        this.expiry = null;
        if (this.listeners.size === 0 || this.identity === null) {
            return;
        }
        const now = this.options.now();
        const renewAt = this.current === null ? now : this.current.renewAt;
        const retryAt = this.failedAt === null ? 0 : this.failedAt + this.retryDelay();
        this.refresh = this.timers.after(() => void this.ensure(), Math.max(0, Math.max(renewAt, retryAt) - now));
        if (this.current !== null && this.current.validUntil > now) {
            this.expiry = this.timers.after(() => this.publish(), this.current.validUntil - now);
        }
    }
}

interface MapSourceInput {
    /* The "Map tiles" setting. */
    enabled: boolean;
    signedIn: boolean;
    tickets: Pick<MapTickets, 'header'> & { state(): MapTicketState };
}

const MAPS_ORIGIN = new URL(MAPS_URL).origin;

/* The request, with the ticket in a header when it goes to the maps service and nowhere else. */
function transformRequest(url: string, header: () => string | null): { url: string; headers?: Record<string, string> } {
    let origin: string;
    try {
        origin = new URL(url).origin;
    } catch {
        return { url };
    }
    const authorization = origin === MAPS_ORIGIN ? header() : null;
    return authorization === null ? { url } : { url, headers: { authorization } };
}

/*
 * What a chat map draws with: Ruimte's tiles while the setting is on, a person is signed in and a ticket is
 * held, and the reason it is not otherwise. A ticket that is still being asked for reads as `unavailable`, so
 * the map starts as the outline and takes the tiles when they can be had.
 */
export function mapSourceFor({ enabled, signedIn, tickets }: MapSourceInput): UiMapSource {
    if (!enabled) {
        return { state: 'off', reason: 'disabled' };
    }
    if (!signedIn) {
        return { state: 'off', reason: 'signed-out' };
    }
    if (tickets.state().state !== 'ready') {
        return { state: 'off', reason: 'unavailable' };
    }
    return {
        state: 'tiles',
        styleUrl: (theme) => `${MAPS_URL}/v1/style?theme=${theme}`,
        transformRequest: (url) => transformRequest(url, () => tickets.header()),
        // Orbis tiles carry every translation as `name_<language>`.
        labelField: (language) => `name_${language}`,
        attribution: '© TomTom'
    };
}
