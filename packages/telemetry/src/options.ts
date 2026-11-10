import { TELEMETRY_DATA_COLLECTION } from './dsn.ts';
import type { Scrubber } from './scrub.ts';

export interface PrivateSentryInput {
    readonly dsn: string;
    /* Left out of the options when absent, so the SDK names none. */
    readonly release?: string | null;
    readonly beforeSend: Scrubber['scrubEvent'];
    /* A service's log lines are scrubbed with this; a surface without logs gives none. */
    readonly scrubLog?: Scrubber['scrubLog'];
    /* For an SDK whose own entry point drops the default integrations (`initWithoutDefaultIntegrations`), so the flag stays out. */
    readonly initWithoutDefaultIntegrations?: boolean;
}

/*
 * What every surface switches off before it adds the integrations of its own: the SDK's own collection, the
 * default integrations, stack variables, breadcrumbs and client reports. Spread into `init`; nothing else is sent
 * than what the scrubber's allow-list keeps.
 */
export function privateSentryOptions(input: PrivateSentryInput) {
    return {
        dsn: input.dsn,
        ...(input.release == null ? {} : { release: input.release }),
        environment: 'production',
        dataCollection: TELEMETRY_DATA_COLLECTION,
        ...(input.initWithoutDefaultIntegrations === true ? {} : { defaultIntegrations: false as const }),
        attachStacktrace: false,
        maxBreadcrumbs: 0,
        sendClientReports: false,
        beforeSend: input.beforeSend,
        ...(input.scrubLog === undefined ? {} : { beforeSendLog: input.scrubLog }),
        beforeBreadcrumb: () => null
    };
}
