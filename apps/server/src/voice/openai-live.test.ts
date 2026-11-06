import { describe, expect, spyOn, test } from 'bun:test';
import type { LiveEvent, LiveFetch, LiveFetchInit, LiveSessionRequest } from '@ruimte/voice';
import { openAiLive } from './openai-live.ts';
import { isAudioEvent, LiveSideband, SIDEBAND_CLOSE_WAIT_MS } from './sideband.ts';
import { FakeClock, FakeSocket, settle } from './voice-fakes.ts';

const KEY = 'sk-test-voice-0123456789abcdef';
const ANSWER = { session: { id: 'sess_abc' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } };

const REQUEST: LiveSessionRequest = { language: 'en', voice: 'marin', tools: [], sdp: 'v=0 offer' };

function fetchAnswering(status: number, body: unknown, calls: { url: string; init: LiveFetchInit }[] = []): LiveFetch {
    return async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
    };
}

describe('mint', () => {
    test('posts the body with the key in a header and answers the session', async () => {
        const calls: { url: string; init: LiveFetchInit }[] = [];
        const live = openAiLive({ fetch: fetchAnswering(200, ANSWER, calls) });
        const answer = await live.mint(KEY, REQUEST, new AbortController().signal);
        expect(answer).toEqual(ANSWER as never);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('https://api.openai.com/v1/live/sessions');
        expect(calls[0]!.url).not.toContain(KEY);
        expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${KEY}`);
        expect(JSON.parse(calls[0]!.init.body)).toMatchObject({
            session: { instructions: expect.stringContaining('speaking with a person on their phone') },
            transport: { sdp: 'v=0 offer' }
        });
    });

    test('the mint failures of the shared request come out coded for the phone', async () => {
        const body = { error: { message: `bad key ${KEY}` } };
        const mint = (status: number) => openAiLive({ fetch: fetchAnswering(status, body) }).mint(KEY, REQUEST, new AbortController().signal);
        await expect(mint(401)).rejects.toMatchObject({ code: 'voice-key-rejected', message: 'OpenAI rejected the Voice key on this machine' });
        await expect(mint(429)).rejects.toMatchObject({ code: 'voice-rate-limited' });
        await expect(mint(500)).rejects.toMatchObject({ code: 'voice-mint-failed', message: 'OpenAI could not start GPT-Live (500)' });
        const unreachable = openAiLive({
            fetch: async () => {
                throw new Error(`connect failed for ${KEY}`);
            }
        }).mint(KEY, REQUEST, new AbortController().signal);
        await expect(unreachable).rejects.toMatchObject({ code: 'voice-mint-failed', message: 'The machine could not reach OpenAI' });
    });

    test('a stopped start aborts the request and says so', async () => {
        const stop = new AbortController();
        const live = openAiLive({
            fetch: (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                })
        });
        const minting = live.mint(KEY, REQUEST, stop.signal);
        stop.abort();
        await expect(minting).rejects.toMatchObject({ code: 'voice-cancelled' });
    });
});

describe('attach', () => {
    function opener(sockets: FakeSocket[]) {
        return (url: string, key: string) => {
            const socket = new FakeSocket(url, key);
            sockets.push(socket);
            return socket;
        };
    }

    test('dials the attach address with the key and answers once the socket opens', async () => {
        const sockets: FakeSocket[] = [];
        const live = openAiLive({ socket: opener(sockets), clock: new FakeClock() });
        let ready = false;
        const attaching = live.attach(KEY, 'sess_abc', { event: () => undefined, lost: () => undefined }, new AbortController().signal).then((sideband) => {
            ready = true;
            return sideband;
        });
        await settle();
        expect(ready).toBe(false);
        expect(sockets[0]!.url).toBe('wss://api.openai.com/v1/live/sessions/sess_abc/attach');
        expect(sockets[0]!.key).toBe(KEY);
        sockets[0]!.open();
        expect((await attaching).closed).toBe(false);
    });

    test('a socket that closes before it opens is a failed attach, and a stop closes it', async () => {
        const sockets: FakeSocket[] = [];
        const live = openAiLive({ socket: opener(sockets), clock: new FakeClock() });
        const failing = live.attach(KEY, 'sess_abc', { event: () => undefined, lost: () => undefined }, new AbortController().signal);
        sockets[0]!.drop(1008);
        await expect(failing).rejects.toMatchObject({ code: 'voice-attach-failed' });

        const stop = new AbortController();
        const stopped = live.attach(KEY, 'sess_def', { event: () => undefined, lost: () => undefined }, stop.signal);
        stop.abort();
        await expect(stopped).rejects.toMatchObject({ code: 'voice-cancelled' });
        expect(sockets[1]!.closedWith).toBe(1000);
    });

    test('closing a session it holds no sideband to attaches only to send session.close', async () => {
        const sockets: FakeSocket[] = [];
        const clock = new FakeClock();
        const live = openAiLive({ socket: opener(sockets), clock });
        const closing = live.close(KEY, 'sess_abc');
        sockets[0]!.open();
        await settle();
        expect(sockets[0]!.sentOf('session.close')).toHaveLength(1);
        sockets[0]!.receive({ type: 'session.closed' });
        await closing;
        expect(sockets[0]!.closedWith).toBe(1000);
    });

    test('a close that cannot attach gives up after a bounded wait and only warns', async () => {
        const sockets: FakeSocket[] = [];
        const clock = new FakeClock();
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const closing = openAiLive({ socket: opener(sockets), clock }).close(KEY, 'sess_abc');
            clock.advance(5000);
            await closing;
            expect(warn).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
        } finally {
            warn.mockRestore();
        }
    });
});

describe('LiveSideband', () => {
    function sideband(clock = new FakeClock()) {
        const socket = new FakeSocket('fake://', KEY);
        const events: LiveEvent[] = [];
        const lost: number[] = [];
        const band = new LiveSideband(socket, clock, { event: (event) => events.push(event), lost: (code) => lost.push(code) });
        socket.open();
        return { socket, events, lost, band, clock };
    }

    test('audio both ways is dropped before anyone hears or logs it', () => {
        const { socket, events } = sideband();
        const log = spyOn(console, 'log').mockImplementation(() => undefined);
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            socket.receive({ type: 'session.input_audio.append', audio: 'QUJDRA==' });
            socket.receive({ type: 'session.output_audio.delta', delta: 'QUJDRA==', start_ms: 0, end_ms: 20 });
            socket.receive({ type: 'response.audio.delta', delta: 'QUJDRA==' });
            socket.receive({ type: 'input_audio_buffer.append', audio: 'QUJDRA==' });
            socket.receive({ type: 'session.output_transcript.delta', delta: 'hello' });
            socket.receive('not json at all {');
            expect(events.map((event) => event.type)).toEqual(['session.output_transcript.delta']);
            expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]).toEqual([]);
        } finally {
            log.mockRestore();
            warn.mockRestore();
            error.mockRestore();
        }
    });

    test('names audio events and nothing else', () => {
        expect(isAudioEvent('session.input_audio.append')).toBe(true);
        expect(isAudioEvent('session.output_audio.delta')).toBe(true);
        expect(isAudioEvent('output_audio_buffer.started')).toBe(true);
        expect(isAudioEvent('response.audio.done')).toBe(true);
        expect(isAudioEvent('session.output_transcript.delta')).toBe(false);
        expect(isAudioEvent('response.event')).toBe(false);
        expect(isAudioEvent('session.thinking.appended')).toBe(false);
    });

    test('a socket that goes on its own is lost, a close the daemon asked for is not', async () => {
        const first = sideband();
        first.socket.drop(1011);
        expect(first.lost).toEqual([1011]);
        expect(first.band.send({ type: 'response.create' })).toBe(false);

        const second = sideband();
        const closing = second.band.close();
        expect(second.socket.sentOf('session.close')).toHaveLength(1);
        second.socket.receive({ type: 'session.closed' });
        await closing;
        expect(second.socket.closedWith).toBe(1000);
        expect(second.lost).toEqual([]);
    });

    test('a close without session.closed lets the socket go after the wait', async () => {
        const { socket, band, clock } = sideband();
        const closing = band.close();
        expect(band.close()).toBe(closing);
        clock.advance(SIDEBAND_CLOSE_WAIT_MS - 1);
        expect(socket.closedWith).toBeNull();
        clock.advance(1);
        await closing;
        expect(socket.closedWith).toBe(1000);
    });

    test("tells another client's events from its own", () => {
        const { band } = sideband();
        band.send({ type: 'response.create', event_id: 'own-1' });
        band.send({ type: 'response.item.create', event_id: 'own-2', item: { type: 'function_call_output', call_id: 'call-1', output: '{}' } });
        expect(band.foreign({ type: 'response.create', event_id: 'own-1' })).toBe(false);
        expect(band.foreign({ type: 'response.create', event_id: 'phone-1' })).toBe(true);
        expect(band.foreign({ type: 'session.update', session: {} })).toBe(true);
        expect(
            band.foreign({ type: 'response.event', delegation_id: 'd', event: { type: 'x', item: { type: 'function_call_output', call_id: 'call-1' } } })
        ).toBe(false);
        expect(
            band.foreign({ type: 'response.event', delegation_id: 'd', event: { type: 'x', item: { type: 'function_call_output', call_id: 'call-2' } } })
        ).toBe(true);
        expect(band.foreign({ type: 'session.output_transcript.delta', delta: 'hi' })).toBe(false);
    });
});
