import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackendEvent, BackendLaunch, ChatBackend, TurnInput } from '@adecore/agents/chat';
import { BackendEventLog, usageLines } from '../chat/chat-test-helpers.ts';
import { nanoGptBackend } from './nanogpt-provider.ts';
import { NANOGPT_URL, NanoGptService } from './nanogpt-service.ts';

const turn: TurnInput = { text: 'What is in the project?', preamble: null, attachments: [], mentions: [], skills: [] };
const MODELS = { data: [{ id: 'tool-model', name: 'Tool model', context_length: 1000, capabilities: { tool_calling: true } }] };

const homes: string[] = [];
const backends: ChatBackend[] = [];

afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

function stream(...chunks: unknown[]): Response {
    return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`);
}

const listCall = () =>
    stream({
        choices: [
            { delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_files', arguments: '{"path":"."}' } }] }, finish_reason: 'tool_calls' }
        ]
    });

const reply = (text: string) =>
    stream({
        choices: [{ delta: { content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 5 } }
    });

/* A NanoGPT chat against a fake API that answers each chat request with the next response given. */
async function rig(responses: Array<() => Response>, options: { resume?: string; home?: string; mode?: BackendLaunch['runtimeMode'] } = {}) {
    const home = options.home ?? (await mkdtemp(join(tmpdir(), 'ruimte-nanogpt-chat-')));

    if (options.home === undefined) {
        homes.push(home);
    }

    const bodies: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];

    const service = new NanoGptService(async (url, init) => {
        if (url === `${NANOGPT_URL}/usage`) {
            return new Response('{}');
        }

        if (url.startsWith(`${NANOGPT_URL}/models`)) {
            return new Response(JSON.stringify(MODELS));
        }

        expect(url).toBe(`${NANOGPT_URL}/chat/completions`);
        bodies.push(JSON.parse(String(init?.body)));
        const next = responses.shift();

        return next ? next() : new Response('', { status: 500 });
    });

    await service.load(home);
    await service.configure('nano-key');
    const log = new BackendEventLog();

    const launch: BackendLaunch = {
        command: ['nanogpt'],
        cwd: home,
        env: {},
        selection: { model: 'tool-model', options: {} },
        modelName: 'Tool model',
        runtimeMode: options.mode ?? 'supervised',
        resume: options.resume ?? null,
        generation: 1,
        instructions: 'Be brief.',
        resumeNote: null
    };

    const backend = nanoGptBackend(service)(launch, { onEvent: log.onEvent });
    backends.push(backend);

    return {
        backend,
        service,
        events: log.events,
        bodies,
        get sessionId() {
            return log.sessionId;
        },
        until: (predicate: (event: BackendEvent) => boolean) => log.until(predicate)
    };
}

const isDone = (event: BackendEvent) => event.type === 'turn.done';

describe('a NanoGPT chat', () => {
    test('asks for a tool in the words of NanoGPT', async () => {
        const chat = await rig([listCall, () => reply('Two files.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const approval = await chat.until((event) => event.type === 'approval.requested');
        expect(approval).toMatchObject({ toolName: 'ListFiles', description: 'NanoGPT requests access to this project.' });
        chat.backend.respondApproval((approval as { requestId: string }).requestId, 'deny');
        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
    });

    test('counts every call in the usage log', async () => {
        const chat = await rig([() => reply('Hi.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        await chat.until(isDone);

        expect(await readdir(chat.service.usageDirectory)).toEqual([expect.stringMatching(/^\d{4}-\d{2}\.jsonl$/)]);
        expect(await usageLines(chat.service.usageDirectory)).toEqual([
            expect.objectContaining({
                model: 'tool-model',
                session: chat.sessionId,
                input: 100,
                cacheRead: 20,
                cacheWrite: 0,
                output: 30,
                reasoning: 5
            })
        ]);
    });

    test('what a person set in Settings decides, as the run starts: without continuing it stops at its first cut', async () => {
        const chat = await rig([listCall, listCall, listCall, listCall, listCall, () => reply('Never.')], { mode: 'full-access' });
        await chat.service.setSettings({ autoContinue: false, roundsPerRun: 5 });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        expect(await chat.until(isDone)).toMatchObject({ state: 'error', error: 'NanoGPT reached 5 tool rounds. Send another message to continue.' });
        expect(chat.events.some((event) => event.type === 'note')).toBe(false);
    });

    test('an HTTP error ends the turn with a sentence of its own and never the response', async () => {
        const chat = await rig([() => new Response('{"error":"bad key nano-key"}', { status: 401 })]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        expect(await chat.until(isDone)).toMatchObject({ state: 'error', error: 'NanoGPT rejected the API key.' });
        expect(JSON.stringify(chat.events)).not.toContain('nano-key');
    });

    test('keeps its conversation beside the key, and a resumed chat continues it', async () => {
        const first = await rig([() => reply('First answer.')]);
        await first.backend.start();
        const session = first.sessionId;
        first.backend.sendTurn(turn);
        await first.until(isDone);
        await first.backend.dispose();

        const home = join(first.service.directory, '..');
        const second = await rig([() => reply('Second answer.')], { resume: session, home });
        await second.backend.start();
        second.backend.sendTurn({ ...turn, text: 'And now?' });
        await second.until(isDone);

        expect(second.bodies[0]!.messages.slice(1).map((message) => message.content)).toEqual(['What is in the project?', 'First answer.', 'And now?']);

        const saved = JSON.parse(await readFile(join(first.service.directory, `${session}.json`), 'utf8'));
        expect(saved).toHaveLength(4);
    });

    test('does not start without a key', async () => {
        const chat = await rig([]);
        await chat.service.configure('');

        await expect(chat.backend.start()).rejects.toThrow('Add a NanoGPT API key');
    });
});
