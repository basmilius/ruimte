import { describe, expect, test } from 'bun:test';
import type { AppleFoundationRequest } from '@ruimte/contracts';
import { inProcess, type FakeIo } from '@adecore/agents/chat/fake-cli';
import { OnDeviceModel, describeReason } from './model.ts';

type Frame = Record<string, unknown>;

/* A helper that answers every generate request through `answer`, which gets the request and a way to write frames. */
function harness(options: { available?: boolean; answer?: (request: Extract<AppleFoundationRequest, { type: 'generate' }>, out: FakeIo['out']) => void } = {}) {
    const requests: AppleFoundationRequest[] = [];
    const argvs: string[][] = [];
    let io!: FakeIo;
    const fake = inProcess((output) => {
        io = output;
        argvs.push(output.argv);
        output.out({
            type: 'availability',
            available: options.available ?? true,
            ...(options.available === false ? { reason: 'appleIntelligenceNotEnabled' } : {})
        });
        return {
            onLine: (line) => {
                const request = JSON.parse(line) as AppleFoundationRequest;
                requests.push(request);
                if (request.type === 'generate') {
                    options.answer?.(request, output.out);
                }
            }
        };
    });
    const model = new OnDeviceModel({
        command: () => 'fake-helper',
        supported: () => true,
        spawn: fake.spawn,
        probe: async () => ({ result: { type: 'availability', available: options.available ?? true }, exited: 0 }),
        env: {}
    });
    return { model, requests, argvs, fake, out: (frame: Frame) => io.out(frame) };
}

describe('on-device model', () => {
    test('runs a generation in a helper started with --oneshot and answers the whole text', async () => {
        const rig = harness({
            answer: (request, out) => {
                out({ type: 'text.snapshot', id: request.id, text: 'It adds' });
                out({ type: 'done', id: request.id, state: 'done', text: 'It adds two numbers.' });
            }
        });
        const seen: string[] = [];
        const result = await rig.model.generate({ purpose: 'explain', prompt: 'function add(a, b) { return a + b; }', onText: (text) => seen.push(text) });
        expect(result).toEqual({ state: 'done', text: 'It adds two numbers.' });
        expect(seen).toEqual(['It adds']);
        expect(rig.argvs[0]).toEqual(['--oneshot']);
        const request = rig.requests[0]!;
        expect(request).toMatchObject({ type: 'generate', prompt: 'function add(a, b) { return a + b; }' });
        expect(request.type === 'generate' && request.instructions).toContain('explain source code');
        await rig.model.dispose();
    });

    test('keeps one helper for every request and gives each purpose its own instructions', async () => {
        const rig = harness({ answer: (request, out) => out({ type: 'done', id: request.id, state: 'done', text: 'x' }) });
        await rig.model.generate({ purpose: 'names', prompt: 'a' });
        await rig.model.generate({ purpose: 'ghost', prompt: 'b' });
        expect(rig.fake.started).toHaveLength(1);
        const [first, second] = rig.requests.filter((request) => request.type === 'generate');
        expect(first!.type === 'generate' && first!.maxTokens).toBe(80);
        expect(second!.type === 'generate' && second!.instructions).toContain('<cursor>');
        await rig.model.dispose();
    });

    test('a cancel reaches the helper and answers aborted', async () => {
        const rig = harness();
        const controller = new AbortController();
        const running = rig.model.generate({ purpose: 'explain', prompt: 'code' }, controller.signal);
        await Promise.resolve();
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
        const cancel = rig.requests.find((request) => request.type === 'cancel');
        expect(cancel).toBeDefined();
        rig.out({ type: 'done', id: (cancel as { id: string }).id, state: 'aborted' });
        expect(await running).toEqual({ state: 'aborted', text: '' });
        await rig.model.dispose();
    });

    test('a signal that already aborted starts nothing', async () => {
        const rig = harness();
        const controller = new AbortController();
        controller.abort();
        expect(await rig.model.generate({ purpose: 'ghost', prompt: 'x' }, controller.signal)).toEqual({ state: 'aborted', text: '' });
        expect(rig.fake.started).toHaveLength(0);
    });

    test('a failure of the model rejects with the failed code', async () => {
        const rig = harness({ answer: (request, out) => out({ type: 'done', id: request.id, state: 'error', text: 'guardrail' }) });
        await expect(rig.model.generate({ purpose: 'explain', prompt: 'x' })).rejects.toMatchObject({ code: 'failed', message: 'guardrail' });
        await rig.model.dispose();
    });

    test('a helper that says the model is unavailable rejects with the reason, and a later request tries again', async () => {
        const rig = harness({ available: false });
        await expect(rig.model.generate({ purpose: 'explain', prompt: 'x' })).rejects.toMatchObject({
            code: 'unavailable',
            message: 'Apple Intelligence is turned off. Turn it on in System Settings.'
        });
        await expect(rig.model.generate({ purpose: 'explain', prompt: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
        expect(rig.fake.started).toHaveLength(2);
    });

    test('a helper from before one-shot mode is refused instead of waited on', async () => {
        const rig = harness();
        const running = rig.model.generate({ purpose: 'explain', prompt: 'x' });
        await new Promise((resolve) => setImmediate(resolve));
        rig.out({ type: 'session', id: '00000000-0000-4000-8000-000000000000', restored: false });
        await expect(running).rejects.toMatchObject({ code: 'unavailable', message: 'The on-device helper is older than this daemon.' });
    });

    test('a helper that crashes fails what waits and is started again by the next request', async () => {
        const rig = harness();
        const running = rig.model.generate({ purpose: 'explain', prompt: 'x' });
        await new Promise((resolve) => setImmediate(resolve));
        rig.fake.started[0]!.crash(1);
        await expect(running).rejects.toMatchObject({ code: 'failed' });
        const again = harness({ answer: (request, out) => out({ type: 'done', id: request.id, state: 'done', text: 'ok' }) });
        expect(await again.model.generate({ purpose: 'names', prompt: 'x' })).toMatchObject({ text: 'ok' });
        await again.model.dispose();
    });

    test('refuses more requests than it can hold', async () => {
        const rig = harness();
        const held = Array.from({ length: 4 }, () => rig.model.generate({ purpose: 'ghost', prompt: 'x' }).catch(() => undefined));
        await new Promise((resolve) => setImmediate(resolve));
        await expect(rig.model.generate({ purpose: 'ghost', prompt: 'x' })).rejects.toMatchObject({ code: 'busy' });
        await rig.model.dispose();
        await Promise.all(held);
    });

    test('status says whether the model is there and why not', async () => {
        const unsupported = new OnDeviceModel({ supported: () => false });
        expect(await unsupported.status()).toEqual({ available: false, reason: 'On-device models need a Mac with Apple silicon.' });
        await expect(unsupported.generate({ purpose: 'explain', prompt: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
        expect(await harness().model.status()).toEqual({ available: true });
        expect(await harness({ available: false }).model.status()).toMatchObject({ available: false });
        const missing = new OnDeviceModel({
            supported: () => true,
            probe: async () => {
                throw new Error('no such file');
            }
        });
        expect(await missing.status()).toMatchObject({ available: false, reason: expect.stringContaining('missing') });
    });

    test('names what a person can do about each unavailable reason', () => {
        expect(describeReason('deviceNotEligible')).toContain('does not support');
        expect(describeReason('modelNotReady')).toContain('downloading');
        expect(describeReason(undefined)).toBe('The on-device model is unavailable.');
    });
});
