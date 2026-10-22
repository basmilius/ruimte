import { describe, expect, test } from 'bun:test';
import { voiceToolDefinitions } from '@ruimte/actions';
import { createOpenAiLiveSession, liveTools, parseOpenAiLivePreferences } from './openai-live';

describe('createOpenAiLiveSession', () => {
    test('exchanges an SDP offer without returning the API key', async () => {
        const requests: RequestInit[] = [];
        const answer = await createOpenAiLiveSession(
            async (_input, init) => {
                requests.push(init);
                return Response.json({ session: { id: 'live-1' }, transport: { type: 'webrtc', sdp: 'answer' } });
            },
            'sk-private',
            'offer',
            { language: 'nl', voice: 'cedar' }
        );

        expect(answer).toEqual({ session: { id: 'live-1' }, transport: { type: 'webrtc', sdp: 'answer' } });
        expect(requests[0]?.headers).toEqual({ Authorization: 'Bearer sk-private', 'Content-Type': 'application/json' });
        expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
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
        let body: { session: { instructions: string; delegation: { responses: { instructions: string } } } } | null = null;
        await createOpenAiLiveSession(
            async (_input, init) => {
                body = JSON.parse(String(init.body));
                return Response.json({ session: { id: 'live-1' }, transport: { type: 'webrtc', sdp: 'answer' } });
            },
            'sk-private',
            'offer',
            { language: 'nl', voice: 'marin' }
        );

        expect(body!.session.instructions.startsWith('Conduct the entire conversation in Dutch.')).toBe(true);
        expect(
            body!.session.delegation.responses.instructions.startsWith('Write every reply that the voice will say to the user in natural, idiomatic Dutch')
        ).toBe(true);
    });

    test('turns authentication failures into a safe message', async () => {
        await expect(
            createOpenAiLiveSession(async () => new Response('secret details', { status: 401 }), 'sk-private', 'offer', {
                language: 'en',
                voice: 'marin'
            })
        ).rejects.toThrow('The saved OpenAI API key was rejected');
    });
});

describe('parseOpenAiLivePreferences', () => {
    test('accepts a listed language and built-in Live voice', () => {
        expect(parseOpenAiLivePreferences({ language: 'ja', voice: 'cedar' })).toEqual({ language: 'ja', voice: 'cedar' });
    });

    test('rejects values outside the settings protocol', () => {
        expect(parseOpenAiLivePreferences({ language: 'klingon', voice: 'marin' })).toBeNull();
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'robot' })).toBeNull();
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'willow' })).toBeNull();
    });

    test('keeps the domains a page names, drops one this shell does not know, and refuses a list that is no list', () => {
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'marin', domains: ['workspace', 'future', 'developer'] })).toEqual({
            language: 'nl',
            voice: 'marin',
            domains: ['workspace', 'developer']
        });
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'marin', domains: 'developer' })).toBeNull();
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
        let body = '';
        await createOpenAiLiveSession(
            async (_input, init) => {
                body = String(init.body);
                return Response.json({ session: { id: 'live-1' }, transport: { type: 'webrtc', sdp: 'answer' } });
            },
            'sk-private',
            'offer',
            { language: 'nl', voice: 'cedar', domains: ['workspace', 'agents'] }
        );
        expect(body).toMatchSnapshot();
    });
});
