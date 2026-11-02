import { describe, expect, test } from 'bun:test';
import { outputOf, runMachineAction, type ExecuteAction } from './machine-actions.ts';

describe('runMachineAction', () => {
    test('hands the action ids for refs and answers the shape of the extension API', async () => {
        const asked: unknown[] = [];
        const execute = (async (action: string, input: unknown) => {
            asked.push({ action, input });

            return { nodeId: 'browser-1', open: true, page: null, error: null, path: '/tmp/shot.png' };
        }) as ExecuteAction;

        expect(await runMachineAction('browser.screenshot', { node: { id: 'browser-1' } }, execute)).toEqual({
            node: { id: 'browser-1' },
            open: true,
            page: null,
            error: null,
            path: '/tmp/shot.png'
        });
        expect(asked).toEqual([{ action: 'browser.screenshot', input: { nodeId: 'browser-1' } }]);
    });

    test('refuses a name outside the list, and an input of the wrong shape as an argument error', async () => {
        const execute = (async () => ({})) as ExecuteAction;

        await expect(runMachineAction('session.write', {}, execute)).rejects.toMatchObject({ code: 'not-found' });
        await expect(runMachineAction('launch.start', { name: 'web' }, execute)).rejects.toMatchObject({ code: 'invalid-input' });
    });
});

describe('outputOf', () => {
    test('a failed action answers the code an extension reads, and one that waits on a person is refused', () => {
        expect(() => outputOf({ status: 'failed', action: 'launch.start', error: { code: 'no-launch', message: 'No launch web' } })).toThrow(
            expect.objectContaining({ code: 'not-found', message: 'No launch web' })
        );
        expect(() => outputOf({ status: 'needs_confirmation', action: 'launch.start', confirmationToken: 'token', confirmation: {} as never })).toThrow(
            expect.objectContaining({ code: 'refused' })
        );
    });
});
