import { describe, expect, test } from 'bun:test';
import { voiceToolsFor } from '@ruimte/actions';
import { VoiceDiagnosticsRecorder, voiceActionOf, voiceResultOf, type VoiceSessionRecord } from '@/voice/diagnostics';

const clock = () => {
    let time = 1_000;
    return {
        now: () => time,
        advance: (ms: number) => {
            time += ms;
        }
    };
};

const recording = () => {
    const time = clock();
    let latest: VoiceSessionRecord | null = null;
    const recorder = new VoiceDiagnosticsRecorder(['workspace', 'views'], time.now, (session) => {
        latest = session;
    });
    return { time, recorder, latest: (): VoiceSessionRecord => latest! };
};

describe('what a Voice call is recorded as', () => {
    test('an action is kept only when its tool has it', () => {
        expect(voiceActionOf('manage_views', '{"action":"view.focus","viewId":"main"}')).toBe('view.focus');
        expect(voiceActionOf('manage_views', '{"action":"open the pod bay doors"}')).toBeNull();
        expect(voiceActionOf('manage_views', 'not json')).toBeNull();
        expect(voiceActionOf('control_action', '{"action":"confirm","confirmation_token":"secret"}')).toBe('confirm');
    });

    test('a result is ok, a confirmation question or a code, and a message never passes for a code', () => {
        expect(voiceResultOf({ ok: true, message: 'Focused Main.' })).toBe('ok');
        expect(voiceResultOf({ ok: false, needs_confirmation: true, confirmation_token: 'x' })).toBe('needs_confirmation');
        expect(voiceResultOf({ ok: false, code: 'unknown-node', message: 'No such node.' })).toBe('unknown-node');
        expect(voiceResultOf({ ok: false, code: 'Nothing called Groceries here', message: '' })).toBe('failed');
        expect(voiceResultOf({ ok: false, message: 'It broke.' })).toBe('failed');
    });
});

describe('VoiceDiagnosticsRecorder', () => {
    test('a session knows its domains and the size of the tools it was sent', () => {
        const { latest } = recording();
        const tools = voiceToolsFor(['workspace', 'views']);
        expect(latest()).toMatchObject({
            startedAt: 1_000,
            domains: ['workspace', 'views'],
            toolCount: tools.length,
            toolBytes: new TextEncoder().encode(JSON.stringify(tools)).length,
            requests: []
        });
    });

    test('follows a request through two model responses and the calls between them', () => {
        const { time, recorder, latest } = recording();
        recorder.responseEvent('d1', 'response.created');
        time.advance(400);
        recorder.responseEvent('d1', 'response.output_item.done');
        recorder.callStarted('d1', 'c1', 'inspect_workspace', '{"action":"target.resolve","names":["Groceries"]}');
        recorder.callStarted('d1', 'c2', 'manage_views', '{"action":"view.focus","viewId":"main"}');
        time.advance(100);
        recorder.responseEvent('d1', 'response.completed');
        time.advance(50);
        recorder.callFinished('c1', { ok: true, found: [{ id: 'a' }, { id: 'b' }], ambiguous: [], missing: ['Groceries'] });
        time.advance(30);
        recorder.callFinished('c2', { ok: false, code: 'unknown-view', message: 'No view “main”.' });
        recorder.responseRequested('d1');
        time.advance(700);
        recorder.responseEvent('d1', 'response.created');
        recorder.responseEvent('d1', 'response.completed');

        expect(latest().requests).toEqual([
            {
                status: 'answered',
                totalMs: 1_280,
                responses: [
                    { durationMs: 500, status: 'completed', calls: 2 },
                    { durationMs: 700, status: 'completed', calls: 0 }
                ],
                calls: [
                    {
                        tool: 'inspect_workspace',
                        action: 'target.resolve',
                        response: 0,
                        durationMs: 150,
                        result: 'ok',
                        target: { found: 2, ambiguous: 0, missing: 1 }
                    },
                    { tool: 'manage_views', action: 'view.focus', response: 0, durationMs: 180, result: 'unknown-view' }
                ]
            }
        ]);
    });

    test('keeps no argument text, message or delegation id', () => {
        const { recorder, latest } = recording();
        recorder.callStarted('delegation-secret', 'call-secret', 'communicate', '{"action":"chat.send","prompt":"my private words"}');
        recorder.callFinished('call-secret', { ok: false, code: 'unknown-chat', message: 'No chat called my private words.' });
        const stored = JSON.stringify(latest());
        expect(stored).not.toContain('private');
        expect(stored).not.toContain('secret');
    });

    test('a failed response ends its request, and the end of the session leaves the rest unfinished', () => {
        const { time, recorder, latest } = recording();
        recorder.responseEvent('d1', 'response.created');
        time.advance(200);
        recorder.responseEvent('d1', 'response.failed');
        recorder.callStarted('d2', 'c1', 'inspect_workspace', '{"action":"workspace.inspect"}');
        recorder.finish();
        expect(latest().requests.map((request) => [request.status, request.totalMs])).toEqual([
            ['failed', 200],
            ['unfinished', null]
        ]);
        expect(latest().requests[1]!.calls[0]!.result).toBeNull();
    });

    test('clear forgets the requests and keeps what the session was sent', () => {
        const { recorder, latest } = recording();
        recorder.responseEvent('d1', 'response.completed');
        recorder.clear();
        expect(latest().requests).toEqual([]);
        expect(latest().domains).toEqual(['workspace', 'views']);
    });
});
