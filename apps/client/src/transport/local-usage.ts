import type { UsageCountPayload, UsageTimingPayload } from '@ruimte/contracts';
import type { ReconnectReason } from '@/telemetry/metrics';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { machineAnswers } from './features';
import type { LinkMeter } from './link-transport';
import type { Transport } from './transport';

/*
 * What only this app sees, handed to the machine it runs for that machine's anonymous usage counts: a dictation, how
 * the links to machines went, and how long one to a machine elsewhere took. Only over this machine's own link while it
 * is open and answers the request, so nothing waits and nothing goes to another machine; one that cannot go is dropped.
 */
export function localUsage(localLink: () => Transport | null) {
    const send = <T extends 'usage.count' | 'usage.timing'>(type: T, payload: T extends 'usage.count' ? UsageCountPayload : UsageTimingPayload): void => {
        const link = localLink();
        if (link === null || link.status !== 'open' || !machineAnswers(link.connection, type)) {
            return;
        }
        void (link.request as (type: T, payload: unknown) => Promise<unknown>)(type, payload).catch(() => undefined);
    };
    return {
        count: (counter: UsageCountPayload['counter']) => send('usage.count', { counter }),
        timing: (timing: UsageTimingPayload['timing'], ms: number) => send('usage.timing', { timing, ms: Math.round(Math.max(0, ms)) })
    };
}

export type LocalUsage = ReturnType<typeof localUsage>;

// Why an attempt failed, in the report's words; a link that dropped while open or a switch of route is no failed connect.
const FAILURE_OF: Partial<Record<ReconnectReason, UsageCountPayload['counter']>> = {
    timeout: 'connectFailures.timeout',
    refused: 'connectFailures.refused',
    address: 'connectFailures.signaling',
    failed: 'connectFailures.other',
    other: 'connectFailures.other'
};

/* A link transport's attempts as the report counts them, beside the metrics `linkMetrics` sends: the path of every link that opened, why every attempt failed, and the time a link to a machine elsewhere took. */
export function linkUsage(
    usage: LocalUsage,
    endpointId: () => string,
    path: (link: Parameters<LinkMeter['connected']>[0]) => UsageCountPayload['counter']
): LinkMeter {
    return {
        connected: (link, outcome, ms) => {
            if (outcome !== 'ok') {
                return;
            }
            usage.count(path(link));
            if (endpointId() !== LOCAL_ENDPOINT_ID) {
                usage.timing('remoteConnectMs', ms);
            }
        },
        reconnecting: (reason) => {
            const failure = FAILURE_OF[reason];
            if (failure !== undefined) {
                usage.count(failure);
            }
        },
        answered: () => undefined
    };
}

/* Two meters on one transport. */
export function bothMeters(one: LinkMeter, other: LinkMeter): LinkMeter {
    return {
        connected: (link, outcome, ms) => {
            one.connected(link, outcome, ms);
            other.connected(link, outcome, ms);
        },
        reconnecting: (reason) => {
            one.reconnecting(reason);
            other.reconnecting(reason);
        },
        answered: (type, ms) => {
            one.answered(type, ms);
            other.answered(type, ms);
        }
    };
}
