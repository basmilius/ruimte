import { createScrubber, privateSentryOptions } from '@ruimte/telemetry';
import { consoleLoggingIntegration, dedupeIntegration, functionToStringIntegration, linkedErrorsIntegration, type CloudflareOptions } from '@sentry/cloudflare';
import type { Env } from './env.ts';

/*
 * Errors and warnings of the map service for Observatory; undefined, so nothing is sent, without a DSN (tests,
 * `wrangler dev`). An event keeps only the scrubber's allow-list, so no request, address or tile leaves: a tile's
 * path is where someone looked. Only `warn` and `error` lines go, and this service writes none that name a place.
 */
export function telemetryOptions(env: Env): CloudflareOptions | undefined {
    if (!env.OBSERVATORY_DSN) {
        return undefined;
    }
    const scrubber = createScrubber({ tags: [] });
    return {
        ...privateSentryOptions({ dsn: env.OBSERVATORY_DSN, release: env.OBSERVATORY_RELEASE, beforeSend: scrubber.scrubEvent, scrubLog: scrubber.scrubLog }),
        integrations: [functionToStringIntegration(), linkedErrorsIntegration(), dedupeIntegration(), consoleLoggingIntegration({ levels: ['warn', 'error'] })]
    };
}
