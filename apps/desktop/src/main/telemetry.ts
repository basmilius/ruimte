import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { privateSentryOptions, TELEMETRY_DSN, telemetryRelease } from '@ruimte/telemetry';
import { fileDedupeStore } from '@ruimte/telemetry/file-store';
import type { IPCMode } from '@sentry/electron/main';
import { electron } from '../electron';
import { RendererMemory, type RendererSample } from '../renderer-memory';
import { isCrash, problemEvent, processTag, shellBeforeSend, shellTags, type ShellProblem } from '../telemetry';

const { app, webContents } = electron;

// Often enough to see a renderer grow toward its heap limit; a sample is one call into the OS, nothing from a page.
const MEMORY_SAMPLE_MS = 30_000;

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
                ...privateSentryOptions({ dsn: TELEMETRY_DSN.desktop, release: telemetryRelease(app.getVersion()), beforeSend }),
                ipcMode: NO_RENDERER_IPC,
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
                initialScope: {
                    tags: shellTags({ platform: process.platform, arch: process.arch, electron: process.versions.electron, appImage: process.env.APPIMAGE })
                }
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
    const memory = new RendererMemory();
    setInterval(() => memory.sample(windowRendererSamples(), Date.now()), MEMORY_SAMPLE_MS).unref();
    app.on('render-process-gone', (_event, contents, details) => {
        if (isCrash(details.reason)) {
            reportShellProblem({
                kind: 'process-gone',
                process: 'renderer',
                reason: details.reason,
                exitCode: details.exitCode,
                memory: memory.reportOf(contents.id, Date.now())
            });
        }
    });
    app.on('child-process-gone', (_event, details) => {
        if (isCrash(details.reason)) {
            reportShellProblem({ kind: 'process-gone', process: processTag(details.type), reason: details.reason, exitCode: details.exitCode });
        }
    });
}

/* The renderer of every window with its memory and the pages it hosts; a page in a browser node runs in a process of its own. */
function windowRendererSamples(): RendererSample[] {
    const workingSet = new Map(app.getAppMetrics().map((metric) => [metric.pid, metric.memory.workingSetSize]));
    const all = webContents.getAllWebContents();

    return all
        .filter((contents) => contents.getType() === 'window' && !contents.isDestroyed())
        .map((contents) => ({
            contentsId: contents.id,
            workingSetKb: workingSet.get(contents.getOSProcessId()) ?? 0,
            guests: all.filter((guest) => guest.getType() === 'webview' && guest.hostWebContents?.id === contents.id).length
        }));
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
