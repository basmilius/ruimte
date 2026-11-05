import { afterAll, expect, test } from 'bun:test';
import * as Sentry from '@sentry/bun';
import { daemonClientOptions, type TelemetrySettings } from './reporter.ts';

const SETTINGS: TelemetrySettings = {
    dsn: 'https://key@ingest.test/3',
    release: 'ruimte@0.22.0',
    tags: { launcher: 'service', platform: 'linux', arch: 'x64' },
    home: '/home/jane',
    username: 'jane',
    hostname: 'janes-box',
    ruimteHome: '/home/jane/.ruimte'
};

afterAll(() => Sentry.close(0));

test('a run of the daemon goes out as a session with its release and status, and no user or install id', async () => {
    const items: { type: string; body: Record<string, unknown> }[] = [];
    Sentry.initWithoutDefaultIntegrations({
        ...daemonClientOptions(Sentry, SETTINGS, (event) => event),
        transport: () => ({
            send: async (envelope) => {
                // As it goes over the wire, where a field without a value is left out.
                for (const [header, body] of JSON.parse(JSON.stringify(envelope[1])) as [{ type: string }, Record<string, unknown>][]) {
                    items.push({ type: header.type, body });
                }
                return {};
            },
            flush: async () => true
        })
    });
    // Ends the session this run started, as `stopTelemetry` does at the daemon's exit, and sends it.
    Sentry.endSession();
    await Sentry.flush(1000);

    const session = items.find((item) => item.type === 'session')?.body;
    expect(session).toBeDefined();
    expect(session).toMatchObject({ status: 'exited', attrs: { release: 'ruimte@0.22.0', environment: 'production' } });
    expect(session?.did).toBeUndefined();
    // Only the runtime the SDK names itself by; nothing of the person or the machine.
    const attrs = (session?.attrs ?? {}) as Record<string, string>;
    expect(Object.keys(attrs).sort()).toEqual(['environment', 'release', 'user_agent']);
    expect(attrs.user_agent).toMatch(/^Bun\/[\d.]+$/);
});
