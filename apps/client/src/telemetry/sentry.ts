import {
    browserSessionIntegration,
    captureEvent,
    captureException,
    dedupeIntegration,
    functionToStringIntegration,
    init,
    linkedErrorsIntegration,
    metrics
} from '@sentry/browser';
import { createDailyDedupe, createScrubber, TELEMETRY_DATA_COLLECTION, TELEMETRY_DSN, telemetryRelease } from '@ruimte/telemetry';
import { useProjectList } from '@/state/project-list';
import { CLIENT_TAGS, connectionEvent, storageDedupeStore, type ConnectionProblem } from './events';
import type { PageMetric } from './metrics';

export interface ReporterOptions {
    readonly surface: 'desktop' | 'station';
    /* The version a release build was stamped with. */
    readonly version: string;
    /* What the desktop shell says it runs on; null on the station. */
    readonly platform: string | null;
}

/*
 * The SDK behind the page's reports and measurements. Errors, the station's sessions and the metrics in
 * `report.ts`: no tracing, no breadcrumbs, no replays, no logs, and the page's address never goes along.
 * A desktop window has no session of its own, since the shell's main process holds the session of the whole app.
 */
export function startReporter(options: ReporterOptions): void {
    const scrubber = createScrubber({
        // The names and folders of the projects this client lists, read at every report.
        redactions: () => useProjectList.getState().projects.flatMap((row) => [row.summary.name, row.summary.folder]),
        tags: CLIENT_TAGS
    });
    const dedupe = createDailyDedupe({ store: storageDedupeStore(() => window.localStorage) });
    init({
        dsn: TELEMETRY_DSN[options.surface],
        release: telemetryRelease(options.version),
        environment: 'production',
        dataCollection: TELEMETRY_DATA_COLLECTION,
        defaultIntegrations: false,
        integrations: [
            functionToStringIntegration(),
            linkedErrorsIntegration(),
            dedupeIntegration(),
            ...(options.surface === 'station' ? [browserSessionIntegration()] : [])
        ],
        attachStacktrace: false,
        maxBreadcrumbs: 0,
        sendClientReports: false,
        initialScope: {
            tags: {
                surface: options.surface,
                ...(options.surface === 'desktop' ? { process: 'renderer' } : {}),
                ...(options.platform === null ? {} : { platform: options.platform })
            }
        },
        beforeSend: (event) => {
            const scrubbed = scrubber.scrubEvent(event);
            return scrubbed !== null && dedupe.admit(scrubbed) ? scrubbed : null;
        },
        beforeBreadcrumb: () => null
    });
}

/* `onerror` and `onunhandledrejection` for what nothing caught, `react.errorboundary` for what a boundary did. */
export function reportError(error: unknown, mechanism: string, handled: boolean): void {
    captureException(error, { mechanism: { type: mechanism, handled } });
}

export function reportConnection(problem: ConnectionProblem): void {
    captureEvent(connectionEvent(problem));
}

/* A metric with exactly the name, unit and attributes Observatory's Connections dashboard reads (`metrics.ts`). */
export function recordMetric(metric: PageMetric): void {
    if (metric.kind === 'count') {
        metrics.count(metric.name, 1, { attributes: metric.attributes });
    } else {
        metrics.distribution(metric.name, metric.value, { unit: 'millisecond', attributes: metric.attributes });
    }
}
