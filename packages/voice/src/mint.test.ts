import { describe, expect, test } from 'bun:test';
import { voiceToolDefinitions } from '@ruimte/actions';
import { mintLiveSession, type LiveFetch, type LiveFetchInit, type LiveMintError, type LiveSessionRequest } from './mint.ts';
import { liveTools, type LiveSessionPreferences } from './preferences.ts';

const ANSWER = { session: { id: 'live-1' }, transport: { type: 'webrtc', sdp: 'answer' } };
const KEY = 'sk-private';

function answering(status: number, body: unknown, calls: { url: string; init: LiveFetchInit }[] = []): LiveFetch {
    return async (url, init) => {
        calls.push({ url, init });
        return Response.json(body, { status });
    };
}

function requestFor(preferences: LiveSessionPreferences, sdp = 'offer'): LiveSessionRequest {
    return { language: preferences.language, voice: preferences.voice, tools: liveTools(preferences), sdp };
}

/* Mints a session against a fake OpenAI and hands back what it was sent. */
async function mint(preferences: LiveSessionPreferences, runner: 'desktop' | 'phone' = 'desktop'): Promise<{ answer: unknown; request: LiveFetchInit }> {
    const calls: { url: string; init: LiveFetchInit }[] = [];
    const answer = await mintLiveSession(answering(200, ANSWER, calls), KEY, requestFor(preferences), runner);
    return { answer, request: calls[0]!.init };
}

async function failure(promise: Promise<unknown>): Promise<LiveMintError> {
    return (await promise.then(
        () => {
            throw new Error('The mint should have failed');
        },
        (error: unknown) => error
    )) as LiveMintError;
}

