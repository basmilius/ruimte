import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import {
    blankQuoted,
    createDailyDedupe,
    createScrubber,
    startQuarterMeter,
    TELEMETRY_DATA_COLLECTION,
    TELEMETRY_DSN,
    telemetryRelease,
    type QuarterMeter
} from '@ruimte/telemetry';
import { fileDedupeStore } from '@ruimte/telemetry/file-store';
import { COMPILED, DEBUG_ID, VERSION } from '../version.ts';
import { registerDebugId } from './debug-id.ts';

type Sentry = typeof import('@sentry/bun');

/* How the daemon came to run, which says whose log a report belongs beside. */
export type Launcher = 'service' | 'desktop' | 'standalone';

export interface TelemetrySettings {
    readonly dsn: string;
    readonly release: string;
    readonly tags: Readonly<Record<string, string>>;
    readonly home: string;
    readonly username: string;
    readonly hostname: string;
    /* `$RUIMTE_HOME`, where the dedupe remembers what went out. */
    readonly ruimteHome: string;
}

interface ProjectSource {
    known(): Promise<ReadonlyArray<{ name: string; folder: string }>>;
}

const FLUSH_MS = 2000;
// The part of a fatal report's two seconds the registry may take; past it the names of the last read stand.
const FATAL_REDACTIONS_MS = 500;
const STDERR_LINES = 5;
// A helper ended by one of these was stopped on purpose, by a person's Ctrl-C or a service manager stopping the daemon's group.
const STOP_SIGNALS: ReadonlySet<string> = new Set(['SIGTERM', 'SIGINT', 'SIGHUP']);

let sentry: Sentry | null = null;
let projects: ProjectSource | null = null;
let projectRedactions: readonly string[] = [];
let stopping = false;
let timers: ReturnType<typeof setInterval>[] = [];
let meter: QuarterMeter | null = null;
const secrets = new Set<string>();
const MAX_MOMENTS = 30;
const LAG_TICK_MS = 1000;
const GAUGE_MS = 60_000;

/*
 * Reports go out only from a release build: `scripts/compile.ts` stamps `RUIMTE_TELEMETRY` into the
 * binary, so a checkout, `bun dev`, a test and a local compile stay silent whatever their environment says.
 */
export function telemetryBuild(): boolean {
    return COMPILED && process.env.RUIMTE_TELEMETRY === '1';
}

/* What a report of this daemon carries besides the error itself; null when this build reports nothing. */
export function telemetrySettings(launcher: Launcher, ruimteHome: string): TelemetrySettings | null {
    if (!telemetryBuild()) {
        return null;
    }
    return {
        dsn: TELEMETRY_DSN.daemon,
        release: telemetryRelease(VERSION),
        tags: { launcher, platform: process.platform, arch: process.arch },
        home: homedir(),
        username: userInfo().username,
        hostname: hostname(),
        ruimteHome
    };
}

/* Machine state: no client's file request reaches it (`fs/machine-home.ts`). */
export function dedupeStorePath(ruimteHome: string): string {
    return join(ruimteHome, 'telemetry', 'sent.json');
}

function daemonScrubber(current: TelemetrySettings, redactions: () => Iterable<string>): ReturnType<typeof createScrubber> {
    return createScrubber({
        home: current.home,
        username: current.username,
        hostname: current.hostname,
        redactions,
        tags: ['launcher', 'platform', 'arch', 'helper', 'language_server', 'hang'],
        breadcrumbs: Object.keys(DAEMON_MOMENTS)
    });
}

/*
 * The breadcrumbs a report of the daemon may carry, by category: fixed words for its start and for clients by kind,
 * never a request, a path or a name, so an error says what the daemon had just been through.
 */
export const DAEMON_MOMENTS = {
    'daemon.boot': ['wired', 'serving', 'stopping'],
    'daemon.client': ['local opened', 'local closed', 'account opened', 'account closed', 'machine opened', 'machine closed']
} as const satisfies Record<string, readonly string[]>;

export type MomentCategory = keyof typeof DAEMON_MOMENTS;

export function allowedMoment(breadcrumb: { category?: string; message?: string }): boolean {
    const words = (DAEMON_MOMENTS as Record<string, readonly string[]>)[breadcrumb.category ?? ''];

    return words !== undefined && breadcrumb.message !== undefined && words.includes(breadcrumb.message);
}

