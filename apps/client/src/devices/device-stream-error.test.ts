import { describe, expect, test } from 'bun:test';
import { streamResponseError } from './device-stream-error';

describe('streamResponseError', () => {
    test('shows bounded plain-text startup failures', async () => {
        const response = new Response(`  Device support\nfailed\u0000 ${'x'.repeat(400)}`, { status: 503 });

        const error = await streamResponseError(response);

        expect(error.message.startsWith('Device support failed x')).toBe(true);
        expect(Array.from(error.message)).toHaveLength(320);
        expect(error.message.endsWith('…')).toBe(true);
    });

    test('keeps missing and empty responses useful', async () => {
        expect((await streamResponseError(new Response('', { status: 404 }))).message).toBe('The device stream could not be found');
        expect((await streamResponseError(new Response('', { status: 503 }))).message).toBe('The device could not start streaming');
    });
});
