import { describe, expect, test } from 'bun:test';
import type { Env } from './env.ts';
import { telemetryOptions } from './telemetry.ts';

const ENV = { DB: {} as D1Database, PUBLIC_ORIGIN: 'https://pulsar.test' } satisfies Env;

describe('the telemetry of the address book', () => {
    test('is off without a DSN', () => {
        expect(telemetryOptions(ENV)).toBeUndefined();
    });

    test('reports under the DSN and release of the deploy, without tracing or default integrations', () => {
        const options = telemetryOptions({ ...ENV, OBSERVATORY_DSN: 'https://key@ingest.test/7', OBSERVATORY_RELEASE: 'pulsar@0123456789ab' });
        expect(options).toMatchObject({ dsn: 'https://key@ingest.test/7', release: 'pulsar@0123456789ab', defaultIntegrations: false });
        expect(options?.tracesSampleRate).toBeUndefined();
        expect(options?.integrations).toContainEqual(expect.objectContaining({ name: 'ConsoleLogs' }));
    });

    test('sends an error without the request or the person, and a log line without the host', () => {
        const options = telemetryOptions({ ...ENV, OBSERVATORY_DSN: 'https://key@ingest.test/7' })!;
        const event = options.beforeSend!(
            {
                type: undefined,
                message: 'unhandled',
                request: { url: 'https://pulsar.ruimte.app/v1/usage', headers: { 'cf-connecting-ip': '192.0.2.7' } },
                user: { ip_address: '192.0.2.7' }
            },
            {}
        );
        expect(event).toEqual({ type: undefined, message: 'unhandled' });
        const log = options.beforeSendLog!({ level: 'warn', message: 'APNs delivery rejected', attributes: { status: 410, 'server.address': 'edge' } });
        expect(log).toEqual({ level: 'warn', message: 'APNs delivery rejected', attributes: { status: 410 } });
    });
});