describe('mintLiveSession', () => {
    test('exchanges an SDP offer without returning the API key', async () => {
        const calls: { url: string; init: LiveFetchInit }[] = [];
        const answer = await mintLiveSession(answering(200, ANSWER, calls), KEY, requestFor({ language: 'nl', voice: 'cedar' }), 'desktop');

        expect(answer as unknown).toEqual(ANSWER);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('https://api.openai.com/v1/live/sessions');
        expect(calls[0]!.url).not.toContain(KEY);
        expect(calls[0]!.init.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
        expect(JSON.parse(calls[0]!.init.body)).toMatchObject({
            session: {
                model: 'gpt-live-1',
                instructions: expect.stringContaining('standard accent of a speaker from the Netherlands, never a Flemish or Belgian accent'),
                audio: { output: { voice: 'cedar' } },
                delegation: {
                    type: 'responses',
                    responses: {
                        model: 'gpt-6-luna',
                        instructions: expect.stringContaining('Do not stop after partial success'),
                        max_output_tokens: 1024,
                        reasoning: { effort: 'none' },
                        text: { verbosity: 'low' },
                        tools: expect.arrayContaining([expect.objectContaining({ name: 'communicate' })]),
                        tool_choice: 'auto',
                        parallel_tool_calls: true
                    }
                }
            },
            transport: { type: 'webrtc', sdp: 'offer' }
        });
    });

    test('puts the spoken language first and has the backend write in it', async () => {
        const { request } = await mint({ language: 'nl', voice: 'marin' });
        const body = JSON.parse(request.body) as { session: { instructions: string; delegation: { responses: { instructions: string } } } };

        expect(body.session.instructions.startsWith('Conduct the entire conversation in Dutch.')).toBe(true);
        expect(
            body.session.delegation.responses.instructions.startsWith('Write every reply that the voice will say to the user in natural, idiomatic Dutch')
        ).toBe(true);
    });

    test('says what each runner asks of the voice', async () => {
        const desktop = JSON.parse((await mint({ language: 'en', voice: 'marin' }, 'desktop')).request.body) as { session: { instructions: string } };
        const phone = JSON.parse((await mint({ language: 'en', voice: 'marin' }, 'phone')).request.body) as { session: { instructions: string } };

        expect(desktop.session.instructions).toContain('split cells on screen');
        expect(phone.session.instructions).toContain('speaking with a person on their phone');
    });

    test('sends the key only in the Authorization header', async () => {
        const { request } = await mint({ language: 'en', voice: 'marin' });

        expect(request.body).not.toContain(KEY);
    });

    test('passes the abort signal on and says so when the start was stopped', async () => {
        const stop = new AbortController();
        const minting = mintLiveSession(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
            KEY,
            requestFor({ language: 'en', voice: 'marin' }),
            'phone',
            { signal: stop.signal }
        );
        stop.abort();

        expect((await failure(minting)).code).toBe('cancelled');
    });

    test('points at another base only when a test says so', async () => {
        const calls: { url: string; init: LiveFetchInit }[] = [];
        await mintLiveSession(answering(200, ANSWER, calls), KEY, requestFor({ language: 'en', voice: 'marin' }), 'phone', { baseUrl: 'http://127.0.0.1:9' });

        expect(calls[0]!.url).toBe('http://127.0.0.1:9/v1/live/sessions');
    });

    describe('what goes wrong', () => {
        const preferences: LiveSessionPreferences = { language: 'en', voice: 'marin' };
        const secretBody = { error: { message: `bad key ${KEY}` } };

        test('a refused key and a limit are told apart from any other status, per runner', async () => {
            expect(await failure(mintLiveSession(answering(401, secretBody), KEY, requestFor(preferences), 'desktop'))).toMatchObject({
                code: 'key-rejected',
                message: 'The saved OpenAI API key was rejected'
            });
            expect(await failure(mintLiveSession(answering(401, secretBody), KEY, requestFor(preferences), 'phone'))).toMatchObject({
                code: 'key-rejected',
                message: 'OpenAI rejected the Voice key on this machine'
            });
            expect(await failure(mintLiveSession(answering(429, secretBody), KEY, requestFor(preferences), 'desktop'))).toMatchObject({
                code: 'rate-limited',
                message: 'OpenAI is limiting this key for now'
            });
            expect(await failure(mintLiveSession(answering(500, secretBody), KEY, requestFor(preferences), 'desktop'))).toMatchObject({
                code: 'failed',
                message: 'OpenAI could not start GPT-Live (500)'
            });
        });

        test('no message holds the key or what OpenAI answered', async () => {
            const statuses = await Promise.all(
                [401, 429, 500].map((status) => failure(mintLiveSession(answering(status, secretBody), KEY, requestFor(preferences), 'phone')))
            );
            const unreachable = await failure(
                mintLiveSession(
                    async () => {
                        throw new Error(`connect failed for ${KEY}`);
                    },
                    KEY,
                    requestFor(preferences),
                    'phone'
                )
            );

            expect(unreachable.code).toBe('unreachable');
            for (const error of [...statuses, unreachable]) {
                expect(error.message).not.toContain(KEY);
            }
        });

        test('an offer that is empty or too large is refused before anything is sent', async () => {
            const calls: { url: string; init: LiveFetchInit }[] = [];
            for (const sdp of ['  ', 'x'.repeat(128_001)]) {
                expect((await failure(mintLiveSession(answering(200, ANSWER, calls), KEY, requestFor(preferences, sdp), 'desktop'))).code).toBe(
                    'invalid-offer'
                );
            }

            expect(calls).toEqual([]);
        });

        test('an answer that is no session, or a session id that is no id, is refused', async () => {
            expect((await failure(mintLiveSession(answering(200, { session: {} }), KEY, requestFor(preferences), 'desktop'))).code).toBe('invalid-session');
            expect(
                (await failure(mintLiveSession(answering(200, { ...ANSWER, session: { id: '../../admin' } }), KEY, requestFor(preferences), 'desktop'))).code
            ).toBe('invalid-session');
        });
    });
});

describe('liveTools', () => {
    test('sends the tools of the named domains, and every tool to a page that named none', () => {
        expect(liveTools({ language: 'nl', voice: 'marin', domains: ['workspace'] }).map((tool) => tool.name)).toEqual(['inspect_workspace', 'control_action']);
        expect(liveTools({ language: 'nl', voice: 'marin' })).toEqual(voiceToolDefinitions());
    });
});

/*
 * The desktop's tools and mint body are held byte for byte, so a change to how Voice tools are built for
 * the daemon never changes what the desktop offers without a reviewed snapshot update.
 */
describe('the desktop GPT-Live session', () => {
    test('offers the same tools, byte for byte', () => {
        expect(JSON.stringify(liveTools({ language: 'nl', voice: 'marin' }))).toMatchSnapshot();
        expect(JSON.stringify(liveTools({ language: 'nl', voice: 'marin', domains: ['workspace', 'communicate', 'sessions'] }))).toMatchSnapshot();
    });

    test('mints with the same body, byte for byte', async () => {
        const { request } = await mint({ language: 'nl', voice: 'cedar', domains: ['workspace', 'agents'] });
        expect(request.body).toMatchSnapshot();
    });
});
