import * as Sentry from '@sentry/bun';
import { createScrubber, TELEMETRY_DATA_COLLECTION } from '@ruimte/telemetry';
import type { BrokerMeter } from './broker.ts';

// The broker's app in Observatory. A DSN only lets a client send, so it is no secret.
export const BROKER_DSN = 'https://47b1dcc0fd8242359e18520245dab28e@ingest.bmnw.nl/8';

const CLOSE_MS = 2000;

/*
 * Errors and log lines of the broker. No tracing, no request data, no breadcrumbs: an event keeps only the scrubber's
 * allow-list and a log line its first line and scalar attributes, scrubbed, so no address of a peer ever leaves.
 */
export function brokerTelemetryOptions(release: string | null): Sentry.BunOptions {
    const scrubber = createScrubber({ tags: [] });
    return {
        dsn: BROKER_DSN,
        ...(release === null ? {} : { release }),
        environment: 'production',
        dataCollection: TELEMETRY_DATA_COLLECTION,
        integrations: [
            Sentry.functionToStringIntegration(),
            Sentry.linkedErrorsIntegration(),
            Sentry.dedupeIntegration(),
            Sentry.onUncaughtExceptionIntegration(),
            Sentry.onUnhandledRejectionIntegration(),
            Sentry.consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error'] })
        ],
        attachStacktrace: false,
        maxBreadcrumbs: 0,
        sendClientReports: false,
        beforeSend: (event) => scrubber.scrubEvent(event),
        beforeSendLog: (log) => scrubber.scrubLog(log),
        beforeBreadcrumb: () => null
    };
}

/* The checkout the unit runs from names the release, `broker@<12 hex>`; null outside a git checkout. */
export function brokerRelease(): string | null {
    const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: import.meta.dir, stderr: 'ignore' });
    const commit = result.success ? result.stdout.toString().trim() : '';
    return /^[0-9a-f]{40}$/.test(commit) ? `broker@${commit.slice(0, 12)}` : null;
}

export function startTelemetry(): void {
    Sentry.initWithoutDefaultIntegrations(brokerTelemetryOptions(brokerRelease()));
}

/* The broker's counts as Observatory metrics; only once `startTelemetry` ran, since the SDK drops them without a client. */
export const sentryMeter: BrokerMeter = {
    rateLimited: (limit) => Sentry.metrics.count('broker.rate_limited', 1, { attributes: { limit } }),
    relayed: (outcome) => Sentry.metrics.count('broker.relay', 1, { attributes: { outcome } }),
    ice: (outcome) => Sentry.metrics.count('broker.ice', 1, { attributes: { outcome } }),
    online: (counts) => {
        Sentry.metrics.gauge('broker.sockets', counts.sockets);
        Sentry.metrics.gauge('broker.machines', counts.machines);
        Sentry.metrics.gauge('broker.clients', counts.clients);
    }
};

/* Sends what is still queued before the process exits; a no-op while telemetry is off. */
export async function stopTelemetry(): Promise<void> {
    await Sentry.close(CLOSE_MS);
}
