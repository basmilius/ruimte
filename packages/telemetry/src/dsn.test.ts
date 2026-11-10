import { describe, expect, test } from 'bun:test';
import { TELEMETRY_DSN } from './dsn.ts';

async function wrangler(app: string): Promise<{ vars: Record<string, string> }> {
    return Bun.JSONC.parse(await Bun.file(new URL(`../../../apps/${app}/wrangler.jsonc`, import.meta.url)).text()) as { vars: Record<string, string> };
}

describe('the DSN table', () => {
    test('holds the DSN each worker deploys with', async () => {
        expect((await wrangler('pulsar-worker')).vars.OBSERVATORY_DSN).toBe(TELEMETRY_DSN.pulsar);
        expect((await wrangler('maps-worker')).vars.OBSERVATORY_DSN).toBe(TELEMETRY_DSN.maps);
    });

    test('gives every surface an app of its own', () => {
        const projects = Object.values(TELEMETRY_DSN).map((dsn) => new URL(dsn).pathname);
        expect(new Set(projects).size).toBe(projects.length);
    });
});
