import { describeActivity, type Activity } from './activity.ts';
import { StallLog } from './loop-lag.ts';
import { HEARTBEAT_MS, LoopWatch } from './loop-watch.ts';
import { daemonBeforeSend, daemonClientOptions, nodeContext, type TelemetrySettings } from './reporter.ts';

declare const self: Worker;

/* The first message sets the worker up; every later one is a heartbeat of the main thread. */
export interface WatchdogStart {
    readonly telemetry: TelemetrySettings | null;
}

export interface WatchdogBeat {
    readonly activity: readonly Activity[];

    /* The worst lag of the main thread's sample timer since the previous heartbeat. */
    readonly lagMs: number;
}

type Sentry = typeof import('@sentry/bun');

let watch: LoopWatch | null = null;
let stalls: StallLog | null = null;
let sentry: Sentry | null = null;
let activity: readonly Activity[] = [];
let lastBeatAt = 0;

self.onmessage = (event: MessageEvent<WatchdogStart | WatchdogBeat>) => {
    const now = Date.now();
    if (watch !== null && stalls !== null) {
        if (!('activity' in event.data)) {
            return;
        }

        activity = event.data.activity;

        const verdict = watch.beat(now);
        if (verdict?.state === 'recovered') {
            log(`The event loop answers again after ${seconds(verdict.blockedMs)} s`);
        }

        const stall = stalls.beat(now, event.data.lagMs, watch.pausedSince(lastBeatAt), lastActivitySince(lastBeatAt));
        lastBeatAt = now;
        if (stall !== null) {
            log(stall);
        }
        return;
    }
    watch = new LoopWatch(now);
    stalls = new StallLog(now);
    lastBeatAt = now;
    if ('telemetry' in event.data && event.data.telemetry !== null) {
        void startReporting(event.data.telemetry);
    }
    setInterval(check, HEARTBEAT_MS);
};

function lastActivitySince(at: number): string | null {
    const newest = activity.at(-1);
    return newest !== undefined && newest.at >= at ? newest.label : null;
}

function check(): void {
    const summary = stalls?.check(Date.now()) ?? null;
    if (summary !== null) {
        log(summary);
    }

    const verdict = watch?.check(Date.now());
    if (verdict?.state !== 'blocked') {
        return;
    }
    // The main thread's console is stuck with it, and its log lines carry no time of their own here.
    log(`The event loop has not answered for ${seconds(verdict.sinceMs)} s`);
    sentry?.captureEvent({
        message: 'The event loop is blocked',
        level: 'error',
        fingerprint: ['event-loop-blocked'],
        tags: { hang: 'event-loop' },
        extra: { blocked_ms: verdict.sinceMs, activity: describeActivity(activity, Date.now()) }
    });
}

/* Its own client: the main thread cannot send while it is the one that hangs. Without a stack, which Bun cannot take of another thread. */
async function startReporting(settings: TelemetrySettings): Promise<void> {
    const loaded = await import('@sentry/bun');
    loaded.initWithoutDefaultIntegrations(daemonClientOptions(loaded, settings, daemonBeforeSend(settings), [nodeContext(loaded)]));
    sentry = loaded;
}

function log(line: string): void {
    console.error(`${new Date().toISOString()} ${line}`);
}

function seconds(ms: number): string {
    return (ms / 1000).toFixed(1);
}
