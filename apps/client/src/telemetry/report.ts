import type { ErrorInfo } from 'react';
import { ErrorBoundary } from '@adecore/ui';
import { desktop } from '@/desktop/bridge';
import { IS_STATION } from '@/station';
import type { ConnectionProblem } from './events';
import type { PageMetric } from './metrics';

type Reporter = typeof import('./sentry');

/*
 * The version a release build was stamped with (`vite.config.ts`), empty in development, in tests and
 * in every other build, which therefore report nothing. The SDK is a chunk of its own, so the start
 * screen's code carries none of it; a release loads it as it starts, for the session and the metrics.
 */
const VERSION: string = import.meta.env.RUIMTE_TELEMETRY_VERSION ?? '';

let loading: Promise<Reporter | null> | null = null;

/* Only the desktop app and the station report; any other page of a release build stays silent. */
function surface(): 'desktop' | 'station' | null {
    if (IS_STATION) {
        return 'station';
    }
    return desktop() === null ? null : 'desktop';
}

function reporter(): Promise<Reporter | null> {
    const where = surface();
    if (VERSION === '' || where === null) {
        return Promise.resolve(null);
    }
    loading ??= import('./sentry').then(
        (module) => {
            module.startReporter({ surface: where, version: VERSION, platform: desktop()?.platform ?? null });
            return module;
        },
        () => null
    );
    return loading;
}

/* Errors and rejections nothing caught. React hands an error no boundary caught to `reportError`, which lands here as well. */
export function startTelemetry(target: Window = window): void {
    if (VERSION === '' || surface() === null) {
        return;
    }
    target.addEventListener('error', (event) => {
        // A script of another origin says only "Script error.", with nothing to read.
        if (event.error !== undefined && event.error !== null) {
            void reporter().then((module) => module?.reportError(event.error, 'onerror', false));
        }
    });
    target.addEventListener('unhandledrejection', (event) => {
        void reporter().then((module) => module?.reportError(event.reason, 'onunhandledrejection', false));
    });
    void reporter();
}

/* A metric of `metrics.ts`; nothing outside a release of the desktop app or the station. */
export function recordPageMetric(metric: PageMetric): void {
    if (VERSION === '' || surface() === null) {
        return;
    }
    void reporter().then((module) => module?.recordMetric(metric));
}

/*
 * React's `onCaughtError`. An `ErrorBoundary` logs what it caught and shows it, and is reported; the
 * fallbacks of a chat (a diff, an agent's interface) draw something else in place of a reply and keep
 * React's own log.
 */
export function reportCaught(error: unknown, info: ErrorInfo & { errorBoundary?: unknown }): void {
    if (!(info.errorBoundary instanceof ErrorBoundary)) {
        console.error(error);
        return;
    }
    void reporter().then((module) => module?.reportError(error, 'react.errorboundary', true));
}

export function reportConnectionProblem(problem: ConnectionProblem): void {
    void reporter().then((module) => module?.reportConnection(problem));
}