/* A warning line on its way out: the same scrubber as an error, its first line only. */
export function daemonBeforeSendLog(current: TelemetrySettings, redactions: () => Iterable<string> = () => []): LogScrub {
    const scrubber = daemonScrubber(current, redactions);

    return (log) => {
        const scrubbed = scrubber.scrubLog(log);

        return { ...scrubbed, message: fixedWords(String(scrubbed.message)), attributes: {} };
    };
}

type LogScrub = ReturnType<typeof createScrubber>['scrubLog'];

// What a metric of the daemon may carry: its own attributes and what names the build. Never the host or a user.
const METRIC_ATTRIBUTES: ReadonlySet<string> = new Set(['area', 'kind', 'sentry.release', 'sentry.environment', 'sentry.sdk.name', 'sentry.sdk.version']);

export function keptMetricAttributes(attributes: Record<string, unknown> | undefined): Record<string, unknown> {
    return Object.fromEntries(Object.entries(attributes ?? {}).filter(([key]) => METRIC_ATTRIBUTES.has(key)));
}

/*
 * Only the fixed words of a warning go out. A warning interpolates whatever it is about (an error from a database,
 * a secret's name, a process and its arguments, an id), which the scrubber's patterns do not all know. So the
 * detail after the first colon stays in the log file, what is in parentheses or quotes goes, and every token with a
 * digit, an underscore or a dot in it, such as an id, a variable or a host, becomes `<id>`.
 */
export function fixedWords(message: string): string {
    const head = message.split(':', 1)[0] ?? '';

    return blankQuoted(head)
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/(?<![\w<])(?=[\w.-]*[\d_.])[\w.-]*\w(?![\w>])/g, '<id>')
        .trim();
}

/*
 * What every report of the daemon goes through, the hang watchdog's included: the scrubber, then
 * the dedupe, which lets one error out once a day.
 */
export function daemonBeforeSend(current: TelemetrySettings, redactions: () => Iterable<string> = () => []): <T extends object>(event: T) => T | null {
    const scrubber = daemonScrubber(current, redactions);
    const dedupe = createDailyDedupe({ store: fileDedupeStore(dedupeStorePath(current.ruimteHome)) });
    return (event) => {
        const scrubbed = scrubber.scrubEvent(markInApp(event));
        return scrubbed !== null && dedupe.admit(scrubbed) ? scrubbed : null;
    };
}

/*
 * The frames of the compiled daemon all sit in its one bundle file, which the SDK does not count as
 * the app's own. Observatory maps them back to the source and takes the dependencies out again.
 */
export function markInApp<T extends object>(event: T): T {
    const exception = (event as { exception?: { values?: Array<{ stacktrace?: { frames?: Array<{ filename?: string; in_app?: boolean }> } }> } }).exception;
    for (const value of exception?.values ?? []) {
        for (const frame of value.stacktrace?.frames ?? []) {
            if (frame.filename !== undefined) {
                frame.in_app = !frame.filename.includes('node_modules') && !frame.filename.startsWith('native:');
            }
        }
    }
    return event;
}

/* The machine's context a report carries: its platform and runtime, nothing of the person. */
export function nodeContext(loaded: Sentry): ReturnType<Sentry['nodeContextIntegration']> {
    return loaded.nodeContextIntegration({ app: false, cloudResource: false, culture: false, device: { cpu: false, memory: false } });
}

/*
 * What the serving daemon reports with: errors, a session per run without a user, its warning lines, the fixed
 * moments of `DAEMON_MOMENTS` and the metrics below. No tracing. The hang watchdog passes its own integrations,
 * without the session and the warnings.
 */
export function daemonClientOptions(
    loaded: Sentry,
    current: TelemetrySettings,
    beforeSend: <T extends object>(event: T) => T | null,
    integrations = [
        loaded.functionToStringIntegration(),
        loaded.linkedErrorsIntegration(),
        loaded.dedupeIntegration(),
        nodeContext(loaded),
        loaded.processSessionIntegration(),
        loaded.consoleLoggingIntegration({ levels: ['warn'] })
    ],
    scrubLog: LogScrub | null = null
): Parameters<Sentry['init']>[0] {
    return {
        dsn: current.dsn,
        release: current.release,
        environment: 'production',
        dataCollection: TELEMETRY_DATA_COLLECTION,
        attachStacktrace: false,
        maxBreadcrumbs: MAX_MOMENTS,
        sendClientReports: false,
        integrations,
        initialScope: { tags: { ...current.tags } },
        // Without a name of its own the SDK takes the host's, and puts it on every metric as `server.address`; an empty
        // name falls back to the host too. The attribute list below keeps it off a metric either way.
        serverName: 'ruimte',
        beforeSendMetric: (metric) => ({ ...metric, attributes: keptMetricAttributes(metric.attributes) }),
        beforeSend: (event) => beforeSend(event),
        // Without a scrubber of its own, a log line is not sent at all.
        beforeSendLog: (log) => (scrubLog === null ? null : scrubLog(log)),
        beforeBreadcrumb: (breadcrumb) => (allowedMoment(breadcrumb) ? breadcrumb : null)
    };
}

