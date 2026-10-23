import { metrics } from '@sentry/cloudflare';

/*
 * The address book's counts for Observatory. Every attribute is one of a fixed set of values, never an id, a key, an
 * address or a name, so a series stays one per route or outcome. Without the SDK's client (tests, a run without a DSN)
 * every call is a no-op.
 */

const ROUTE_TEMPLATES: readonly [RegExp, string][] = [
    [/^\/v1\/push\/devices\/[^/]+\/activities$/, '/v1/push/devices/:id/activities'],
    [/^\/v1\/push\/devices\/[^/]+\/start-activity$/, '/v1/push/devices/:id/start-activity'],
    [/^\/v1\/push\/devices\/[^/]+$/, '/v1/push/devices/:id'],
    [/^\/v1\/account\/identities\/[^/]+$/, '/v1/account/identities/:provider'],
    [/^\/v1\/machines\/[^/]+$/, '/v1/machines/:id'],
    [/^\/v1\/device\/[^/]+$/, '/v1/device/:step'],
    [/^\/auth\/[^/]+\/start$/, '/auth/:provider/start'],
    [/^\/auth\/[^/]+\/callback$/, '/auth/:provider/callback']
];

/* A path as the route it reached: a known path as it is, one with an id as its template, anything else `other`. */
export function routeOf(path: string, known: ReadonlySet<string>): string {
    if (known.has(path)) {
        return path;
    }
    return ROUTE_TEMPLATES.find(([pattern]) => pattern.test(path))?.[1] ?? 'other';
}

export function countRequest(route: string, status: number, durationMs: number): void {
    metrics.count('pulsar.request', 1, { attributes: { route, status: `${Math.floor(status / 100)}xx` } });
    metrics.distribution('pulsar.request.duration', durationMs, { unit: 'millisecond', attributes: { route } });
}

export type LoginOutcome = 'signed-in' | 'linked' | 'expired' | 'denied' | 'refused' | 'failed';

export function countLogin(provider: string, outcome: LoginOutcome): void {
    metrics.count('pulsar.login', 1, { attributes: { provider, outcome } });
}

export type PushOutcome = 'delivered' | 'gone' | 'rejected' | 'too-large' | 'not-configured';

/* An APNs answer as an outcome: 410 is a token iOS gave up, which the address book then forgets. */
export function pushOutcomeOf(status: number, ok: boolean): Exclude<PushOutcome, 'too-large' | 'not-configured'> {
    if (ok) {
        return 'delivered';
    }
    return status === 410 ? 'gone' : 'rejected';
}

export function countPush(pushType: string, outcome: PushOutcome): void {
    metrics.count('pulsar.push', 1, { attributes: { push_type: pushType, outcome } });
}

export function countUsageRelay(outcome: string): void {
    metrics.count('pulsar.usage_relay', 1, { attributes: { outcome } });
}
