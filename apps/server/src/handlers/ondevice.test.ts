import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { inProcess, type FakeIo } from '@adecore/agents/chat/fake-cli';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { OnDeviceModel } from '../ondevice/model.ts';
import { registerOnDeviceHandlers } from './ondevice.ts';

function rig() {
    let io!: FakeIo;
    const lines: Array<Record<string, unknown>> = [];
    const fake = inProcess((output) => {
        io = output;
        output.out({ type: 'availability', available: true });
        return { onLine: (line) => lines.push(JSON.parse(line)) };
    });
    const model = new OnDeviceModel({
        command: () => 'fake',
        supported: () => true,
        spawn: fake.spawn,
        env: {},
        probe: async () => ({ result: { type: 'availability', available: true }, exited: 0 })
    });
    const dispatcher = new Dispatcher();
    registerOnDeviceHandlers(dispatcher, model);
    const frames: ServerFrame[] = [];
    const client: ClientConnection & { closed: boolean } = { id: 'client-1', closed: false, send: (frame) => frames.push(frame) };
    const request = (id: string, type: string, payload: unknown) => dispatcher.handle(client, JSON.stringify({ id, type, payload }));
    const idOf = async (): Promise<string> => {
        await new Promise((resolve) => setImmediate(resolve));
        return lines.find((line) => line.type === 'generate')!.id as string;
    };
    return { model, frames, client, request, idOf, out: (frame: unknown) => io.out(frame), lines };
}

describe('on-device handlers', () => {
    test('streams the text to the asking client only when it asked, and answers the whole text', async () => {
        const test = rig();
        const done = test.request('r1', 'ondevice.generate', { id: 'explain-1', purpose: 'explain', prompt: 'code', stream: true });
        const id = await test.idOf();
        test.out({ type: 'text.snapshot', id, text: 'Adds' });
        test.out({ type: 'done', id, state: 'done', text: 'Adds two.' });
        await done;
        expect(test.frames).toContainEqual({ type: 'event', event: 'ondevice.text', payload: { id: 'explain-1', text: 'Adds' } });
        expect(test.frames.at(-1)).toEqual({ id: 'r1', ok: true, result: { state: 'done', text: 'Adds two.' } });
        await test.model.dispose();
    });

    test('sends no events without stream', async () => {
        const test = rig();
        const done = test.request('r1', 'ondevice.generate', { id: 'names-1', purpose: 'names', prompt: 'code' });
        const id = await test.idOf();
        test.out({ type: 'text.snapshot', id, text: 'a' });
        test.out({ type: 'done', id, state: 'done', text: 'a\nb' });
        await done;
        expect(test.frames.filter((frame) => 'type' in frame && frame.type === 'event')).toEqual([]);
        await test.model.dispose();
    });

    test('ondevice.cancel ends the generation of that client and id', async () => {
        const test = rig();
        const done = test.request('r1', 'ondevice.generate', { id: 'g', purpose: 'ghost', prompt: 'code' });
        const id = await test.idOf();
        await test.request('r2', 'ondevice.cancel', { id: 'g' });
        expect(test.lines.some((line) => line.type === 'cancel' && line.id === id)).toBe(true);
        test.out({ type: 'done', id, state: 'aborted' });
        await done;
        expect(test.frames.find((frame) => 'id' in frame && frame.id === 'r1')).toEqual({ id: 'r1', ok: true, result: { state: 'aborted', text: '' } });
        await test.model.dispose();
    });

    test('a client that went away has its generation cancelled at the next text', async () => {
        const test = rig();
        const done = test.request('r1', 'ondevice.generate', { id: 'g', purpose: 'explain', prompt: 'code', stream: true });
        const id = await test.idOf();
        test.client.closed = true;
        test.out({ type: 'text.snapshot', id, text: 'x' });
        await new Promise((resolve) => setImmediate(resolve));
        expect(test.lines.some((line) => line.type === 'cancel' && line.id === id)).toBe(true);
        test.out({ type: 'done', id, state: 'aborted' });
        await done;
        await test.model.dispose();
    });

    test('an unavailable model answers with its reason', async () => {
        const dispatcher = new Dispatcher();
        registerOnDeviceHandlers(dispatcher, new OnDeviceModel({ supported: () => false }));
        const frames: ServerFrame[] = [];
        await dispatcher.handle(
            { id: 'c', send: (frame) => frames.push(frame) },
            JSON.stringify({ id: 'r', type: 'ondevice.generate', payload: { id: 'g', purpose: 'ghost', prompt: 'x' } })
        );
        expect(frames[0]).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        await dispatcher.handle({ id: 'c', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 's', type: 'ondevice.status', payload: {} }));
        expect(frames[1]).toMatchObject({ ok: true, result: { available: false } });
    });
});
