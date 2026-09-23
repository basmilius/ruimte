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

    test('answers work that goes on after it with its status and an operation id, and a dry run as completed', async () => {
        const registry = new ActionRegistry<Context>(
            {
                'view.focus': ({ viewId }, { context }) => ({
                    output: { viewId, view: context.name, kind: 'canvas', changed: true },
                    operation: { id: `focus:${viewId}`, status: 'running' }
                })
            },
            { previews: ['view.focus'] }
        );

        expect(await registry.execute('view.focus', { viewId: 'board' }, call())).toEqual({
            status: 'running',
            action: 'view.focus',
            output: { viewId: 'board', view: 'Board', kind: 'canvas', changed: true },
            operationId: 'focus:board'
        });
        expect(await registry.execute('view.focus', { viewId: 'board' }, { ...call(), dryRun: true })).toMatchObject({ status: 'completed', dryRun: true });
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

    test('a dry run reaches only an action listed under previews, and leaves nothing to undo', async () => {
        const seen: boolean[] = [];
        const registry = new ActionRegistry<Context>(
            {
                'view.rename': ({ viewId, name }, action) => {
                    seen.push(action.dryRun === true);
                    return { output: { viewId, kind: 'canvas', previousName: 'Board', name, changed: true }, undo: () => undefined };
                },
                'view.focus': ({ viewId }) => ({ output: { viewId, view: 'Board', kind: 'canvas', changed: true } })
            },
            { previews: ['view.rename'] }
        );

        const previewed = await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, { ...call(), dryRun: true });
        expect(previewed).toMatchObject({ status: 'completed', dryRun: true });
        expect(previewed).not.toHaveProperty('undoToken');
        expect(seen).toEqual([true]);
        expect(await registry.execute('view.focus', { viewId: 'board' }, { ...call(), dryRun: true })).toMatchObject({
            status: 'failed',
            error: { code: 'no-dry-run' }
        });
    });

    test('a field or a kind kept for agents is refused from anyone else', async () => {
        const made: string[] = [];
        const registry = new ActionRegistry<Context>({
            'node.create': (input) => {
                made.push(input.kind);
                return { output: { viewId: input.viewId, view: 'Board', nodeId: 'note-1', node: 'Note', kind: input.kind } };
            }
        });
        const input = { viewId: 'board', kind: 'note', title: null, content: null, url: null, command: null, path: null, provider: null, at: null } as const;

        expect(await registry.execute('node.create', { ...input, cwd: 'src' }, call('voice'))).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        expect(await registry.execute('node.create', { ...input, kind: 'drawing', source: 'sketch' }, call('voice'))).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        expect(await registry.execute('node.create', { ...input, cwd: null }, call('voice'))).toMatchObject({ status: 'completed' });
        expect(
            await registry.execute(
                'node.create',
                { ...input, kind: 'drawing', source: 'sketch' },
                { actor: { kind: 'agent', id: 'term-1' }, context: { name: 'Board' } }
            )
        ).toMatchObject({ status: 'completed' });
        expect(made).toEqual(['note', 'drawing']);
    });

    test('an executor names the refusals its own errors carry', async () => {
        class Coded extends Error {
            readonly code: string;

            constructor(code: string, message: string) {
                super(message);
                this.code = code;
            }
        }
        const registry = new ActionRegistry<Context>(
            {
                'view.rename': () => {
                    throw new Coded('rev-conflict', 'The project moved on.');
                }
            },
            { refusalOf: (error) => (error instanceof Coded ? { code: error.code, message: error.message, details: ['line'] } : null) }
        );

        expect(await registry.execute('view.rename', { viewId: 'board', name: 'Plan' }, call())).toMatchObject({
            status: 'failed',
            error: { code: 'rev-conflict', message: 'The project moved on.', details: ['line'] }
        });
    });
});