/* A moment of `DAEMON_MOMENTS` for the next report; nothing in a build that reports nothing. */
export function noteMoment<C extends MomentCategory>(category: C, message: (typeof DAEMON_MOMENTS)[C][number]): void {
    sentry?.addBreadcrumb({ category, message, level: 'info' });
}

export type ClientKind = 'local' | 'account' | 'machine';

/* Who a client is, as a kind: the app on this machine, a device of the account, or another machine of it. */
export function clientKindOf(access: { sessionId: string | null; peer?: unknown } | undefined): ClientKind {
    if (access?.peer !== undefined) {
        return 'machine';
    }

    return access === undefined || access.sessionId === null ? 'local' : 'account';
}

const liveClients: Record<ClientKind, number> = { local: 0, account: 0, machine: 0 };

export function clientOpened(kind: ClientKind): void {
    liveClients[kind] += 1;
    noteMoment('daemon.client', `${kind} opened`);
}

export function clientClosed(kind: ClientKind): void {
    liveClients[kind] = Math.max(0, liveClients[kind] - 1);
    noteMoment('daemon.client', `${kind} closed`);
}

/* How long a handler took, by the area of its request (`session`, `fs`, `chat`), never the request itself. */
export function recordRequestDuration(type: string, ms: number): void {
    meter?.record({
        kind: 'distribution',
        name: 'daemon.request.duration',
        value: Math.max(0, ms),
        unit: 'millisecond',
        attributes: { area: type.split('.')[0] ?? 'other' }
    });
}

/*
 * The event loop's lag, as how late a one-second tick fires, and once a minute the memory and the clients by kind,
 * gathered in a quarter-hour window (`startQuarterMeter`) with the request durations. Both timers are unref'd, so
 * they never keep a stopping daemon alive.
 */
function startMeters(active: Sentry): void {
    const window = startQuarterMeter(active.metrics);
    let last = performance.now();

    const tick = setInterval(() => {
        const now = performance.now();
        window.record({ kind: 'distribution', name: 'daemon.loop.lag', value: Math.max(0, now - last - LAG_TICK_MS), unit: 'millisecond' });
        last = now;
    }, LAG_TICK_MS);

    // A kind of client nobody is connected as goes out once as zero, after its last connection, and then not again.
    const recordedClients: Record<ClientKind, number> = { local: 0, account: 0, machine: 0 };

    const gauges = setInterval(() => {
        window.record({ kind: 'gauge', name: 'daemon.memory', value: Math.round(process.memoryUsage().rss / 1_048_576), unit: 'megabyte' });

        for (const kind of Object.keys(liveClients) as ClientKind[]) {
            if (liveClients[kind] === 0 && recordedClients[kind] === 0) {
                continue;
            }

            window.record({ kind: 'gauge', name: 'daemon.clients', value: liveClients[kind], attributes: { kind } });
            recordedClients[kind] = liveClients[kind];
        }
    }, GAUGE_MS);

    tick.unref();
    gauges.unref();
    timers = [tick, gauges];
    meter = window;
}

/* Starts reporting for the serving daemon (`daemonClientOptions`). */
export async function startTelemetry(current: TelemetrySettings): Promise<void> {
    const loaded = await import('@sentry/bun');
    const redactions = (): string[] => [...secrets, ...projectRedactions];

    if (DEBUG_ID !== null) {
        registerDebugId(DEBUG_ID);
    }

    loaded.initWithoutDefaultIntegrations(
        daemonClientOptions(loaded, current, daemonBeforeSend(current, redactions), undefined, daemonBeforeSendLog(current, redactions))
    );

    sentry = loaded;
    startMeters(loaded);
}

/* A value no report may carry, such as the local secret. */
export function rememberSecret(secret: string): void {
    secrets.add(secret);
}

/* The registry the names and folders of projects are read from before a report goes out. */
export function watchProjects(source: ProjectSource): void {
    projects = source;
}

async function refreshRedactions(): Promise<void> {
    if (projects === null) {
        return;
    }
    try {
        const known = await projects.known();
        projectRedactions = known.flatMap((project) => [project.name, project.folder]);
    } catch {
        // A registry that cannot be read leaves the names of the last read, and the generic rules still apply.
    }
}

