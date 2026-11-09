import { messageOf } from '@adecore/ui';
import {
    EVENT_SCHEMAS,
    REQUEST_SCHEMAS,
    decodeBytesReply,
    decodeLiveFrame,
    isEventType,
    parseServerFrame,
    type BytesReadPayload,
    type EventMap,
    type EventType,
    type LiveFrameEvent,
    type RequestMap,
    REQUEST_TIMEOUT_MS,
    type RequestType
} from '@ruimte/contracts';
import i18next from 'i18next';
import type { LinkProblem } from '@/telemetry/events';
import type { LinkMeter, ReconnectReason } from '@/telemetry/metrics';
import type { BytesPiece } from '../transport-api/piece';
import { TransportError, type ConnectionState, type LiveFrameHandler, type SignalRoute, type TransportStatus } from '../transport-api/transport';
import type { PooledTransport } from './pool';
import { protocolGate } from './protocol';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

// A daemon address that has not resolved by then (a fetch for a ticket that hangs) is an attempt that failed, not one to wait on.
const ADDRESS_TIMEOUT_MS = 20_000;

// A machine that accepted the link but has not answered the protocol check by then is an attempt that failed.
const GATE_TIMEOUT_MS = 20_000;

// A drop the reconnect mends within this time (a daemon restart, a Mac waking) is only a metric, not a report.
const DROP_GRACE_MS = 30_000;

/*
 * Whether a request's wait says how quick the link is. One that waits on a network, a model or a database says how
 * slow that was, and `bytes.read` comes as a stream of pieces, dozens a second while a video plays.
 */
function measuredRequest(type: RequestType): boolean {
    return type !== 'bytes.read' && !UNBOUNDED_REQUESTS.has(type);
}

// Requests whose answer waits on a network, a model, a database or a large transfer, and that a caller ends itself.
const UNBOUNDED_REQUESTS: ReadonlySet<RequestType> = new Set<RequestType>([
    'archive.extract',
    'artifact.importFrom',
    'chat.continueOn',
    'extension.agentRun',
    'extension.action',
    'extension.agentStart',
    'extension.clientFiles',
    'extension.agentStream',
    'extension.databaseQuery',
    'extension.call',
    'chat.summarize',
    'database.request',
    'device.boot',
    'git.action',
    'git.bundle',
    'git.clone',
    'git.fetchBundle',
    'git.operation',
    'git.resolveAi',
    'git.suggestMessage',
    'git.worktree-add',
    'git.worktree-merge',
    'language.install',
    'language.rollback',
    'language.workspaceProblems',
    'editor.generate',
    'provider.installAgent',
    'provider.installServer',
    'provider.update',
    'usage.refreshLimits'
]);

/* Where the next connection opens. A function, because the address carries a credential that is signed for per connection. */
export type SocketAddress = string | (() => Promise<string>);

/* One connection to a daemon, whatever carries it: a WebSocket, or a DataChannel with the handshake run on it. */
export interface Link {
    send(data: string): void;
    /* Ends the link; its `close` event still fires, once. */
    close(): void;
}

export interface LinkEvents {
    /* `signaled` says which way a direct connection's signals went, when they went over a route rather than the machine's own socket. */
    open(signaled?: SignalRoute): void;
    /* A text frame, or a binary one (a `bytes.read` reply that asked for it). */
    message(data: string | Uint8Array): void;
    /* The path of an open link changed: through a TURN relay or not. Only a direct connection says. */
    route?(relayed: boolean): void;
    /* The link is gone. `failure` says why when that is worth showing a person; null for an ordinary close. `code` is a socket's close code. */
    close(failure: string | null, code?: number): void;
}

/* Opens a link on an address the transport resolved for this attempt. The transport runs the protocol check on whatever it returns. */
export type LinkOpener = (url: string, events: LinkEvents) => Link;

interface LinkTransportOptions {
    addressTimeoutMs?: number;
    gateTimeoutMs?: number;
    requestTimeoutMs?: number;
    dropGraceMs?: number;
    // Spreads the reconnects of many clients after a daemon restart; a test passes a fixed one.
    random?: () => number;
    now?: () => number;
    log?: Pick<Console, 'info' | 'warn'>;
    /* A link that dropped while open and stayed down, a request without an answer in time, a machine refused at the check: for a crash report. */
    report?: (problem: LinkProblem) => void;
    meter?: LinkMeter;
}

