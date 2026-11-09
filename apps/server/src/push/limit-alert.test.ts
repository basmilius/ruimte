import { describe, expect, test } from 'bun:test';
import type { UsageWindow } from '@ruimte/contracts';
import { limitBody, limitKey, limitWindow, type LimitContext } from './limit-alert.ts';

// On a whole minute, so ten seconds either side round to it.
const RESET = 1_900_000_020_000;

function window(kind: UsageWindow['kind'], used: number, resetsAt: number | null): UsageWindow {
    return { id: kind, kind, label: kind, used, resetsAt, durationMs: null };
}

function context(accountLabel: string): LimitContext {
    return { providerName: 'Codex', accountLabel, windows: [], resumes: false };
}

describe('the window a limit ran out on', () => {
    test('is the one that resets within a minute of the limit', () => {
        const windows = [window('session', 1, RESET + 3_600_000), window('weekly', 0.97, RESET + 30_000)];

        expect(limitWindow(windows, RESET)?.kind).toBe('weekly');
    });

    test('is one used up when none resets with it', () => {
        const windows = [window('session', 0.4, RESET + 3_600_000), window('weekly', 1, null)];

        expect(limitWindow(windows, RESET)?.kind).toBe('weekly');
        expect(limitWindow(windows, undefined)?.kind).toBe('weekly');
    });

    test('is none when the reads know of no such window', () => {
        expect(limitWindow([window('session', 0.4, RESET + 3_600_000)], RESET)).toBeNull();
        expect(limitWindow([], RESET)).toBeNull();
    });
});

describe('the body of a limit push', () => {
    test('names the provider, the account and the window', () => {
        expect(limitBody(context('Blis'), window('weekly', 1, RESET))).toBe('Codex (Blis): weekly limit reached.');
        expect(limitBody(context('Blis'), window('session', 1, RESET))).toBe('Codex (Blis): session limit reached.');
        expect(limitBody(context('Blis'), window('monthly', 1, RESET))).toBe('Codex (Blis): monthly limit reached.');
    });

    test('names the provider once for its default account', () => {
        expect(limitBody(context('Codex'), window('weekly', 1, RESET))).toBe('Codex: weekly limit reached.');
    });

    test('says usage limit for a window of no known length, or none', () => {
        expect(limitBody(context('Blis'), window('other', 1, RESET))).toBe('Codex (Blis): usage limit reached.');
        expect(limitBody(context('Blis'), null)).toBe('Codex (Blis): usage limit reached.');
        expect(limitBody(null, null)).toBe('Usage limit reached.');
    });
});

describe('the key of a limit', () => {
    test('rounds the reset to the minute', () => {
        expect(limitKey('codex', 'blis', RESET + 10_000)).toBe(limitKey('codex', 'blis', RESET - 10_000));
        expect(limitKey('codex', 'blis', RESET)).not.toBe(limitKey('codex', 'blis', RESET + 60_000));
        expect(limitKey('codex', 'blis', RESET)).not.toBe(limitKey('codex', 'other', RESET));
        expect(limitKey('codex', 'blis', undefined)).not.toBe(limitKey('codex', 'blis', RESET));
    });
});
