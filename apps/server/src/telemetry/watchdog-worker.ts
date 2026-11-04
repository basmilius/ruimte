import { describeActivity, type Activity } from './activity.ts';
import { HEARTBEAT_MS, LoopWatch } from './loop-watch.ts';
import { daemonBeforeSend, daemonClientOptions, nodeContext, type TelemetrySettings } from './reporter.ts';

declare const self: Worker;

/* The first message sets the worker up; every later one is a heartbeat of the main thread. */
export interface WatchdogStart {
    readonly telemetry: TelemetrySettings | null;
}

export interface WatchdogBeat {
    readonly activity: readonly Activity[];
}

type Sentry = typeof import('@sentry/bun');

let watch: LoopWatch | null = null;
let sentry: Sentry | null = null;
let activity: readonly Activity[] = [];

self.onmessage = (event: MessageEvent<WatchdogStart | WatchdogBeat>) => {
    if (watch !== null) {
        activity = 'activity' in event.data ? event.data.activity : [];

        const verdict = watch.beat(Date.now());
        if (verdict?.state === 'recovered') {
            log(`The event loop answers again after ${seconds(verdict.blockedMs)} s`);
        }
        return;
    }
    watch = new LoopWatch(Date.now());
    if ('telemetry' in event.data && event.data.telemetry !== null) {
        void startReporting(event.data.telemetry);
    }
    setInterval(check, HEARTBEAT_MS);
};

function check(): void {
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
