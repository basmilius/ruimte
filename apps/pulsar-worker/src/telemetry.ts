import { createScrubber, privateSentryOptions } from '@ruimte/telemetry';
import { consoleLoggingIntegration, dedupeIntegration, functionToStringIntegration, linkedErrorsIntegration, type CloudflareOptions } from '@sentry/cloudflare';
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
        ...privateSentryOptions({ dsn: env.OBSERVATORY_DSN, release: env.OBSERVATORY_RELEASE, beforeSend: scrubber.scrubEvent, scrubLog: scrubber.scrubLog }),
        integrations: [
            functionToStringIntegration(),
            linkedErrorsIntegration(),
            dedupeIntegration(),
            consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error'] })
        ]
    };
}
