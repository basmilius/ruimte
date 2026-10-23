import { describe, expect, test } from 'bun:test';
import { pushOutcomeOf, routeOf } from './metrics.ts';

const KNOWN = new Set(['/v1/usage', '/health']);

describe('the route of a request metric', () => {
    test('is a known path as it is', () => {
        expect(routeOf('/v1/usage', KNOWN)).toBe('/v1/usage');
        expect(routeOf('/health', KNOWN)).toBe('/health');
    });

    test('is a template for a path with an id, so no id becomes a series', () => {
        expect(routeOf('/v1/machines/abc%20def', KNOWN)).toBe('/v1/machines/:id');
        expect(routeOf(`/v1/push/devices/${'x'.repeat(43)}/activities`, KNOWN)).toBe('/v1/push/devices/:id/activities');
        expect(routeOf(`/v1/push/devices/${'x'.repeat(43)}`, KNOWN)).toBe('/v1/push/devices/:id');
        expect(routeOf('/v1/device/poll', KNOWN)).toBe('/v1/device/:step');
        expect(routeOf('/auth/github/callback', KNOWN)).toBe('/auth/:provider/callback');
    });

    test('is `other` for anything else, however it was made', () => {
        expect(routeOf('/wp-login.php', KNOWN)).toBe('other');
        expect(routeOf('/v1/machines/a/b', KNOWN)).toBe('other');
    });
});

describe('the outcome of a push', () => {
    test('tells a token iOS gave up from any other refusal', () => {
        expect(pushOutcomeOf(200, true)).toBe('delivered');
        expect(pushOutcomeOf(410, false)).toBe('gone');
        expect(pushOutcomeOf(400, false)).toBe('rejected');
    });
});
