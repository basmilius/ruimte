import { consoleLoggingIntegration, dedupeIntegration, functionToStringIntegration, linkedErrorsIntegration, type CloudflareOptions } from '@sentry/cloudflare';
import { createScrubber, TELEMETRY_DATA_COLLECTION } from '@ruimte/telemetry';
import type { Env } from './env.ts';

/*
 * Errors and log lines of the address book for Observatory; undefined, so nothing is sent, without a DSN (tests,
 * `wrangler dev`). No tracing, no request data, no breadcrumbs: an event keeps only the scrubber's allow-list, so
 * neither an address nor a body ever leaves, and a log line keeps its first line and its scalar attributes, scrubbed.
 */
export function telemetryOptions(env: Env): CloudflareOptions | undefined {
    if (!env.OBSERVATORY_DSN) {
        return undefined;
    }
    const scrubber = createScrubber({ tags: [] });
    return {
        dsn: env.OBSERVATORY_DSN,
        release: env.OBSERVATORY_RELEASE,
        environment: 'production',
        dataCollection: TELEMETRY_DATA_COLLECTION,
        defaultIntegrations: false,
        integrations: [
            functionToStringIntegration(),
            linkedErrorsIntegration(),
            dedupeIntegration(),
            consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error'] })
        ],
        attachStacktrace: false,
        maxBreadcrumbs: 0,
        sendClientReports: false,
        beforeSend: (event) => scrubber.scrubEvent(event),
        beforeSendLog: (log) => scrubber.scrubLog(log),
        beforeBreadcrumb: () => null
    };
}
