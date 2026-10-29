import { afterEach, expect, test } from 'bun:test';
import * as Sentry from '@sentry/bun';
import { registerDebugId } from './debug-id.ts';

const DEBUG_ID = '6f1c1d4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f';
const global = globalThis as { _sentryDebugIds?: Record<string, string> };

afterEach(() => {
    delete global._sentryDebugIds;
});

/* The debug images a report of this error would carry, read where the reporter hands it to `beforeSend`. */
async function imagesOf(error: Error): Promise<unknown> {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const client = new Sentry.BunClient({
        dsn: 'https://public@example.invalid/1',
        integrations: [],
        stackParser: Sentry.defaultStackParser,
        transport: Sentry.makeFetchTransport,
        beforeSend: (event) => {
            resolve(event.debug_meta?.images);
            return null;
        }
    });
    client.captureException(error);
    return promise;
}

// In the bundle every module shares one file; here the stack has to start in this one.
test('a report of an error in the file it was registered from names that source map', async () => {
    registerDebugId(DEBUG_ID, new Error().stack);

    expect(await imagesOf(new Error('probe'))).toEqual([{ type: 'sourcemap', code_file: import.meta.path, debug_id: DEBUG_ID }]);
});

test('keeps the ids registered before it', () => {
    global._sentryDebugIds = { 'Error\n    at /other.js:1:1': 'other' };
    registerDebugId(DEBUG_ID, 'Error\n    at /$bunfs/root/ruimte:2:45\n    at processTicksAndRejections (native:7:39)');

    expect(global._sentryDebugIds).toEqual({ 'Error\n    at /other.js:1:1': 'other', 'Error\n    at /$bunfs/root/ruimte:2:45': DEBUG_ID });
});