export interface FatalTimer {
    now(): number;
    /* Resolves after `ms`; the fatal path never waits longer than its budget for anything. */
    wait(ms: number): Promise<void>;
}

const SYSTEM_TIMER: FatalTimer = {
    now: () => Date.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

/*
 * Refreshes the redactions and sends within one budget of `FLUSH_MS`: a registry that does not answer
 * in time leaves the redactions already known, and the flush gets what is left.
 */
export async function sendFatal(
    refresh: () => Promise<void>,
    capture: () => void,
    flush: (ms: number) => Promise<unknown>,
    timer: FatalTimer = SYSTEM_TIMER
): Promise<void> {
    const started = timer.now();
    await Promise.race([refresh(), timer.wait(FATAL_REDACTIONS_MS)]);
    capture();
    await flush(Math.max(0, FLUSH_MS - (timer.now() - started)));
}

/* An error nothing caught, on the way to ending the process; resolves once it is sent or the wait is over. */
export async function reportFatal(error: unknown): Promise<void> {
    const active = sentry;
    if (active === null) {
        return;
    }
    try {
        await sendFatal(
            refreshRedactions,
            () =>
                active.withScope((scope) => {
                    scope.setLevel('fatal');
                    active.captureException(error, { mechanism: { type: 'auto.node.onuncaughtexception', handled: false } });
                }),
            (ms) => active.flush(ms)
        );
    } catch {
        // Reporting a crash never stands in the way of the exit.
    }
}

interface HelperExit {
    /* Which helper: `database`, `apple-foundation`, `on-device` or `language-server`. */
    readonly helper: string;
    /* The kind of language server; only for a kind Ruimte ships. */
    readonly kind?: string;
    readonly code: number | null;
    readonly signal?: string | null;
    readonly stderr?: readonly string[];
}

/* From here on a helper that ends goes down with the daemon, and none is reported. */
export function noteShutdown(): void {
    stopping = true;
    noteMoment('daemon.boot', 'stopping');
}

/* Whether a helper's end is worth a report: not one stopped by a signal a person or a service manager sends, and none while the daemon stops. */
export function helperExitReportable(exit: HelperExit, daemonStopping: boolean): boolean {
    return !daemonStopping && !(exit.signal != null && STOP_SIGNALS.has(exit.signal));
}

/* A helper process that ended while the daemon still needed it. */
export function reportHelperExit(exit: HelperExit): void {
    const active = sentry;
    if (active === null || !helperExitReportable(exit, stopping)) {
        return;
    }
    void refreshRedactions().then(() => {
        // Asked again: the signal that stops the daemon may reach it only after its helper's exit.
        if (!helperExitReportable(exit, stopping)) {
            return;
        }
        active.captureEvent({
            message: `The ${exit.helper} helper exited unexpectedly`,
            level: 'error',
            fingerprint: ['helper-exit', exit.helper, exit.kind ?? ''],
            tags: { helper: exit.helper, ...(exit.kind === undefined ? {} : { language_server: exit.kind }) },
            extra: {
                exit_code: exit.code ?? -1,
                ...(exit.signal ? { signal: exit.signal } : {}),
                stderr: helperStderrOf(exit.stderr ?? [])
            }
        });
    });
}

/* The last lines a helper wrote, without what it quoted. */
export function helperStderrOf(lines: readonly string[]): string[] {
    return lines.slice(-STDERR_LINES).map(blankQuoted);
}

/*
 * Sends what is still queued before a clean exit, and this run's session as exited: the SDK ends it only on
 * `beforeExit`, which a daemon that stops on a signal never reaches.
 */
export async function stopTelemetry(): Promise<void> {
    for (const timer of timers) {
        clearInterval(timer);
    }

    timers = [];
    // What the quarter gathered so far goes along with the last flush.
    meter?.stop();
    meter = null;
    sentry?.endSession();
    await sentry?.close(FLUSH_MS);
}

/* The last lines of a process's stderr, kept for a report of its exit. */
export class StderrTail {
    private readonly lines: string[] = [];
    private readonly size: number;

    constructor(size = STDERR_LINES) {
        this.size = size;
    }

    push(text: string): void {
        for (const line of text.split(/\r?\n/)) {
            if (line.trim() === '') {
                continue;
            }
            this.lines.push(line);
            if (this.lines.length > this.size) {
                this.lines.shift();
            }
        }
    }

    get(): string[] {
        return [...this.lines];
    }
}
