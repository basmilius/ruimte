import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasFixture, type CanvasFixture } from './canvas-test-fixture.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('alert', () => {
    test('notifies from the authenticated caller, including a standalone chat', async () => {
        expect(await fx.invoke('alert', { text: 'The build is ready.' })).toMatchObject({ status: 200, lines: ['alerted\tterm-1'] });
        expect(await fx.invoke('alert', { text: 'The review is ready.' }, 'chat')).toMatchObject({ status: 200, lines: ['alerted\tchat-1'] });
        expect(fx.alerts).toEqual([
            { nodeId: 'term-1', text: 'The build is ready.' },
            { nodeId: 'chat-1', text: 'The review is ready.' }
        ]);
    });

    test('rejects empty, oversized messages and another session as a destination', async () => {
        for (const input of [{}, { text: '   ' }, { text: 'x'.repeat(501) }, { id: 'term-2', text: 'Done' }]) {
            expect((await fx.invoke('alert', input)).status).toBe(422);
        }
        expect(fx.alerts).toEqual([]);
    });
});
