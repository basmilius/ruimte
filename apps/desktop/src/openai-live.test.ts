import { describe, expect, test } from 'bun:test';
import { createOpenAiLiveSession, parseOpenAiLivePreferences } from './openai-live';

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
                instructions: expect.stringContaining('standard accent of a native Dutch speaker'),
                audio: { output: { voice: 'cedar' } },
                delegation: {
                    type: 'responses',
                    responses: {
                        model: 'gpt-5.6-terra',
                        instructions: expect.stringContaining('calling Ruimte tools'),
                        max_output_tokens: 256,
                        reasoning: { effort: 'none' },
                        text: { verbosity: 'low' },
                        tools: expect.arrayContaining([expect.objectContaining({ name: 'prompt_ai_chat' })]),
                        tool_choice: 'auto',
                        parallel_tool_calls: true
                    }
                }
            },
            transport: { type: 'webrtc', sdp: 'offer' }
        });
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
});
