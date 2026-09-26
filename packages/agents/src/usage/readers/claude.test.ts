import { describe, expect, test } from 'bun:test';
import { foldByKey } from '../record.ts';
import { claudeMightCarryUsage, parseClaudeLine } from './claude.ts';

const line = (message: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-10T09:17:15.000Z',
        sessionId: 's-1',
        cwd: '/home/bas/ruimte',
        message: { id: 'msg_1', model: 'claude-opus-5', ...message },
        ...extra
    });

const usage = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    input_tokens: 12,
    cache_read_input_tokens: 9_000,
    cache_creation_input_tokens: 800,
    cache_creation: { ephemeral_1h_input_tokens: 300, ephemeral_5m_input_tokens: 500 },
    output_tokens: 640,
    output_tokens_details: { thinking_tokens: 120 },
    ...patch
});

describe('the Claude reader', () => {
    test('takes the counts, the model and the directory off an assistant line', () => {
        const record = parseClaudeLine(line({ usage: usage() }));
        expect(record).not.toBeNull();
        expect(record?.provider).toBe('claude');
        expect(record?.model).toBe('claude-opus-5');
        expect(record?.sessionId).toBe('s-1');
        expect(record?.cwd).toBe('/home/bas/ruimte');
        expect(record?.timestampMs).toBe(Date.parse('2026-09-10T09:17:15.000Z'));
        expect(record?.totals).toEqual({ calls: 1, input: 12, cacheRead: 9_000, cacheWrite: 800, cacheWrite1h: 300, output: 640, reasoning: 120 });
        expect(record?.dedupeKey).toBe('msg_1');
    });

    test('skips a line that is not an assistant answer, has no counts or cannot be placed in time', () => {
        expect(parseClaudeLine(JSON.stringify({ type: 'user', message: { usage: usage() } }))).toBeNull();
        expect(parseClaudeLine(line({}))).toBeNull();
        expect(parseClaudeLine(line({ usage: usage() }, { timestamp: 'yesterday' }))).toBeNull();
        expect(parseClaudeLine(line({ usage: usage(), model: '' }))).toBeNull();
        expect(parseClaudeLine('{ not json')).toBeNull();
    });

    test('reads a field that is missing or nonsense as zero', () => {
        const record = parseClaudeLine(line({ usage: { input_tokens: -4, output_tokens: 'lots', cache_read_input_tokens: 12 } }));
        expect(record?.totals).toEqual({ calls: 1, input: 0, cacheRead: 12, cacheWrite: 0, cacheWrite1h: 0, output: 0, reasoning: 0 });
    });

    test('a line that never reached the API is not a call', () => {
        // What Claude Code writes for an interruption or an error it answered itself.
        expect(parseClaudeLine(line({ usage: usage(), model: '<synthetic>' }))).toBeNull();
        expect(parseClaudeLine(line({ usage: { input_tokens: 0, output_tokens: 0 } }))).toBeNull();
    });

    test('folds the copies of one message into the largest value per field', () => {
        const growing = parseClaudeLine(line({ usage: usage({ output_tokens: 40, output_tokens_details: { thinking_tokens: 0 } }) }))!;
        const complete = parseClaudeLine(line({ usage: usage() }))!;
        const other = parseClaudeLine(line({ id: 'msg_2', usage: usage({ output_tokens: 7 }) }))!;
        const folded = foldByKey([growing, complete, other]);
        expect(folded).toHaveLength(2);
        expect(folded[0]!.totals.output).toBe(640);
        expect(folded[0]!.totals.reasoning).toBe(120);
        expect(folded[0]!.totals.calls).toBe(1);
        expect(folded[1]!.totals.output).toBe(7);
    });

    test('a line without a message id stays a call of its own', () => {
        const first = parseClaudeLine(line({ id: undefined, usage: usage() }))!;
        const second = parseClaudeLine(line({ id: undefined, usage: usage() }))!;
        expect(first.dedupeKey).toBeNull();
        expect(foldByKey([first, second])).toHaveLength(2);
    });

    test('the prefilter lets a line with counts through and keeps the rest out', () => {
        expect(claudeMightCarryUsage(line({ usage: usage() }))).toBe(true);
        expect(claudeMightCarryUsage(JSON.stringify({ type: 'user', message: { content: 'hello' } }))).toBe(false);
    });
});
