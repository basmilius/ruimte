import { describe, expect, test } from 'bun:test';
import { FakeLanguageTransport } from '@/language/fake-daemon';
import { useSettings } from '@/state/settings';
import { TransportError } from '@/transport/transport';
import { EditorAssistClient } from './client';
import { FakeEditorAssistModel } from './fake-model';

async function settle(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
    }
}

describe('EditorAssistClient', () => {
    test('refreshes availability and sends the new choice when the configured model changes', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeEditorAssistModel(transport);
        const client = new EditorAssistClient(transport);
        const previous = useSettings.getState().aiAssistAgent;
        try {
            await client.availability();
            const agent = { provider: 'codex', model: 'gpt-6-luna' } as const;
            useSettings.setState({ aiAssistAgent: agent });
            await client.availability();
            expect(transport.callsOf('editor.status')).toHaveLength(2);
            expect(transport.callsOf('editor.status').at(-1)?.payload).toEqual({ agent });
            const answer = client.generate({ purpose: 'names', prompt: 'code' });
            expect(model.last.agent).toEqual(agent);
            model.answer('count');
            await answer;
        } finally {
            useSettings.setState({ aiAssistAgent: previous });
        }
    });

    test('asks nothing of a machine that does not support editor models', async () => {
        const transport = new FakeLanguageTransport();
        const client = new EditorAssistClient(transport);
        expect(await client.availability()).toEqual({ available: false });
        await expect(client.generate({ purpose: 'names', prompt: 'code' })).rejects.toMatchObject({ code: 'unavailable' });
        expect(transport.calls).toEqual([]);
    });

    test('asks the machine once and believes the answer for a while', async () => {
        const transport = new FakeLanguageTransport();
        new FakeEditorAssistModel(transport, { available: false, reason: 'The selected editor model is unavailable.' });
        let now = 0;
        const client = new EditorAssistClient(transport, () => now);
        expect(client.lastKnown).toBeNull();
        const [first, second] = await Promise.all([client.availability(), client.availability()]);
        expect(first).toEqual({ available: false, reason: 'The selected editor model is unavailable.' });
        expect(second).toBe(first);
        now = 29_999;
        await client.availability();
        expect(transport.callsOf('editor.status')).toHaveLength(1);
        now = 30_000;
        await client.availability();
        expect(transport.callsOf('editor.status')).toHaveLength(2);
        await client.refresh();
        expect(transport.callsOf('editor.status')).toHaveLength(3);
    });

    test('a status request that fails is a machine without the model, with no reason of its own', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('editor.status', () => {
            throw new TransportError('disconnected', 'The connection closed');
        });
        expect(await new EditorAssistClient(transport).availability()).toEqual({ available: false });
    });

    test('streams the text of a generation to its listener and answers the whole text', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeEditorAssistModel(transport);
        const client = new EditorAssistClient(transport);
        const seen: string[] = [];
        const running = client.generate({ purpose: 'explain', prompt: 'code', onText: (text) => seen.push(text) });
        await settle();
        expect(model.last).toMatchObject({ purpose: 'explain', prompt: 'code', stream: true });
        model.stream('It adds');
        transport.emit('editor.text', { id: 'someone-else', text: 'not mine' });
        model.answer('It adds two numbers.');
        expect(await running).toEqual({ state: 'done', text: 'It adds two numbers.' });
        expect(seen).toEqual(['It adds']);
    });

    test('asks for no stream without a listener', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeEditorAssistModel(transport);
        const running = new EditorAssistClient(transport).generate({ purpose: 'names', prompt: 'x' });
        await settle();
        expect(model.last.stream).toBe(false);
        model.answer('a\nb');
        expect((await running).text).toBe('a\nb');
    });

    test('an abort sends a cancel to the machine and resolves aborted', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeEditorAssistModel(transport);
        const controller = new AbortController();
        const running = new EditorAssistClient(transport).generate({ purpose: 'ghost', prompt: 'x' }, controller.signal);
        await settle();
        controller.abort();
        expect(await running).toEqual({ state: 'aborted', text: '' });
        expect(model.cancels).toEqual([model.last.id]);
    });

    test('a signal that already aborted asks for nothing', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeEditorAssistModel(transport);
        const controller = new AbortController();
        controller.abort();
        expect(await new EditorAssistClient(transport).generate({ purpose: 'ghost', prompt: 'x' }, controller.signal)).toEqual({ state: 'aborted', text: '' });
        expect(model.requests).toEqual([]);
    });

    test('a refusal of the machine reaches the caller with its code', async () => {
        const transport = new FakeLanguageTransport();
        transport.connection = { ...transport.connection, features: ['editor.generate'] };
        transport.answers.set('editor.generate', () => {
            throw new TransportError('failed', 'The editor model could not answer.');
        });
        await expect(new EditorAssistClient(transport).generate({ purpose: 'explain', prompt: 'x' })).rejects.toMatchObject({ code: 'failed' });
    });
});
