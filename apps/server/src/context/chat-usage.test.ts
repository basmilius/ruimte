import { describe, expect, test } from 'bun:test';
import { chatReadUsage, chatUsageLine, spanText, type ChatUsageInfo } from './chat-usage.ts';

const NOW = Date.UTC(2026, 9, 22, 10, 0, 0);

function info(usage: Partial<ChatUsageInfo['usage']> = {}, model: string | null = 'gpt-5.5'): ChatUsageInfo {
    return {
        provider: 'codex',
        model,
        selection: { model: 'gpt-5.5-picked', options: {} },
        usage: { contextTokens: 12_345, contextWindow: null, costUsd: 0, turns: 1, ...usage }
    };
}

describe('the usage line of a chat read', () => {
    test('says how long ago a prompt cache went cold', () => {
        const usage = chatReadUsage(info({ contextWindow: 400_000, cacheTtlMs: 3_600_000, cacheExpiresAt: NOW - 754_000 }), NOW);
        expect(usage.cache).toEqual({ ttlMs: 3_600_000, expiresAt: '2026-10-22T09:47:26.000Z', expiresInMs: -754_000, expired: true });
        expect(chatUsageLine(usage)).toBe(
            '> Usage: codex gpt-5.5, context 12345 of 400000 tokens (3%), prompt cache went cold 12m 34s ago (2026-10-22T09:47:26.000Z, lifetime 1h 0m)'
        );
    });

    test('names the picked model and leaves the window and the cache out when the CLI named neither', () => {
        expect(chatUsageLine(chatReadUsage(info({}, null), NOW))).toBe(
            '> Usage: codex gpt-5.5-picked, context 12345 tokens, prompt cache lifetime not reported'
        );
    });

    test('a cache with an end and no lifetime still says when it ends', () => {
        expect(chatUsageLine(chatReadUsage(info({ cacheExpiresAt: NOW + 30_000 }), NOW))).toEndWith(
            'prompt cache warm for 30s more (until 2026-10-22T10:00:30.000Z)'
        );
    });

    test('a span reads in seconds, minutes or hours', () => {
        expect(spanText(0)).toBe('0s');
        expect(spanText(-59_400)).toBe('59s');
        expect(spanText(61_000)).toBe('1m 1s');
        expect(spanText(5_400_000)).toBe('1h 30m');
    });
});
