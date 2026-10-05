import { describe, expect, test } from 'bun:test';
import { FakeLanguageTransport } from '@/language/fake-daemon';
import { TransportError } from '@/transport/transport';
import { FakeOnDeviceModel } from './fake-model';
import { OnDeviceClient } from './ondevice-client';

async function settle(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
    }
}

describe('OnDeviceClient', () => {
    test('asks the machine once and believes the answer for a while', async () => {
        const transport = new FakeLanguageTransport();
        new FakeOnDeviceModel(transport, { available: false, reason: 'Apple Intelligence is turned off.' });
        let now = 0;
        const client = new OnDeviceClient(transport, () => now);
        expect(client.lastKnown).toBeNull();
        const [first, second] = await Promise.all([client.availability(), client.availability()]);
        expect(first).toEqual({ available: false, reason: 'Apple Intelligence is turned off.' });
        expect(second).toBe(first);
        now = 29_999;
        await client.availability();
        expect(transport.callsOf('ondevice.status')).toHaveLength(1);
        now = 30_000;
        await client.availability();
        expect(transport.callsOf('ondevice.status')).toHaveLength(2);
        await client.refresh();
        expect(transport.callsOf('ondevice.status')).toHaveLength(3);
    });

    test('a machine that does not know the request is a machine without the model', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('ondevice.status', () => {
            throw new TransportError('unknown-request', 'Unknown request type: ondevice.status');
        });
        const status = await new OnDeviceClient(transport).availability();
        expect(status.available).toBe(false);
        expect(status.reason).toContain('does not have on-device help');
    });

    test('streams the text of a generation to its listener and answers the whole text', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeOnDeviceModel(transport);
        const client = new OnDeviceClient(transport);
        const seen: string[] = [];
        const running = client.generate({ purpose: 'explain', prompt: 'code', onText: (text) => seen.push(text) });
        await settle();
        expect(model.last).toMatchObject({ purpose: 'explain', prompt: 'code', stream: true });
        model.stream('It adds');
        transport.emit('ondevice.text', { id: 'someone-else', text: 'not mine' });
        model.answer('It adds two numbers.');
        expect(await running).toEqual({ state: 'done', text: 'It adds two numbers.' });
        expect(seen).toEqual(['It adds']);
    });

    test('asks for no stream without a listener', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeOnDeviceModel(transport);
        const running = new OnDeviceClient(transport).generate({ purpose: 'names', prompt: 'x' });
        await settle();
        expect(model.last.stream).toBe(false);
        model.answer('a\nb');
        expect((await running).text).toBe('a\nb');
    });

    test('an abort sends a cancel to the machine and resolves aborted', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeOnDeviceModel(transport);
        const controller = new AbortController();
        const running = new OnDeviceClient(transport).generate({ purpose: 'ghost', prompt: 'x' }, controller.signal);
        await settle();
        controller.abort();
        expect(await running).toEqual({ state: 'aborted', text: '' });
        expect(model.cancels).toEqual([model.last.id]);
    });

    test('a signal that already aborted asks for nothing', async () => {
        const transport = new FakeLanguageTransport();
        const model = new FakeOnDeviceModel(transport);
        const controller = new AbortController();
        controller.abort();
        expect(await new OnDeviceClient(transport).generate({ purpose: 'ghost', prompt: 'x' }, controller.signal)).toEqual({ state: 'aborted', text: '' });
        expect(model.requests).toEqual([]);
    });

    test('a refusal of the machine reaches the caller with its code', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('ondevice.generate', () => {
            throw new TransportError('failed', 'The on-device model could not answer.');
        });
        await expect(new OnDeviceClient(transport).generate({ purpose: 'explain', prompt: 'x' })).rejects.toMatchObject({ code: 'failed' });
    });
});
