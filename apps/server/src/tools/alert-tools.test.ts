import { describe, expect, test } from 'bun:test';
import { canvasFixture, alerts, invoke } from './canvas-test-fixture.ts';

canvasFixture();

describe('alert', () => {
    test('notifies from the authenticated caller, including a standalone chat', async () => {
        expect(await invoke('alert', { text: 'The build is ready.' })).toMatchObject({ status: 200, lines: ['alerted\tterm-1'] });
        expect(await invoke('alert', { text: 'The review is ready.' }, 'chat')).toMatchObject({ status: 200, lines: ['alerted\tchat-1'] });
        expect(alerts).toEqual([
            { nodeId: 'term-1', text: 'The build is ready.' },
            { nodeId: 'chat-1', text: 'The review is ready.' }
        ]);
    });

    test('rejects empty, oversized messages and another session as a destination', async () => {
        for (const input of [{}, { text: '   ' }, { text: 'x'.repeat(501) }, { id: 'term-2', text: 'Done' }]) {
            expect((await invoke('alert', input)).status).toBe(422);
        }
        expect(alerts).toEqual([]);
    });
});
