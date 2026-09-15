import { describe, expect, test } from 'bun:test';
import { portTaken } from './start.ts';

describe('portTaken', () => {
    test('sees a port Bun.serve holds and not one it let go of', async () => {
        const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
        const port = server.port!;
        try {
            expect(await portTaken('127.0.0.1', port)).toBe(true);
        } finally {
            await server.stop(true);
        }
        expect(await portTaken('127.0.0.1', port)).toBe(false);
    });
});
