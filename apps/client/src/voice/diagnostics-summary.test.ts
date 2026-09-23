import { describe, expect, test } from 'bun:test';
import type { VoiceCallRecord, VoiceRequestRecord, VoiceSessionRecord } from '@/voice/diagnostics';
import { median, summarizeVoiceSessions } from '@/voice/diagnostics-summary';

const call = (action: string, result: string | null, durationMs: number | null, target?: VoiceCallRecord['target']): VoiceCallRecord => ({
    tool: 'tool',
    action,
    response: 0,
    durationMs,
    result,
    ...(target ? { target } : {})
});

const request = (calls: VoiceCallRecord[], totalMs: number | null, responses: number[]): VoiceRequestRecord => ({
    status: totalMs === null ? 'unfinished' : 'answered',
    totalMs,
    responses: responses.map((durationMs) => ({ durationMs, status: 'completed', calls: 0 })),
    calls
});

const session = (requests: VoiceRequestRecord[], toolBytes = 1_000): VoiceSessionRecord => ({
    startedAt: 0,
    domains: ['workspace'],
    toolCount: 2,
    toolBytes,
    requests
});

describe('median', () => {
    test('is the middle value, or the mean of the middle two', () => {
        expect(median([])).toBeNull();
        expect(median([5, 1, 3])).toBe(3);
        expect(median([4, 1, 3, 2])).toBe(2.5);
    });
});

describe('summarizeVoiceSessions', () => {
    const sessions = [
        session([
            request(
                [
                    call('target.resolve', 'ok', 100, { found: 1, ambiguous: 0, missing: 0 }),
                    call('view.focus', 'ok', 300),
                    call('node.delete', 'needs_confirmation', 200)
                ],
                2_000,
                [800, 1_200]
            ),
            request([call('target.resolve', 'ok', 50, { found: 0, ambiguous: 0, missing: 1 })], 900, [900])
        ]),
        session(
            [
                request(
                    [
                        call('target.resolve', 'ok', 70, { found: 2, ambiguous: 1, missing: 0 }),
                        call('view.focus', 'unknown-view', 40),
                        call('view.focus', null, null)
                    ],
                    null,
                    [600]
                ),
                request([], 400, [400])
            ],
            3_000
        )
    ];
    const summary = summarizeVoiceSessions(sessions);

    test('counts requests, calls and calls per request', () => {
        expect(summary).toMatchObject({ sessions: 2, requests: 4, answered: 3, calls: 7, callsPerRequest: 1.75, mostCallsInRequest: 3 });
    });

    test('a failure is a share of the finished calls, and a confirmation question is listed but not failed', () => {
        expect(summary.failedShare).toBeCloseTo(1 / 6);
        expect(summary.results).toEqual([
            { name: 'needs_confirmation', count: 1, share: 1 / 6 },
            { name: 'unknown-view', count: 1, share: 1 / 6 }
        ]);
    });

    test('target lookups say how often a name was ambiguous, missing, or found once, several times or not at all', () => {
        expect(summary.targets).toEqual({
            resolves: 3,
            ambiguousShare: 1 / 3,
            missingShare: 1 / 3,
            noneShare: 1 / 3,
            oneShare: 1 / 3,
            severalShare: 1 / 3
        });
    });

    test('latency is a median and a slowest, and only an answered request has a time until the answer', () => {
        expect(summary.latency.response).toEqual({ count: 5, medianMs: 800, slowestMs: 1_200 });
        expect(summary.latency.call).toEqual({ count: 6, medianMs: 85, slowestMs: 300 });
        expect(summary.latency.answer).toEqual({ count: 3, medianMs: 900, slowestMs: 2_000 });
    });

    test('names the most used actions first and reports the latest session', () => {
        expect(summary.actions.slice(0, 2)).toEqual([
            { name: 'target.resolve', count: 3, share: 3 / 7 },
            { name: 'view.focus', count: 3, share: 3 / 7 }
        ]);
        expect(summary.latest).toEqual({ domains: ['workspace'], toolCount: 2, toolBytes: 3_000 });
    });

    test('nothing measured is null, never a division by zero', () => {
        const empty = summarizeVoiceSessions([]);
        expect(empty).toMatchObject({ requests: 0, callsPerRequest: null, failedShare: null, mostCallsInRequest: 0, latest: null });
        expect(empty.targets.ambiguousShare).toBeNull();
        expect(empty.latency.answer).toEqual({ count: 0, medianMs: null, slowestMs: null });
    });
});
