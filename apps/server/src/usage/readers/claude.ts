import { int, type UsageRecord } from '../record.ts';

/* Only a line with this in it can carry counts, which keeps `JSON.parse` off about two thirds of them. */
export const claudeMightCarryUsage = (line: string): boolean => line.includes('"usage"');

const asObject = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/*
 * One line of `~/.claude/projects/**\/*.jsonl`. An assistant line carries `message.usage` with the
 * counts of the call that produced it; every other kind of line has nothing to price. The counts are
 * Anthropic's, so `input_tokens` already excludes what was read from or written to the cache.
 */
export const parseClaudeLine = (line: string): UsageRecord | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    const record = asObject(parsed);
    if (record === null || record.type !== 'assistant') {
        return null;
    }
    const message = asObject(record.message);
    const usage = message === null ? null : asObject(message.usage);
    if (message === null || usage === null) {
        return null;
    }
    const model = asString(message.model);
    const timestampMs = Date.parse(asString(record.timestamp));
    // `<synthetic>` is what Claude Code writes for a message it made up itself, an error or an
    // interruption. It never reached the API, and its counts are zero, so it is not a call.
    if (model === '' || model === '<synthetic>' || Number.isNaN(timestampMs)) {
        return null;
    }
    const creation = asObject(usage.cache_creation);
    const outputDetails = asObject(usage.output_tokens_details);
    const messageId = asString(message.id);
    const totals = {
        calls: 1,
        input: int(usage.input_tokens),
        cacheRead: int(usage.cache_read_input_tokens),
        cacheWrite: int(usage.cache_creation_input_tokens),
        cacheWrite1h: creation === null ? 0 : int(creation.ephemeral_1h_input_tokens),
        output: int(usage.output_tokens),
        reasoning: outputDetails === null ? 0 : int(outputDetails.thinking_tokens)
    };
    if (totals.input + totals.cacheRead + totals.cacheWrite + totals.output === 0) {
        return null;
    }
    return {
        provider: 'claude',
        timestampMs,
        model,
        sessionId: asString(record.sessionId),
        cwd: asString(record.cwd),
        totals,
        dedupeKey: messageId === '' ? null : messageId
    };
};