const NO_METER: LinkMeter = { connected: () => undefined, reconnecting: () => undefined, answered: () => undefined };

interface Pending {
    type: RequestType;
    sentAt: number;
    callSite: Error | undefined;
    resolve(result: unknown): void;
    reject(error: TransportError): void;
    // Asked by `readBytes`, which resolves with the `BytesPiece` of a binary reply; a JSON answer is no reply to it.
    bytes?: true;
    timer?: ReturnType<typeof setTimeout>;
}

/*
 * A daemon's wire: requests with ids, events, and a reconnect loop, over whatever link the opener
 * hands back for each attempt. The loop, the pending requests and the event handlers belong to the
 * transport, so a link that is replaced (a reconnect, or a machine switched to or from a direct
 * connection) leaves every client built on this transport where it was.
 */
export class LinkTransport implements PooledTransport {
    private link: Link | null = null;
    // Which link the events belong to; a link that was replaced may still report, and nobody listens to it.
    private linkToken: object | null = null;
    private currentConnection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null, failure: null };
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<EventType, Set<(payload: never) => void>>();
    private readonly liveHandlers = new Map<LiveFrameEvent, Set<(header: never, bytes: Uint8Array) => void>>();
    private readonly pending = new Map<string, Pending>();
    private readonly openLink: LinkOpener;
    private readonly addressTimeoutMs: number;
    private readonly gateTimeoutMs: number;
    private readonly requestTimeoutMs: number;
    private readonly dropGraceMs: number;
    private dropTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly log: Pick<Console, 'info' | 'warn'>;
    private readonly report: (problem: LinkProblem) => void;
    private readonly meter: LinkMeter;
    private attemptStartedAt = 0;
    private nextId = 1;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private address: SocketAddress;
    private readonly random: () => number;
    private readonly now: () => number;
    // Bumped by anything that makes an attempt stale, so an address resolved slowly cannot open a link nobody wants.
    private generation = 0;

    constructor(address: SocketAddress, openLink: LinkOpener, options: LinkTransportOptions = {}) {
        this.address = address;
        this.openLink = openLink;
        this.addressTimeoutMs = options.addressTimeoutMs ?? ADDRESS_TIMEOUT_MS;
        this.gateTimeoutMs = options.gateTimeoutMs ?? GATE_TIMEOUT_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
        this.dropGraceMs = options.dropGraceMs ?? DROP_GRACE_MS;
        this.log = options.log ?? console;
        this.report = options.report ?? (() => undefined);
        this.meter = options.meter ?? NO_METER;
        this.random = options.random ?? Math.random;
        this.now = options.now ?? Date.now;
        this.connect();
    }

    get status(): TransportStatus {
        return this.currentConnection.status;
    }

    get connection(): ConnectionState {
        return this.currentConnection;
    }

    /*
     * Says where the next connection goes without touching the one that is open. A socket that moved to
     * another endpoint id needs exactly this, since the machine did not change, only what this client
     * calls it, and closing would drop every session attached to it.
     */
    retarget(address: SocketAddress): void {
        this.address = address;
    }

    /* Points the transport at another address of the same daemon; it closes and comes back there. */
    switchTo(address: SocketAddress): void {
        if (address === this.address) {
            return;
        }
        this.address = address;
        this.reconnect();
    }

    /* Drops the link and opens a new one straight away, on whatever the opener picks now. */
    reconnect(): void {
        if (this.disposed) {
            return;
        }
        this.generation += 1;
        this.setConnection({ attempts: 0, retryAt: null, failure: null });
        this.stopReconnectTimer();
        const link = this.link;
        // Let go of the link before closing it, so the next attempt never waits on a close event the old link may not send.
        this.link = null;
        this.linkToken = null;
        if (link) {
            link.close();
            this.log.info('Reconnecting to the machine');
            this.rejectPending('disconnected', i18next.t('machines:connection.closedBeforeAnswer'));
        }
        this.meter.reconnecting('switch');
        this.connect();
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        return listenIn(this.eventHandlers, event, handler);
    }

    onLiveFrame<E extends LiveFrameEvent>(event: E, handler: LiveFrameHandler<E>): () => void {
        return listenIn(this.liveHandlers, event, handler);
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        return this.ask(type, payload, false);
    }

    readBytes(payload: BytesReadPayload): Promise<BytesPiece> {
        return this.ask('bytes.read', { ...payload, binary: true }, true);
    }

    dispose(): void {
        this.disposed = true;
        this.generation += 1;
        this.stopReconnectTimer();
        this.stopDropTimer();
        this.link?.close();
    }

    /* The first drop of a run of failed reconnects is the one reported, once the grace passed without a link. */
    private reportDropUnlessMended(code: number | null): void {
        if (this.dropTimer !== null) {
            return;
        }

        this.dropTimer = setTimeout(() => {
            this.dropTimer = null;

            if (!this.disposed && this.currentConnection.status !== 'open') {
                this.report({ kind: 'dropped', code });
            }
        }, this.dropGraceMs);
    }

    private stopDropTimer(): void {
        if (this.dropTimer !== null) {
            clearTimeout(this.dropTimer);
            this.dropTimer = null;
        }
    }

    private stopReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /* Every reconnect field moves in the same tick as the status it belongs to, so a subscriber
       that hears the status has the attempt count and the countdown that go with it. */
    private setConnection(next: Partial<ConnectionState>): void {
        const merged = { ...this.currentConnection, ...next };
        // The path is drawn on the machine's row as well, so a link that moved onto a relay or off one is news too.
        const changed =
            this.currentConnection.status !== merged.status ||
            this.currentConnection.relayed !== merged.relayed ||
            this.currentConnection.signaled !== merged.signaled;
        this.currentConnection = merged;
        if (!changed) {
            return;
        }
        for (const handler of this.statusHandlers) {
            handler(merged.status);
        }
    }

    private connect(): void {
        if (this.disposed) {
            return;
        }
        this.setConnection({ status: 'connecting', retryAt: null });
        this.attemptStartedAt = this.now();
        const generation = this.generation;
        const resolved = typeof this.address === 'string' ? Promise.resolve(this.address) : withTimeout(this.address(), this.addressTimeoutMs);
        void resolved.then(
            (url) => {
                if (generation === this.generation && !this.disposed) {
                    this.open(url);
                }
            },
            (e) => {
                if (generation !== this.generation || this.disposed) {
                    return;
                }
                // A daemon that will not say how to reach it is a daemon that is not reachable; the backoff is the same one.
                this.log.warn('Could not work out how to connect to the machine', e);
                this.meter.connected({ relayed: false, signaled: null }, 'failed', this.now() - this.attemptStartedAt);
                this.meter.reconnecting('address');
                this.scheduleReconnect();
                this.setConnection({ status: 'closed', failure: messageOf(e) });
            }
        );
    }

    private open(url: string): void {
        const token = {};
        this.linkToken = token;
        let link: Link | null = null;
        let signaled: SignalRoute | null = null;
        // The path as the link last said it, which can change while the protocol check is still out.
        let relayed = false;
        // A link that opens before the opener returned cannot be written to yet.
        let openedEarly = false;
        // Why the attempt ended before it opened, when the transport knows better than "it failed".
        let failedBecause: ReconnectReason | null = null;
        let gateTimer: ReturnType<typeof setTimeout> | null = null;
        const stopGateTimer = (): void => {
            if (gateTimer !== null) {
                clearTimeout(gateTimer);
                gateTimer = null;
            }
        };
        const gate = protocolGate({
            send: (data) => link?.send(data),
            open: (features) => {
                stopGateTimer();
                if (this.linkToken === token) {
                    this.stopDropTimer();
                    this.meter.connected({ relayed, signaled }, 'ok', this.now() - this.attemptStartedAt);
                    this.setConnection({ status: 'open', attempts: 0, retryAt: null, failure: null, relayed, signaled, features });
                }
            },
            message: (data) => {
                if (this.linkToken === token) {
                    this.receive(data);
                }
            },
            refuse: (failure, mismatch) => {
                this.report({ kind: 'refused', mismatch });
                failedBecause = 'refused';
                events.close(failure);
                link?.close();
            }
        });
        const events: LinkEvents = {
            open: (route) => {
                if (this.linkToken === token) {
                    signaled = route ?? null;
                    if (link === null) {
                        openedEarly = true;
                        return;
                    }
                    askGate();
                }
            },
            route: (next) => {
                if (this.linkToken !== token) {
                    return;
                }
                relayed = next;
                if (this.currentConnection.status === 'open') {
                    this.setConnection({ relayed });
                }
            },
            message: (data) => gate.received(data),
            close: (failure, code) => {
                stopGateTimer();
                if (this.linkToken !== token) {
                    return;
                }
                // A link this transport let go of reports no more, so whatever closes here closed on its own.
                const wasOpen = this.currentConnection.status === 'open';
                if (wasOpen && !this.disposed) {
                    this.reportDropUnlessMended(code ?? null);
                }
                if (!this.disposed) {
                    if (!wasOpen) {
                        this.meter.connected({ relayed, signaled }, 'failed', this.now() - this.attemptStartedAt);
                    }
                    this.meter.reconnecting(wasOpen ? 'dropped' : (failedBecause ?? 'failed'));
                }
                this.linkToken = null;
                this.link = null;
                if (failure === null) {
                    this.log.info('The connection to the machine closed');
                } else {
                    this.log.warn(`The connection to the machine closed: ${failure}`);
                }
                // Scheduling first, so the closed status arrives with the attempt it announces.
                this.scheduleReconnect();
                this.setConnection({ status: 'closed', failure, relayed: false, signaled: null });
                this.rejectPending('disconnected', i18next.t('machines:connection.closedBeforeAnswer'));
            }
        };
        const askGate = (): void => {
            gate.opened();
            gateTimer = setTimeout(() => {
                failedBecause = 'timeout';
                events.close(i18next.t('machines:connection.noAnswer', { seconds: Math.round(this.gateTimeoutMs / 1000) }));
                link?.close();
            }, this.gateTimeoutMs);
        };
        try {
            link = this.openLink(url, events);
        } catch (e) {
            // An opener that throws would otherwise leave the transport connecting forever, with no link and no timer.
            if (this.linkToken === token) {
                events.close(i18next.t('machines:connection.openFailed', { reason: messageOf(e) }));
            }
            return;
        }
        // A link that failed while it was being opened already reported, and is no link to keep.
        if (this.linkToken === token) {
            this.link = link;
            if (openedEarly) {
                askGate();
            }
        }
    }

    private scheduleReconnect(): void {
        if (this.disposed || this.reconnectTimer) {
            return;
        }
        // Equal jitter: half the backoff is certain, the other half is spread.
        const base = Math.min(RECONNECT_MIN_MS * 2 ** this.currentConnection.attempts, RECONNECT_MAX_MS);
        const delay = base / 2 + (this.random() * base) / 2;
        this.setConnection({ attempts: this.currentConnection.attempts + 1, retryAt: this.now() + delay });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private ask<R>(type: RequestType, payload: unknown, bytes: boolean): Promise<R> {
        if (this.status !== 'open' || !this.link) {
            return Promise.reject(new TransportError('not-connected', i18next.t('machines:connection.notConnected')));
        }
        const id = String(this.nextId++);
        // A stack per request costs; `bytes.read` asks dozens a second while a video plays, and its callers catch.
        const callSite = type === 'bytes.read' ? undefined : new Error(`${type} was asked here`);

        if (callSite !== undefined) {
            callSite.name = 'RequestCallSite';
        }

        const promise = new Promise<R>((resolve, reject) => {
            const entry: Pending = {
                type,
                sentAt: this.now(),
                callSite,
                resolve: resolve as (result: unknown) => void,
                reject,
                ...(bytes ? { bytes: true as const } : {})
            };
            if (!UNBOUNDED_REQUESTS.has(type)) {
                entry.timer = setTimeout(() => {
                    this.pending.delete(id);
                    this.report({ kind: 'timeout', request: type });
                    reject(
                        new TransportError('timeout', i18next.t('machines:connection.timedOut', { type, seconds: Math.round(this.requestTimeoutMs / 1000) }), {
                            request: type,
                            cause: callSite
                        })
                    );
                }, this.requestTimeoutMs);
            }
            this.pending.set(id, entry);
        });
        this.link.send(JSON.stringify({ id, type, payload }));
        return promise;
    }

    /* Hands back the request waiting on this id and forgets it, so a reply and its timeout never both settle it. */
    private takePending(id: string): Pending | undefined {
        const entry = this.pending.get(id);
        if (!entry) {
            return undefined;
        }
        this.pending.delete(id);
        clearTimeout(entry.timer);
        // Only an answer comes here; a request that timed out was taken off the list by its timer.
        if (measuredRequest(entry.type)) {
            const link = this.currentConnection;
            this.meter.answered({ relayed: link.relayed ?? false, signaled: link.signaled ?? null }, this.now() - entry.sentAt);
        }

        return entry;
    }

    private rejectPending(code: string, message: string): void {
        const entries = [...this.pending.values()];
        this.pending.clear();
        for (const entry of entries) {
            clearTimeout(entry.timer);
            entry.reject(new TransportError(code, message, { request: entry.type, cause: entry.callSite }));
        }
    }

    private receive(raw: string | Uint8Array): void {
        if (typeof raw !== 'string') {
            this.receiveBytes(raw);
            return;
        }
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch {
            console.warn('Dropped a server frame that is not JSON');
            return;
        }
        const parsed = parseServerFrame(json);
        if (!parsed.ok) {
            console.warn('Dropped a malformed server frame', parsed.message);
            return;
        }
        const frame = parsed.value;
        if ('event' in frame) {
            this.dispatchEvent(frame.event, frame.payload);
            return;
        }
        const { id } = frame;
        if (id === null) {
            // A reply without an id answers a frame the server could not read; nothing waits for it.
            console.warn('Server refused a frame', frame);
            return;
        }
        const entry = this.takePending(id);
        if (!entry) {
            return;
        }
        if (!frame.ok) {
            entry.reject(new TransportError(frame.error.code, frame.error.message, { request: entry.type, cause: entry.callSite }));
            return;
        }
        const result = REQUEST_SCHEMAS[entry.type].result.safeParse(frame.result);
        if (!result.success || entry.bytes) {
            entry.reject(
                new TransportError('bad-reply', i18next.t('machines:connection.badReply', { type: entry.type }), { request: entry.type, cause: entry.callSite })
            );
            return;
        }
        entry.resolve(result.data);
    }

    private receiveBytes(raw: Uint8Array): void {
        const reply = decodeBytesReply(raw);
        if (reply === null) {
            this.receiveLiveFrame(raw);
            return;
        }
        const entry = this.pending.get(reply.id);
        if (!entry?.bytes) {
            return;
        }
        this.takePending(reply.id);
        entry.resolve({ ...reply.result, bytes: reply.bytes } satisfies BytesPiece);
    }

    private receiveLiveFrame(raw: Uint8Array): void {
        const frame = decodeLiveFrame(raw);
        if (frame === null) {
            console.warn('Dropped a binary server frame this client cannot read');
            return;
        }
        for (const handler of this.liveHandlers.get(frame.event) ?? []) {
            (handler as (header: unknown, bytes: Uint8Array) => void)(frame.payload, frame.bytes);
        }
    }

    private dispatchEvent(event: string, payload: unknown): void {
        if (!isEventType(event)) {
            console.warn('Dropped an unknown event', event);
            return;
        }
        const parsed = EVENT_SCHEMAS[event].safeParse(payload);
        if (!parsed.success) {
            console.warn(`Dropped a malformed ${event} event`);
            return;
        }
        const handlers = this.eventHandlers.get(event);
        if (!handlers) {
            return;
        }
        for (const handler of handlers) {
            (handler as (payload: unknown) => void)(parsed.data);
        }
    }
}

function listenIn<K, H>(map: Map<K, Set<H>>, key: K, handler: H): () => void {
    const handlers = map.get(key) ?? new Set<H>();
    map.set(key, handlers);
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(i18next.t('machines:connection.noAddress', { seconds: Math.round(timeoutMs / 1000) }))), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (e: unknown) => {
                clearTimeout(timer);
                reject(e);
            }
        );
    });
}
