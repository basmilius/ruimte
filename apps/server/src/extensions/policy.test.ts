import { describe, expect, test } from 'bun:test';
import { everyMs, MAX_SENDS_PER_HOUR, SendLimit } from './policy.ts';

describe('SendLimit', () => {
    test('lets a chat be sent to again once the oldest send is an hour old, and counts each chat apart', () => {
        let now = 0;
        const limit = new SendLimit(() => now);

        for (let send = 0; send < MAX_SENDS_PER_HOUR; send++) {
            expect(limit.take('acme.builds', 'chat-1')).toBeNull();
            now += 1000;
        }

        expect(limit.take('acme.builds', 'chat-1')).toMatchObject({ code: 'limit' });
        expect(limit.take('acme.builds', 'chat-2')).toBeNull();

        now = 3_600_000;

        expect(limit.take('acme.builds', 'chat-1')).toBeNull();
        expect(limit.take('acme.builds', 'chat-1')).toMatchObject({ code: 'limit' });
    });
});

describe('everyMs', () => {
    test('reads seconds, minutes and hours, and refuses anything under ten seconds', () => {
        expect([everyMs('10s'), everyMs('5m'), everyMs('1h')]).toEqual([10_000, 300_000, 3_600_000]);
        expect(() => everyMs('9s')).toThrow('of at least 10 seconds, not 9s');
        expect(() => everyMs('5 minutes')).toThrow('not 5 minutes');
    });
});
