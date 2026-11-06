import { describe, expect, test } from 'bun:test';
import type { EditorAssistGenerateResult, ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import type { EditorAssistRequest } from '../editor-assist/model.ts';
import type { ClientConnection } from '../wire.ts';
import { editorAssistArea } from './editor-assist.ts';

function harness() {
    const pending: Array<{ request: EditorAssistRequest; signal?: AbortSignal; answer(text: string): void }> = [];
    const dispatcher = new Dispatcher();
    editorAssistArea({
        model: {
            status: async (agent) => ({ available: true, model: agent?.model ?? 'automatic' }),
            generate: (request, signal) =>
                new Promise<EditorAssistGenerateResult>((resolve) => {
                    pending.push({ request, signal, answer: (text) => resolve({ state: 'done', text }) });
                    signal?.addEventListener('abort', () => resolve({ state: 'aborted', text: '' }), { once: true });
                }),
            dispose: async () => undefined
        }
    }).handlers?.(dispatcher);
    const frames: ServerFrame[] = [];
    const client: ClientConnection & { closed: boolean } = { id: 'client-1', closed: false, send: (frame) => frames.push(frame) };
    const request = (id: string, type: string, payload: unknown, who: ClientConnection = client) =>
        dispatcher.handle(who, JSON.stringify({ id, type, payload }));
    return { pending, frames, client, request };
}

describe('editor model handlers', () => {
    test('streams only to the asking client, passes the model choice and answers the whole text', async () => {
        const rig = harness();
        const agent = { provider: 'codex', model: 'gpt-6-luna' } as const;
        const done = rig.request('r', 'editor.generate', { id: 'g', purpose: 'explain', prompt: 'code', stream: true, agent });
        expect(rig.pending[0]?.request.agent).toEqual(agent);
        rig.pending[0]!.request.onText?.('Adds');
        rig.pending[0]!.answer('Adds two.');
        await done;
        expect(rig.frames).toContainEqual({ type: 'event', event: 'editor.text', payload: { id: 'g', text: 'Adds' } });
        expect(rig.frames.at(-1)).toEqual({ id: 'r', ok: true, result: { state: 'done', text: 'Adds two.' } });
    });

    test('sends no stream events without stream', async () => {
        const rig = harness();
        const done = rig.request('r', 'editor.generate', { id: 'g', purpose: 'names', prompt: 'code' });
        rig.pending[0]!.request.onText?.('a');
        rig.pending[0]!.answer('a\nb');
        await done;
        expect(rig.frames.filter((frame) => 'type' in frame && frame.type === 'event')).toEqual([]);
    });

    test('cancels only the generation of that client and id, even when another client chose the same id', async () => {
        const rig = harness();
        const other: ClientConnection = { id: 'other', send: () => undefined };
        const first = rig.request('r1', 'editor.generate', { id: 'g', purpose: 'ghost', prompt: 'code' });
        const second = rig.request('r2', 'editor.generate', { id: 'g', purpose: 'ghost', prompt: 'code' }, other);
        await rig.request('cancel', 'editor.cancel', { id: 'g' });
        expect(rig.pending[0]?.signal?.aborted).toBe(true);
        expect(rig.pending[1]?.signal?.aborted).toBe(false);
        rig.pending[1]!.answer('code');
        await Promise.all([first, second]);
        expect(rig.frames).toContainEqual({ id: 'r1', ok: true, result: { state: 'aborted', text: '' } });
    });

    test('a client that went away has its generation cancelled at the next text', async () => {
        const rig = harness();
        const done = rig.request('r', 'editor.generate', { id: 'g', purpose: 'explain', prompt: 'code', stream: true });
        rig.client.closed = true;
        rig.pending[0]!.request.onText?.('x');
        await done;
        expect(rig.pending[0]?.signal?.aborted).toBe(true);
    });

    test('availability uses the selected model and rejects a provider outside the supported four', async () => {
        const rig = harness();
        await rig.request('r', 'editor.status', { agent: { provider: 'grok', model: 'grok-fast' } });
        expect(rig.frames.at(-1)).toEqual({ id: 'r', ok: true, result: { available: true, model: 'grok-fast' } });
        await rig.request('bad', 'editor.status', { agent: { provider: 'unsupported', model: 'local' } });
        expect(rig.frames.at(-1)).toMatchObject({ id: 'bad', ok: false });
    });
});
