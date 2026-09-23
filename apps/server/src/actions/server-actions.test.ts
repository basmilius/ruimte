import { beforeEach, describe, expect, test } from 'bun:test';
import type { ActionInput } from '@ruimte/actions';
import type { ProjectContent } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import { ProjectError } from '../projects/project-store.ts';
import { serverActionCall } from './context.ts';
import { serverActions } from './server-actions.ts';

const PLACE = { projectId: 'project-1', folder: '/nowhere', canvasId: 'main' };

let content: ProjectContent;
let made: Map<string, string>;
let ended: string[];
let conflict: boolean;

/* Only what these handlers reach; anything else is a handler reaching further than it should. */
const host = (): CanvasHost =>
    ({
        read: async () => content,
        mutate: async (_projectId, apply) => {
            if (conflict) {
                throw new ProjectError('rev-conflict', 'The project changed since it was read');
            }
            const mutation = await apply(content);
            content = mutation.content ?? content;
            return mutation.result;
        },
        recordMade: async (record) => {
            made.set(record.nodeId, record.openedBy);
        },
        madeBy: (nodeId) => made.get(nodeId) ?? null,
        agentsDeleteAnyView: () => false,
        endSession: async (kind, nodeId) => {
            ended.push(`${kind}\t${nodeId}`);
        }
    }) as Partial<CanvasHost> as CanvasHost;

const agent = (dryRun = false) => serverActionCall(host(), PLACE, 'term-1', dryRun);

const note = (input: Partial<ActionInput<'node.create'>> = {}): ActionInput<'node.create'> => ({
    viewId: 'main',
    kind: 'note',
    title: null,
    content: 'hello',
    url: null,
    command: null,
    path: null,
    provider: null,
    at: null,
    ...input
});

const nodesOnMain = (): string[] => {
    const main = content.views.find((view) => view.id === 'main');
    return main?.kind === 'canvas' ? main.nodes.map((node) => node.id) : [];
};

beforeEach(() => {
    made = new Map();
    ended = [];
    conflict = false;
    content = {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'term-1', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                    { id: 'term-2', kind: 'terminal', title: 'other', x: 0, y: 600, w: 560, h: 360 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
});

describe('the daemon actions', () => {
    test('a dry run of node.create answers the node and the line it would make, and makes neither', async () => {
        const result = await serverActions.execute('node.create', note(), agent(true));
        expect(result).toMatchObject({
            status: 'completed',
            dryRun: true,
            output: { viewId: 'main', nodeId: '<new node>', kind: 'note', edge: { edgeId: null, from: 'term-1', to: '<new node>' } }
        });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
        expect(made.size).toBe(0);
    });

    test('an action that makes nothing to preview refuses a dry run instead of running for real', async () => {
        const result = await serverActions.execute('link.create', { viewId: 'main', from: null, to: ['term-2'], label: null, role: null }, agent(true));
        expect(result).toMatchObject({ status: 'failed', error: { code: 'no-dry-run' } });
        const main = content.views.find((view) => view.id === 'main');
        expect(main?.kind === 'canvas' ? main.edges : null).toEqual([]);
    });

    test('an agent starts no CLI and no command through node.create or view.create', async () => {
        expect(await serverActions.execute('node.create', note({ kind: 'terminal', content: null, command: 'rm -rf /' }), agent())).toMatchObject({
            status: 'failed',
            error: { code: 'starts-nothing' }
        });
        expect(await serverActions.execute('node.create', note({ kind: 'chat', content: null, provider: 'claude' }), agent())).toMatchObject({
            status: 'failed',
            error: { code: 'starts-nothing' }
        });
        expect(
            await serverActions.execute('view.create', { kind: 'chat', name: 'Helper', url: null, command: null, path: null, provider: 'codex' }, agent())
        ).toMatchObject({ status: 'failed', error: { code: 'starts-nothing' } });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
    });

    test('node.delete removes only what the caller made, and ends the session it held', async () => {
        const refused = await serverActions.execute('node.delete', { viewId: 'main', nodeIds: ['term-2'] }, agent());
        expect(refused).toMatchObject({ status: 'failed', error: { code: 'not-yours' } });

        made.set('term-2', 'term-1');
        const deleted = await serverActions.execute('node.delete', { viewId: 'main', nodeIds: ['term-2'] }, agent());
        expect(deleted).toMatchObject({ status: 'completed', output: { removed: [{ nodeId: 'term-2', kind: 'terminal', ended: true }] } });
        expect(ended).toEqual(['terminal\tterm-2']);
        expect(nodesOnMain()).toEqual(['term-1']);
    });

    test('a write the store refuses comes back under the store code, with nothing written', async () => {
        conflict = true;
        expect(await serverActions.execute('node.create', note(), agent())).toMatchObject({ status: 'failed', error: { code: 'rev-conflict' } });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
    });

    test('only an agent reaches the actions an agent alone may run', async () => {
        const call = { ...agent(), actor: { kind: 'voice' as const, id: 'voice' } };
        expect(await serverActions.execute('node.list', { viewId: 'main' }, call)).toMatchObject({ status: 'failed', error: { code: 'forbidden-action' } });
    });
});
