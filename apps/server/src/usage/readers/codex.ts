import { asObject, asString, int, type UsageRecord } from '../record.ts';

/* A `token_count` line carries the counts; the other two carry the model and the directory they belong to. */
export const codexMightCarryUsage = (line: string): boolean => line.includes('token_count') || line.includes('turn_context') || line.includes('session_meta');

/* A fork replays its ancestors' events into the new file the moment it is created, so anything this
   close to the file's own start is a copy of work that was already counted somewhere else. */
const FORK_COPY_MAX_GAP_MS = 1_000;

interface CodexCounts {
    input: number;
    cached: number;
    cacheWrite: number;
    output: number;
    reasoning: number;
}

/*
 * What one file's reader has to remember between lines. A `token_count` line names neither the model
 * nor the directory, and its totals are cumulative, so a scan that resumes halfway through a file
 * needs all of it back. Everything here is JSON, so the index can store it verbatim.
 */
export interface CodexParserState {
    model: string | null;
    sessionId: string;
    cwd: string;
    /* The running cumulative total of the last line, which the next line is a delta against. */
    total: CodexCounts | null;
    sawSessionMeta: boolean;
    /* Whether this file opened as a fork or a sub-agent thread, and where its replayed prefix is. */
    suppressing: boolean;
    anchorMs: number;
    /* The last counts as they were written, so a line repeated verbatim is not counted twice. */
    lastSignature: string | null;
}

export const createCodexState = (): CodexParserState => ({
    model: null,
    sessionId: '',
    cwd: '',
    total: null,
    sawSessionMeta: false,
    suppressing: false,
    anchorMs: 0,
    lastSignature: null
});

export const cloneCodexState = (state: CodexParserState): CodexParserState => ({ ...state, total: state.total === null ? null : { ...state.total } });

const countsOf = (usage: Record<string, unknown>): CodexCounts => ({
    input: int(usage.input_tokens),
    cached: int(usage.cached_input_tokens),
    cacheWrite: int(usage.cache_write_input_tokens),
    output: int(usage.output_tokens),
    reasoning: int(usage.reasoning_output_tokens)
});

const deltaOf = (total: CodexCounts, previous: CodexCounts | null): CodexCounts | null => {
    if (previous === null) {
        return total;
    }
    const delta: CodexCounts = {
        input: total.input - previous.input,
        cached: total.cached - previous.cached,
        cacheWrite: total.cacheWrite - previous.cacheWrite,
        output: total.output - previous.output,
        reasoning: total.reasoning - previous.reasoning
    };
    // A compaction or a resume restarts the count, so anything falling is not a delta at all.
    return delta.input < 0 || delta.cached < 0 || delta.cacheWrite < 0 || delta.output < 0 || delta.reasoning < 0 ? null : delta;
};

/* A thread that was forked or spawned repeats its parent's events before its own work starts. */
const isForkOrSubagent = (payload: Record<string, unknown>): boolean => {
    if (typeof payload.forked_from_id === 'string' || typeof payload.parent_thread_id === 'string') {
        return true;
    }
    const spawn = asObject(asObject(payload.source)?.subagent)?.thread_spawn;
    return typeof asObject(spawn)?.parent_thread_id === 'string';
};

/*
 * One line of `~/.codex/sessions/**\/*.jsonl`, against the state of the file it came from. Codex
 * reports a cumulative total per turn, so the call is the difference with the line before it; when
 * that difference falls the run started over and `last_token_usage` is the turn on its own. Codex
 * counts cache reads and writes inside `input_tokens`, unlike Anthropic, so what is left after
 * taking both out is the input that was actually paid for at the full rate.
 */
export const parseCodexLine = (line: string, state: CodexParserState): UsageRecord | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    const record = asObject(parsed);
    const payload = record === null ? null : asObject(record.payload);
    if (record === null || payload === null) {
        return null;
    }

    if (record.type === 'session_meta') {
        // A fork carries its ancestors' metas as well; only the file's own says what the file is.
        if (state.sawSessionMeta) {
            return null;
        }
        state.sawSessionMeta = true;
        state.sessionId = asString(payload.id) || asString(payload.session_id);
        state.cwd = asString(payload.cwd);
        if (isForkOrSubagent(payload)) {
            state.suppressing = true;
            state.anchorMs = Date.parse(asString(record.timestamp)) || 0;
        }
        return null;
    }

    if (record.type === 'turn_context') {
        const model = asString(payload.model);
        if (model !== '') {
            state.model = model;
        }
        const cwd = asString(payload.cwd);
        if (cwd !== '') {
            state.cwd = cwd;
        }
        return null;
    }

    if (payload.type !== 'token_count') {
        return null;
    }
    const info = asObject(payload.info);
    const total = info === null ? null : asObject(info.total_token_usage);
    if (info === null || total === null || state.model === null) {
        return null;
    }
    const timestampMs = Date.parse(asString(record.timestamp));
    if (Number.isNaN(timestampMs)) {
        return null;
    }

    const signature = JSON.stringify(info.total_token_usage);
    if (signature === state.lastSignature) {
        return null;
    }
    state.lastSignature = signature;

    const cumulative = countsOf(total);
    const last = asObject(info.last_token_usage);
    const counts = deltaOf(cumulative, state.total) ?? (last === null ? null : countsOf(last));
    state.total = cumulative;
    if (counts === null) {
        return null;
    }

    if (state.suppressing) {
        if (timestampMs - state.anchorMs <= FORK_COPY_MAX_GAP_MS) {
            state.anchorMs = timestampMs;
            return null;
        }
        // The first event that is not part of the replayed burst is this thread's own work.
        state.suppressing = false;
    }

    const uncached = Math.max(0, counts.input - counts.cached - counts.cacheWrite);
    const totals = {
        calls: 1,
        input: uncached,
        cacheRead: counts.cached,
        cacheWrite: counts.cacheWrite,
        cacheWrite1h: 0,
        output: counts.output,
        reasoning: Math.min(counts.output, counts.reasoning)
    };
    if (uncached + counts.cached + counts.cacheWrite + counts.output === 0) {
        return null;
    }
    return {
        provider: 'codex',
        timestampMs,
        model: state.model,
        sessionId: state.sessionId,
        cwd: state.cwd,
        totals,
        // Fork copies are gone by here, so every event that is left is a call of its own.
        dedupeKey: null
    };
};
