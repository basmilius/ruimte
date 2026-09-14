/*
 * How a peer on a direct connection finds out the other end is gone before ICE does. Chromium only
 * calls a path failed once consent freshness runs out (RFC 7675: 30 seconds without an answer), and a
 * daemon that was killed or a laptop that lost its network sends no close. So a connection that has
 * been quiet for `idleMs` sends one request, and a request with nothing heard back within `timeoutMs`
 * ends it. Anything that arrives counts as heard, so a busy connection never pings at all.
 */
export const DIRECT_PING_IDLE_MS = 2_000;

// Above SCTP's retransmission timeout on a lossy path (a second at least), so one lost packet is no disconnect.
export const DIRECT_PING_TIMEOUT_MS = 5_000;

// The check runs on this tick rather than on a timer per ping, so a throttled window cannot stack them.
export const DIRECT_PING_TICK_MS = 1_000;

export interface ChannelLivenessOptions {
    // Sends one frame the daemon answers; `server.ping` under an id nothing else waits for.
    ping(id: string): void;
    dead(): void;
    now?(): number;
    idleMs?: number;
    timeoutMs?: number;
}

/*
 * The bookkeeping without a timer, so a test can step through it: `heard` on every piece that
 * arrives, `tick` on an interval. The timeout counts from the ping, never from the last frame: a
 * window whose timers were throttled for a minute has heard nothing because it asked nothing.
 */
export class ChannelLiveness {
    private readonly options: ChannelLivenessOptions;
    private lastHeard: number;
    private pingSentAt: number | null = null;
    private nextId = 1;

    constructor(options: ChannelLivenessOptions) {
        this.options = options;
        this.lastHeard = this.now();
    }

    heard(): void {
        this.lastHeard = this.now();
        this.pingSentAt = null;
    }

    tick(): void {
        const now = this.now();
        if (this.pingSentAt !== null) {
            if (now - this.pingSentAt >= (this.options.timeoutMs ?? DIRECT_PING_TIMEOUT_MS)) {
                this.options.dead();
            }
            return;
        }
        if (now - this.lastHeard >= (this.options.idleMs ?? DIRECT_PING_IDLE_MS)) {
            this.pingSentAt = now;
            this.options.ping(`alive-${this.nextId++}`);
        }
    }

    private now(): number {
        return this.options.now?.() ?? Date.now();
    }
}

/* The frame a ping is: a request every daemon answers, under an id no transport has pending, so the reply is dropped where it lands. */
export const directPingFrame = (id: string): string => JSON.stringify({ id, type: 'server.ping', payload: {} });
