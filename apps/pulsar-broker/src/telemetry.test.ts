import { describe, expect, test } from 'bun:test';
import { brokerTelemetryOptions, BROKER_DSN } from './telemetry.ts';

describe('the telemetry of the broker', () => {
    test('reports under its own app and the release of its checkout, without tracing', () => {
        const options = brokerTelemetryOptions('broker@0123456789ab');
        expect(options).toMatchObject({ dsn: BROKER_DSN, release: 'broker@0123456789ab', environment: 'production' });
        expect(options.tracesSampleRate).toBeUndefined();
        expect(options.integrations).toContainEqual(expect.objectContaining({ name: 'ConsoleLogs' }));
        expect(brokerTelemetryOptions(null).release).toBeUndefined();
    });

    test('sends an error without the person, and a log line without the host or a peer address', () => {
        const options = brokerTelemetryOptions(null);
        const event = options.beforeSend!({ type: undefined, message: 'socket failed', user: { ip_address: '192.0.2.7' }, server_name: 'vps-1' }, {});
        expect(event).toEqual({ type: undefined, message: 'socket failed' });
        const log = options.beforeSendLog!({ level: 'info', message: 'closed a socket of 192.0.2.7', attributes: { 'server.address': 'vps-1', sockets: 13 } });
        expect(log).toEqual({ level: 'info', message: 'closed a socket of <ip>', attributes: { sockets: 13 } });
    });
});
