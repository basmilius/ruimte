import {
    LAN_DOOR_PATH,
    LanDoorClientFrameSchema,
    lanDoorMessage,
    signalMessage,
    type LanDoorErrorCode,
    type LanDoorMachineFrame,
    type SignalEnvelope
} from '@ruimte/pulsar';
import type { Server, ServerWebSocket } from 'bun';
import { errorText } from '../error-text.ts';
import type { SignalGate } from './signal-gate.ts';

// An offer at the SDP limit with a statement on it fits; nothing a client sends is bigger.
const MAX_FRAME_BYTES = 64 * 1024;

// A client says hello the moment its socket opens; one that has not by then is no client.
export const HELLO_TIMEOUT_MS = 5_000;

// A socket carries one attempt, which is signaled in seconds; Bun closes one that sat silent this long.
const IDLE_TIMEOUT_S = 60;

// Sockets one address may open per minute, and hold open at once; a phone retrying is far below both.
export const ATTEMPTS_PER_MINUTE = 30;
export const OPEN_PER_ADDRESS = 8;

const MINUTE_MS = 60_000;

export interface DoorIdentity {
    machineId: string;
    publicKey: string;
    sign(message: string): string;
}

export interface DoorSocket {
    send(frame: LanDoorMachineFrame): void;
    close(code: number, reason: string): void;
    readonly open: boolean;
}

/*
 * One socket at the door: the client's hello first, answered with the machine's signature over the
 * client's nonce, then signals through the gate. Out of order, a second key or a signature that does
 * not hold closes the socket, since a client that does any of those is not one of ours.
 */
export class DoorSession {
    private readonly identity: DoorIdentity;
    private readonly gate: SignalGate;
    private readonly socket: DoorSocket;
    private greeted = false;
    private from: string | null = null;

    constructor(identity: DoorIdentity, gate: SignalGate, socket: DoorSocket) {
        this.identity = identity;
        this.gate = gate;
        this.socket = socket;
    }

    get hasGreeted(): boolean {
        return this.greeted;
    }

    async receive(raw: string): Promise<void> {
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch {
            this.refuse('bad-frame', 'Expected JSON');
            return;
        }
        const parsed = LanDoorClientFrameSchema.safeParse(json);
        if (!parsed.success) {
            this.refuse('bad-frame', 'Expected a hello or a signal');
            return;
        }
        const frame = parsed.data;
        if (frame.type === 'hello') {
            if (this.greeted) {
                this.refuse('bad-frame', 'A socket says hello once');
                return;
            }
            this.greeted = true;
            const { machineId, publicKey } = this.identity;
            this.socket.send({ type: 'door', machineId, publicKey, signature: this.identity.sign(lanDoorMessage(frame.nonce, machineId, publicKey)) });
            return;
        }
        if (!this.greeted) {
            this.refuse('bad-frame', 'Say hello first');
            return;
        }
        if (this.from !== null && this.from !== frame.from) {
            this.refuse('bad-frame', 'Every signal on a socket comes from one key');
            return;
        }
        this.from = frame.from;
        const from = frame.from;
        const outcome = await this.gate.accept(from, frame.envelope, frame.signature, (answer: SignalEnvelope): void => {
            if (this.socket.open) {
                this.socket.send({ type: 'signal', envelope: answer, signature: this.identity.sign(signalMessage(this.identity.publicKey, from, answer)) });
            }
        });
        if (outcome === 'dropped') {
            this.refuse('bad-frame', 'That signature does not hold');
        }
    }

    private refuse(code: LanDoorErrorCode, message: string): void {
        if (!this.socket.open) {
            return;
        }
        this.socket.send({ type: 'error', code, message });
        this.socket.close(4003, message);
    }
}

/* How many sockets each address opened in the last minute and holds open now. */
export class AddressLimiter {
    private readonly opened = new Map<string, number[]>();
    private readonly holding = new Map<string, number>();
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    /* Counts a new socket from `address`; false when that address is over either limit, and then nothing is counted. */
    admit(address: string): boolean {
        const now = this.now();
        const recent = (this.opened.get(address) ?? []).filter((at) => now - at < MINUTE_MS);
        if (recent.length >= ATTEMPTS_PER_MINUTE || (this.holding.get(address) ?? 0) >= OPEN_PER_ADDRESS) {
            this.opened.set(address, recent);
            return false;
        }
        this.opened.set(address, [...recent, now]);
        this.holding.set(address, (this.holding.get(address) ?? 0) + 1);
        return true;
    }

