import { describe, expect, test } from 'bun:test';
import type { VoiceSessionRecord } from '@/voice/diagnostics';
import { MAX_STORED_REQUESTS, MAX_STORED_SESSIONS, parseStoredSessions, storedRing } from '@/voice/diagnostics-store';

const session = (startedAt: number, requests = 0): VoiceSessionRecord => ({
    startedAt,
    domains: ['workspace'],
    toolCount: 1,
    toolBytes: 10,
    requests: Array.from({ length: requests }, () => ({ status: 'answered', totalMs: 1, responses: [], calls: [] }))
});

describe('the Voice diagnostics kept across sessions', () => {
    test('keep the latest sessions and the latest requests of each', () => {
        const ring = storedRing([...Array.from({ length: MAX_STORED_SESSIONS + 3 }, (_, index) => session(index)), session(99, MAX_STORED_REQUESTS + 5)]);
        expect(ring).toHaveLength(MAX_STORED_SESSIONS);
        expect(ring[0]!.startedAt).toBe(4);
        expect(ring.at(-1)!.requests).toHaveLength(MAX_STORED_REQUESTS);
    });

    test('read back what was written, and drop what cannot be read', () => {
        const written = [session(1, 2)];
        expect(parseStoredSessions(JSON.stringify(written))).toEqual(written);
        expect(parseStoredSessions(JSON.stringify([{ startedAt: 'yesterday' }, session(2)]))).toEqual([session(2)]);
        expect(parseStoredSessions('{')).toEqual([]);
        expect(parseStoredSessions(null)).toEqual([]);
    });

    test('a domain this version does not know is left out', () => {
        expect(parseStoredSessions(JSON.stringify([{ ...session(1), domains: ['workspace', 'teleport'] }]))[0]!.domains).toEqual(['workspace']);
    });
});
