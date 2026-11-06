import { describe, expect, test } from 'bun:test';
import {
    ANSWER_TIMEOUT_MS,
    BROWSER_ASK_TIMEOUT_MS,
    BROWSER_LOAD_TIMEOUT_MS,
    BROWSER_START_TIMEOUT_MS,
    DIRECT_ATTEMPT_TIMEOUT_MS,
    ICE_GATHER_TIMEOUT_MS,
    REQUEST_TIMEOUT_MS,
    SIGNAL_OWNER_TTL_MS
} from './timeouts.ts';

describe('the waits of one exchange', () => {
    test('a machine answers before the client gives up on a request', () => {
        expect(ANSWER_TIMEOUT_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
    });

    test('an ask of a page outlasts what the client waits on the page', () => {
        expect(BROWSER_ASK_TIMEOUT_MS).toBeGreaterThan(BROWSER_LOAD_TIMEOUT_MS + BROWSER_START_TIMEOUT_MS);
        expect(BROWSER_ASK_TIMEOUT_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
    });

    test('a connection id stays with its offerer past an attempt and the gathering before it', () => {
        expect(SIGNAL_OWNER_TTL_MS).toBeGreaterThan(DIRECT_ATTEMPT_TIMEOUT_MS + ICE_GATHER_TIMEOUT_MS);
        expect(ICE_GATHER_TIMEOUT_MS).toBeLessThan(DIRECT_ATTEMPT_TIMEOUT_MS);
    });
});