    release(address: string): void {
        const left = (this.holding.get(address) ?? 1) - 1;
        if (left > 0) {
            this.holding.set(address, left);
        } else {
            this.holding.delete(address);
        }
        const now = this.now();
        const recent = (this.opened.get(address) ?? []).filter((at) => now - at < MINUTE_MS);
        if (recent.length === 0) {
            this.opened.delete(address);
        } else {
            this.opened.set(address, recent);
        }
    }
}

export interface LanDoorOptions {
    // The port to listen on; 0 lets the system pick one, which `port` then names.
    port: number;
    identity: DoorIdentity;
    gate: SignalGate;
    log?: Pick<Console, 'log' | 'warn'>;
    now?(): number;
}

interface SocketData {
    address: string;
    session: DoorSession | null;
    helloTimer: ReturnType<typeof setTimeout> | null;
}

/*
 * The machine's door on the local network: a listener of its own on every IPv4 interface that answers
 * only the door's WebSocket at `LAN_DOOR_PATH`, so the daemon's API stays on loopback while a client on
 * the same network signals a direct connection without the broker.
 */
export class LanDoor {
    private readonly options: LanDoorOptions;
    private readonly limiter: AddressLimiter;
    private server: Server<SocketData> | null = null;

    constructor(options: LanDoorOptions) {
        this.options = options;
        this.limiter = new AddressLimiter(options.now);
    }

    get port(): number | null {
        return this.server?.port ?? null;
    }

    /* Opens the door; false when the port is taken, which leaves it closed and says so. */
    start(): boolean {
        if (this.server) {
            return true;
        }
        const log = this.options.log ?? console;
        try {
            this.server = Bun.serve<SocketData>({
                hostname: '0.0.0.0',
                port: this.options.port,
                fetch: (request, server) => this.upgrade(request, server),
                websocket: {
                    maxPayloadLength: MAX_FRAME_BYTES,
                    idleTimeout: IDLE_TIMEOUT_S,
                    open: (socket) => this.opened(socket),
                    message: (socket, message) => {
                        void socket.data.session
                            ?.receive(typeof message === 'string' ? message : Buffer.from(message).toString('utf8'))
                            .catch((e: unknown) => log.warn('A signal at the door failed:', errorText(e)));
                    },
                    close: (socket) => {
                        if (socket.data.helloTimer) {
                            clearTimeout(socket.data.helloTimer);
                        }
                        this.limiter.release(socket.data.address);
                    }
                }
            });
        } catch (e) {
            log.warn(`The door on the local network stays closed, port ${this.options.port} is not free: ${errorText(e)}`);
            return false;
        }
        log.log(`Door on the local network open on port ${this.server.port}`);
        return true;
    }

    stop(): void {
        this.server?.stop(true);
        this.server = null;
    }

    private upgrade(request: Request, server: Server<SocketData>): Response | undefined {
        if (new URL(request.url).pathname !== LAN_DOOR_PATH) {
            return new Response('Not found', { status: 404 });
        }
        const address = server.requestIP(request)?.address ?? 'unknown';
        if (!this.limiter.admit(address)) {
            return new Response('Too many attempts from this address', { status: 429 });
        }
        if (server.upgrade(request, { data: { address, session: null, helloTimer: null } })) {
            return undefined;
        }
        this.limiter.release(address);
        return new Response('Expected a WebSocket', { status: 400 });
    }

    private opened(socket: ServerWebSocket<SocketData>): void {
        const session = new DoorSession(this.options.identity, this.options.gate, {
            send: (frame) => {
                socket.send(JSON.stringify(frame));
            },
            close: (code, reason) => socket.close(code, reason),
            get open() {
                return socket.readyState === 1;
            }
        });
        socket.data.session = session;
        socket.data.helloTimer = setTimeout(() => {
            if (!session.hasGreeted) {
                socket.close(4008, 'No hello');
            }
        }, HELLO_TIMEOUT_MS);
    }
}
