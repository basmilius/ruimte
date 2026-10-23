import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import type { IPCMode } from '@sentry/electron/main';
import { TELEMETRY_DATA_COLLECTION, TELEMETRY_DSN, telemetryRelease } from '@ruimte/telemetry';
import { fileDedupeStore, isCrash, problemEvent, processTag, shellBeforeSend, type ShellProblem } from '../telemetry';
import { electron } from './electron';

const { app } = electron;

type Sdk = typeof import('@sentry/electron/main');

// No page talks to the SDK: the bridge is a fixed set, so neither the IPC channels nor the custom protocol are opened.
const NO_RENDERER_IPC = 0 as IPCMode;

let sdk: Sdk | null = null;
let starting = false;
let failed = false;
const waiting: ShellProblem[] = [];

/*
 * Only a release reports: `bun run build:main` stamps `RUIMTE_TELEMETRY` from the release workflow
 * into the bundle, so a checkout, `bun dev` and a local `dist` stay silent whatever their environment says.
 */
export function telemetryBuild(): boolean {
    return app.isPackaged && process.env.RUIMTE_TELEMETRY === '1';
}

/*
 * Crashes and errors of the shell, native crashes of its processes as minidumps, and the app's session
 * per run without a user. No tracing, no breadcrumbs, no logs, and nothing from a page: the client reports its own.
 */
export function startTelemetry(): void {
    if (!telemetryBuild() || starting) {
        return;
    }
    starting = true;
    void import('@sentry/electron/main')
        .then((loaded) => {
            const beforeSend = shellBeforeSend(
                { home: homedir(), username: userInfo().username, hostname: hostname() },
                fileDedupeStore(join(app.getPath('userData'), 'telemetry', 'sent.json'))
            );
            loaded.init({
                dsn: TELEMETRY_DSN.desktop,
                release: telemetryRelease(app.getVersion()),
                environment: 'production',
                dataCollection: TELEMETRY_DATA_COLLECTION,
                ipcMode: NO_RENDERER_IPC,
                defaultIntegrations: false,
                integrations: [
                    loaded.sentryMinidumpIntegration(),
                    loaded.onUncaughtExceptionIntegration(),
                    loaded.onUnhandledRejectionIntegration(),
                    loaded.functionToStringIntegration(),
                    loaded.linkedErrorsIntegration(),
                    loaded.dedupeIntegration(),
                    loaded.nodeContextIntegration({ app: false, cloudResource: false, culture: false, device: { cpu: false, memory: false } }),
                    // The one session of the app per run, which a native crash of any of its processes marks; the windows hold none of their own.
                    loaded.mainProcessSessionIntegration()
                ],
                attachStacktrace: false,
                maxBreadcrumbs: 0,
                sendClientReports: false,
                initialScope: { tags: { process: 'main', platform: process.platform, arch: process.arch } },
                beforeSend: (event) => beforeSend(event),
                beforeBreadcrumb: () => null
            });
            sdk = loaded;
            for (const problem of waiting.splice(0)) {
                reportShellProblem(problem);
            }
        })
        .catch((e: unknown) => {
            failed = true;
            waiting.length = 0;
            console.warn('Crash reports are off for this run:', e instanceof Error ? e.message : e);
        });
    app.on('render-process-gone', (_event, _contents, details) => {
        if (isCrash(details.reason)) {
            reportShellProblem({ kind: 'process-gone', process: 'renderer', reason: details.reason, exitCode: details.exitCode });
        }
    });
    app.on('child-process-gone', (_event, details) => {
        if (isCrash(details.reason)) {
            reportShellProblem({ kind: 'process-gone', process: processTag(details.type), reason: details.reason, exitCode: details.exitCode });
        }
    });
}

export function reportShellProblem(problem: ShellProblem): void {
    if (!telemetryBuild() || failed) {
        return;
    }
    if (sdk === null) {
        waiting.push(problem);
        return;
    }
    sdk.captureEvent(problemEvent(problem));
}
