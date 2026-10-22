import type { ActionOutput } from '@ruimte/actions';
import type { ChatInfo } from '@ruimte/contracts';

export type ChatReadUsage = NonNullable<ActionOutput<'context.read'>['usage']>;

export type ChatUsageInfo = Pick<ChatInfo, 'provider' | 'model' | 'selection' | 'usage'>;

export function chatReadUsage(info: ChatUsageInfo, now: number): ChatReadUsage {
    const { contextTokens, contextWindow, cacheExpiresAt, cacheTtlMs } = info.usage;
    return {
        provider: info.provider,
        model: info.model ?? info.selection.model,
        contextTokens,
        contextWindow,
        contextPercent: contextWindow === null ? null : Math.round((contextTokens / contextWindow) * 100),
        cache:
            cacheExpiresAt === undefined
                ? null
                : {
                      ttlMs: cacheTtlMs ?? null,
                      expiresAt: new Date(cacheExpiresAt).toISOString(),
                      expiresInMs: Math.round(cacheExpiresAt - now),
                      expired: cacheExpiresAt <= now
                  }
    };
}

/* Whole seconds up to a minute, then minutes and seconds, then hours and minutes: what an agent weighs a wait by. */
export function spanText(ms: number): string {
    const seconds = Math.round(Math.abs(ms) / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function cacheText(cache: ChatReadUsage['cache']): string {
    if (cache === null) {
        return 'prompt cache lifetime not reported';
    }
    const lifetime = cache.ttlMs === null ? '' : `, lifetime ${spanText(cache.ttlMs)}`;
    return cache.expired
        ? `prompt cache went cold ${spanText(cache.expiresInMs)} ago (${cache.expiresAt}${lifetime})`
        : `prompt cache warm for ${spanText(cache.expiresInMs)} more (until ${cache.expiresAt}${lifetime})`;
}

/* The one line a chat read starts with, above the plans and the thread. */
export function chatUsageLine(usage: ChatReadUsage): string {
    const context =
        usage.contextWindow === null
            ? `context ${usage.contextTokens} tokens`
            : `context ${usage.contextTokens} of ${usage.contextWindow} tokens (${usage.contextPercent}%)`;
    return `> Usage: ${usage.provider} ${usage.model}, ${context}, ${cacheText(usage.cache)}`;
}
