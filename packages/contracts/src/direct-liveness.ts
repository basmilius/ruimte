/*
 * ICE consent freshness can take 30 seconds to detect a dead peer. Ping only idle channels and end
 * them when no traffic of any kind arrives within the timeout.
 */
export const DIRECT_PING_IDLE_MS = 2_000;

/*
 * The channel is ordered and reliable, so an answer can wait behind a burst of output for as long as
 * SCTP needs to recover from a loss; werift retransmits after at least a second and starts again
 * from one packet. Measured from the last packet of any kind, a live peer never goes this long.
 */
export const DIRECT_PING_TIMEOUT_MS = 10_000;

// The check runs on this tick rather than on a timer per ping, so a throttled window cannot stack them.
export const DIRECT_PING_TICK_MS = 1_000;

export interface ChannelLivenessOptions {
    // Sends one frame the daemon answers; `server.ping` under an id nothing else waits for.
    ping(id: string): void;
    dead(): void;
    /*
     * The bytes the transport under the channel received so far, or null when that is unknown. A
     * packet counts even when the frame it belongs to is still stuck behind a lost one, and the
     * daemon acknowledges the ping itself long before its answer gets through.
     */
    received?(): number | null;
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
    private lastReceived: number | null = null;
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
        const received = this.options.received?.() ?? null;
        if (received !== null) {
            const grew = this.lastReceived !== null && received > this.lastReceived;
            this.lastReceived = received;
            if (grew) {
                this.heard();
                return;
            }
        }
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
