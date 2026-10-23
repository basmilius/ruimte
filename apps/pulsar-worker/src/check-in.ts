/*
 * Check-ins of a cron run for Observatory's monitors, as a Sentry envelope with one `check_in` item, without an SDK.
 * The format is Sentry's: https://develop.sentry.dev/sdk/telemetry/check-ins/
 */

export type CheckInStatus = 'in_progress' | 'ok' | 'error';

export interface CheckInMonitor {
    slug: string;
    // A crontab in UTC.
    schedule: string;
    // Minutes a run may start late before it counts as missed.
    checkinMargin: number;
    // Minutes a run may take before it counts as failed.
    maxRuntime: number;
}

export interface CheckInDeps {
    // Observatory's envelope ingest of the app, with its `sentry_key`.
    url: string;
    waitUntil: (promise: Promise<unknown>) => void;
    send?: typeof fetch;
    now?: () => number;
    id?: () => string;
}

export function checkInEnvelope(monitor: CheckInMonitor, checkInId: string, status: CheckInStatus, durationSeconds?: number): string {
    const item = {
        check_in_id: checkInId,
        monitor_slug: monitor.slug,
        status,
        ...(durationSeconds === undefined ? {} : { duration: durationSeconds }),
        monitor_config: {
            schedule: { type: 'crontab', value: monitor.schedule },
            checkin_margin: monitor.checkinMargin,
            max_runtime: monitor.maxRuntime,
            timezone: 'UTC',
            failure_issue_threshold: 1,
            recovery_threshold: 1
        }
    };
    return `{}\n${JSON.stringify({ type: 'check_in' })}\n${JSON.stringify(item)}\n`;
}

/*
 * Runs the job between an `in_progress` and an `ok` or `error` check-in. Both go out after the answer
 * and swallow their own failures, so a monitor that is down never fails the job; the job's own error is
 * thrown again, so the platform still sees the run fail. The second waits for the first, so they arrive
 * in order.
 */
export async function withCheckIn(monitor: CheckInMonitor, job: () => Promise<void>, deps: CheckInDeps): Promise<void> {
    const send = deps.send ?? fetch;
    const now = deps.now ?? Date.now;
    const checkInId = (deps.id ?? (() => crypto.randomUUID().replaceAll('-', '')))();
    const post = (body: string): Promise<void> =>
        send(deps.url, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' }, body }).then(
            (response) => {
                if (!response.ok) {
                    console.warn('check-in refused', response.status);
                }
            },
            () => console.warn('check-in failed')
        );
    const started = now();
    const opened = post(checkInEnvelope(monitor, checkInId, 'in_progress'));
    deps.waitUntil(opened);
    const finish = (status: CheckInStatus): void => {
        const duration = (now() - started) / 1000;
        deps.waitUntil(opened.then(() => post(checkInEnvelope(monitor, checkInId, status, duration))));
    };
    try {
        await job();
    } catch (e) {
        finish('error');
        throw e;
    }
    finish('ok');
}
