import { describe, expect, test } from 'bun:test';
import { cloneCodexState, codexMightCarryUsage, createCodexState, parseCodexLine, type CodexParserState } from './codex.ts';

const at = (seconds: number): string => new Date(Date.parse('2026-09-10T09:00:00.000Z') + seconds * 1000).toISOString();

const meta = (seconds: number, payload: Record<string, unknown> = {}): string =>
    JSON.stringify({ type: 'session_meta', timestamp: at(seconds), payload: { id: 't-1', cwd: '/home/bas/ruimte', ...payload } });

const context = (seconds: number, model = 'gpt-5.6-sol'): string =>
    JSON.stringify({ type: 'turn_context', timestamp: at(seconds), payload: { model, cwd: '/home/bas/ruimte' } });

const counts = (input: number, cached: number, cacheWrite: number, output: number, reasoning = 0): Record<string, number> => ({
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output
});

const tokens = (seconds: number, total: Record<string, number>, last: Record<string, number>): string =>
    JSON.stringify({
        type: 'event_msg',
        timestamp: at(seconds),
        payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } }
    });

const feed = (lines: readonly string[], state: CodexParserState = createCodexState()) => lines.flatMap((line) => parseCodexLine(line, state) ?? []);

describe('the Codex reader', () => {
    test('counts the difference with the cumulative total of the line before it', () => {
        const records = feed([
            meta(0),
            context(1),
            tokens(2, counts(1_000, 800, 0, 50), counts(1_000, 800, 0, 50)),
            tokens(3, counts(3_000, 2_400, 0, 130), counts(2_000, 1_600, 0, 80))
        ]);
        expect(records).toHaveLength(2);
        expect(records[0]!.totals).toEqual({ calls: 1, input: 200, cacheRead: 800, cacheWrite: 0, cacheWrite1h: 0, output: 50, reasoning: 0 });
        expect(records[1]!.totals).toEqual({ calls: 1, input: 400, cacheRead: 1_600, cacheWrite: 0, cacheWrite1h: 0, output: 80, reasoning: 0 });
        expect(records[1]!.model).toBe('gpt-5.6-sol');
        expect(records[1]!.sessionId).toBe('t-1');
        expect(records[1]!.cwd).toBe('/home/bas/ruimte');
    });

    test('falls back to the turn of its own when the cumulative total drops', () => {
        const records = feed([
            meta(0),
            context(1),
            tokens(2, counts(9_000, 7_000, 0, 400), counts(9_000, 7_000, 0, 400)),
            // A compaction restarts the count, so the difference would be negative.
            tokens(3, counts(2_000, 1_500, 0, 60), counts(2_000, 1_500, 0, 60))
        ]);
        expect(records).toHaveLength(2);
        expect(records[1]!.totals).toEqual({ calls: 1, input: 500, cacheRead: 1_500, cacheWrite: 0, cacheWrite1h: 0, output: 60, reasoning: 0 });
    });

    test('takes cache reads and writes out of the input Codex reports', () => {
        const records = feed([meta(0), context(1), tokens(2, counts(1_000, 600, 300, 20, 15), counts(1_000, 600, 300, 20, 15))]);
        expect(records[0]!.totals).toEqual({ calls: 1, input: 100, cacheRead: 600, cacheWrite: 300, cacheWrite1h: 0, output: 20, reasoning: 15 });
    });

    test('drops a line repeated verbatim and a turn that counted nothing', () => {
        const line = tokens(2, counts(1_000, 800, 0, 50), counts(1_000, 800, 0, 50));
        expect(feed([meta(0), context(1), line, line])).toHaveLength(1);
        expect(feed([meta(0), context(1), tokens(2, counts(0, 0, 0, 0), counts(0, 0, 0, 0))])).toHaveLength(0);
    });

    test('drops the burst a forked thread replays and keeps the work that follows', () => {
        const lines = [
            meta(0, { forked_from_id: 't-0' }),
            context(0),
            tokens(0, counts(1_000, 800, 0, 50), counts(1_000, 800, 0, 50)),
            tokens(0.5, counts(3_000, 2_400, 0, 130), counts(2_000, 1_600, 0, 80)),
            tokens(30, counts(5_000, 4_000, 0, 200), counts(2_000, 1_600, 0, 70))
        ];
        const records = feed(lines);
        expect(records).toHaveLength(1);
        expect(records[0]!.totals.output).toBe(70);
    });

    test('a sub-agent thread and a child thread replay the same way', () => {
        for (const payload of [{ source: { subagent: { thread_spawn: { parent_thread_id: 't-0' } } } }, { parent_thread_id: 't-0' }]) {
            const records = feed([
                meta(0, payload),
                context(0),
                tokens(0, counts(1_000, 800, 0, 50), counts(1_000, 800, 0, 50)),
                tokens(30, counts(2_000, 1_600, 0, 90), counts(1_000, 800, 0, 40))
            ]);
            expect(records).toHaveLength(1);
        }
    });

    test('counts nothing before a turn named the model, and only the first meta says what the file is', () => {
        expect(feed([meta(0), tokens(2, counts(1_000, 0, 0, 50), counts(1_000, 0, 0, 50))])).toHaveLength(0);
        const state = createCodexState();
        feed([meta(0), meta(1, { forked_from_id: 't-0' }), context(2)], state);
        expect(state.suppressing).toBe(false);
        expect(state.sessionId).toBe('t-1');
    });

    test('a copy of the state carries the running total, so a resumed read counts the same', () => {
        const state = createCodexState();
        feed([meta(0), context(1), tokens(2, counts(1_000, 800, 0, 50), counts(1_000, 800, 0, 50))], state);
        const resumed = cloneCodexState(state);
        state.total!.input = 0;
        const records = feed([tokens(3, counts(3_000, 2_400, 0, 130), counts(2_000, 1_600, 0, 80))], resumed);
        expect(records[0]!.totals.input).toBe(400);
    });

    test('the prefilter lets the three kinds of line through and keeps the rest out', () => {
        expect(codexMightCarryUsage(tokens(2, counts(1, 0, 0, 1), counts(1, 0, 0, 1)))).toBe(true);
        expect(codexMightCarryUsage(context(1))).toBe(true);
        expect(codexMightCarryUsage(meta(0))).toBe(true);
        expect(codexMightCarryUsage(JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }))).toBe(false);
    });
});
