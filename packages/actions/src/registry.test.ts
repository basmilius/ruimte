import { describe, expect, test } from 'bun:test';
import { ActionRefusal, ActionRegistry, type ActionCall } from './index.ts';

interface Context {
    name: string;
}

const call = (kind: 'person' | 'voice' = 'person'): ActionCall<Context> => ({ actor: { kind, id: `${kind}-1` }, context: { name: 'Board' } });

describe('ActionRegistry', () => {
    test('catalog only exposes handlers installed in this adapter', () => {
        const registry = new ActionRegistry<Context>({
            'view.focus': ({ viewId }, { context }) => ({ output: { viewId, view: context.name, kind: 'canvas', changed: true } })
        });

        expect(registry.catalog(call()).map((entry) => entry.name)).toEqual(['view.focus']);
        expect(registry.catalog(call())[0]?.input).toMatchObject({ type: 'object' });
    });

    test('validates input and normalizes domain refusals', async () => {
        const registry = new ActionRegistry<Context>({
            'view.rename': () => {
                throw new ActionRefusal('unknown-view', 'No such view.');
            }
        });

        expect(await registry.execute('view.rename', { viewId: '', name: '' }, call())).toMatchObject({ status: 'failed', error: { code: 'invalid-input' } });
        expect(await registry.execute('view.rename', { viewId: 'missing', name: 'Plan' }, call())).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-view', message: 'No such view.' }
        });
    });

    test('binds confirmation and undo to the actor that requested them', async () => {
        let name = 'Board';
        const registry = new ActionRegistry<Context>({
            'view.rename': ({ viewId, name: next }, action) => {
                if (!action.confirmed) {
                    return { confirmation: { title: 'Rename?', consequences: [`${name} becomes ${next}`] } };
                }
                const previous = name;
                name = next;
                return {
                    output: { viewId, kind: 'canvas', previousName: previous, name, changed: true },
                    undo: () => {
                        name = previous;
                    }
                };
            }
        });

        const waiting = await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, call('voice'));
        expect(waiting.status).toBe('needs_confirmation');
        if (waiting.status !== 'needs_confirmation') {
            return;
        }
        expect(await registry.confirm(waiting.confirmationToken, true, call())).toMatchObject({ status: 'failed', error: { code: 'unknown-confirmation' } });
        const completed = await registry.confirm(waiting.confirmationToken, true, call('voice'));
        expect(completed).toMatchObject({ status: 'completed', output: { name: 'Plan' } });
        expect(name).toBe('Plan');
        if (completed.status !== 'completed' || !completed.undoToken) {
            return;
        }
        expect(await registry.undo(completed.undoToken, call())).toMatchObject({ status: 'failed', error: { code: 'unknown-undo' } });
        expect(await registry.undo(completed.undoToken, call('voice'))).toMatchObject({ status: 'completed' });
        expect(name).toBe('Board');
    });
});
