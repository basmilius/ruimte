import { COMPILED } from '../version.ts';
import { daemonActivity } from './activity.ts';
import { HEARTBEAT_MS } from './loop-watch.ts';
import type { TelemetrySettings } from './reporter.ts';
import type { WatchdogBeat, WatchdogStart } from './watchdog-worker.ts';

// A worker is a module of its own in the binary, beside `main.ts`; see `scripts/compile.ts`.
const WORKER_URL = COMPILED ? './telemetry/watchdog-worker.ts' : new URL('./watchdog-worker.ts', import.meta.url).href;

/*
 * Watches the daemon's event loop from a worker, which logs a block of five seconds and reports it
 * when this build reports. A daemon that keeps its port but stops answering says so in its log.
 */
export function startWatchdog(telemetry: TelemetrySettings | null): void {
    const worker = new Worker(WORKER_URL, { ref: false });
    worker.postMessage({ telemetry } satisfies WatchdogStart);
    setInterval(() => worker.postMessage({ activity: daemonActivity.recent() } satisfies WatchdogBeat), HEARTBEAT_MS).unref();
}
