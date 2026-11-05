import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActionResult } from '@ruimte/actions';
import { serverActionCall } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions.ts';
import { type CanvasHost } from '../canvas/host.ts';
import { projectReach, reachedPlace } from '../canvas/reach.ts';
import { canvasFixture, root, store, projectId, pointAt, host, invoke } from './canvas-test-fixture.ts';

canvasFixture();

describe('reading what a # points at in another form', () => {
    async function read(caller: string, input: { sourceId: string; form?: 'elements' | 'image' | null }, hostValue: CanvasHost = host()) {
        return serverActions.execute(
            'context.read',
            { tail: null, subagent: null, viewId: null, ...input },
            serverActionCall(hostValue, store.locate(caller), caller)
        );
    }

    function textOf(result: ActionResult<'context.read'>): string {
        return result.status === 'completed' ? result.output.text : `${result.status} ${result.status === 'failed' ? result.error.code : ''}`;
    }

    test('a canvas reads as an overview of its nodes, texts and lines', async () => {
        await pointAt('chat-1', ['main']);
        expect(textOf(await read('chat-1', { sourceId: 'main' }))).toBe(
            [
                '# Canvas "Canvas"',
                '',
                '## Nodes',
                '',
                '- term-1 terminal "shell" at 0,0, 560x360',
                '- note-1 note "Plan\\twith a tab" at 0,601, 320x240',
                '',
                '## Texts',
                '',
                '- text-1 "hi" at 0,0',
                '',
                '## Lines',
                '',
                'None.'
            ].join('\n')
        );
    });

    test('a drawing reads as its revision and its elements', async () => {
        await pointAt('chat-1', ['sketch-1']);
        await invoke(
            'view_drawing',
            { view_id: 'sketch-1', revision: '0', edit: '{"add":[{"kind":"note","x":1,"y":2,"w":3,"h":4,"text":"Hi","fillColor":"yellow"}]}' },
            'chat'
        );
        const json = JSON.parse(textOf(await read('chat-1', { sourceId: 'sketch-1', form: 'elements' }))) as { revision: number; elements: unknown[] };
        expect(json.revision).toBe(1);
        expect(json.elements).toEqual([
            { id: expect.stringMatching(/^el-/), kind: 'note', box: { x: 1, y: 2, w: 3, h: 4 }, stroke: 'ink', fillColor: 'yellow', text: 'Hi' }
        ]);
        await pointAt('chat-1', ['sketch-1', 'main']);
        expect(textOf(await read('chat-1', { sourceId: 'main', form: 'elements' }))).toBe('failed bad-arguments');
    });

    test('a database view names its table and the command that reads it, or says its connection is not here', async () => {
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: [
                    ...current.views,
                    {
                        kind: 'database',
                        id: 'orders',
                        name: 'Orders',
                        connectionId: 'shop-1',
                        schema: 'shop',
                        table: 'orders',
                        mode: 'data',
                        where: 'total > 10'
                    },
                    { kind: 'database', id: 'far', name: 'Far', connectionId: 'elsewhere-1', schema: '', table: 't', mode: 'structure' }
                ]
            },
            result: null
        }));
        await pointAt('chat-1', ['orders', 'far']);
        const orders = textOf(await read('chat-1', { sourceId: 'orders' }));
        expect(orders).toContain('connection: Shop (shop-1, mysql, read)');
        expect(orders).toContain('filter: total > 10');
        expect(orders).toContain('database_query {"connection":"shop-1","schema":"shop","sql":"SELECT * FROM `orders` WHERE total > 10 LIMIT 50"}');
        expect(textOf(await read('chat-1', { sourceId: 'far' }))).toContain('connection: elsewhere-1 (not on this machine)');
    });

    test('an image is drawn through the preview into the chat, and only a chat has a folder for it', async () => {
        await pointAt('chat-1', ['sketch-1']);
        await pointAt('term-1', ['sketch-1']);
        expect(textOf(await read('term-1', { sourceId: 'sketch-1', form: 'image' }))).toBe('failed visual-needs-chat');
        const previews: { chatId: string; width: number; html: string }[] = [];
        const drawing: CanvasHost = {
            ...host(),
            visuals: {
                enabled: () => false,
                publish: () => Promise.reject(new Error('nothing is shown')),
                list: async () => [],
                remove: async () => [],
                preview: async (chatId, input) => {
                    previews.push({ chatId, width: input.width, html: input.html });
                    return { path: '/home/chats/chat-1.visuals/preview-1.png', width: input.width, height: 120, shotHeight: 120, console: [], omitted: 0 };
                }
            }
        };
        const text = textOf(await read('chat-1', { sourceId: 'sketch-1', form: 'image' }, drawing));
        expect(text.split('\n').slice(1, 2)).toEqual(['/home/chats/chat-1.visuals/preview-1.png']);
        expect(previews[0]).toMatchObject({ chatId: 'chat-1', width: 240 });
        expect(previews[0]!.html).toContain('<svg');
        expect(textOf(await read('chat-1', { sourceId: 'sketch-1', form: 'image' }))).toBe('failed preview-unavailable');
    });
});

describe('reaching another open project', () => {
    let other: string;
    let otherId: string;
    let reachOn: boolean;

    beforeEach(async () => {
        reachOn = true;
        other = join(root, 'other');
        await mkdir(other);
        const opened = await store.openProject({ folder: other });
        otherId = opened.summary.projectId;
        await store.save(otherId, opened.document.rev, {
            name: 'other',
            color: '#654321',
            views: [
                {
                    kind: 'canvas',
                    id: 'work',
                    name: 'Work',
                    nodes: [{ id: 'note-b', kind: 'note', title: 'Their plan', x: 0, y: 0, w: 320, h: 240, body: 'ship it' }],
                    texts: [],
                    edges: [],
                    layouts: []
                },
                { kind: 'chat', id: 'chat-b', name: 'Their chat', node: {} }
            ]
        });
        store.hold('client-1', otherId);
        store.letGo('client-1', otherId);
    });

    function reaching(): CanvasHost {
        return {
            ...host(),
            reach: projectReach(store, () => reachOn)
        };
    }

    test('read project reads any node of the other project without a line, and nothing outside it', async () => {
        const reader: CanvasHost = {
            ...reaching(),
            context: {
                ...host().context!,
                answerSource: async (_target, source, _tail, _subagent, project) => ({ text: `${source.id} in ${project}` })
            }
        };
        const reached = await reachedPlace(reader, 'term-1', otherId);
        const call = serverActionCall(reader, reached, 'term-1', false, undefined, store.locate('term-1')!);
        const read = (sourceId: string, viewId: string | null = null) =>
            serverActions.execute('context.read', { sourceId, tail: null, subagent: null, viewId, form: null }, call);
        expect(await read('note-b')).toMatchObject({ status: 'completed', output: { text: `note-b in ${otherId}` } });
        expect(await read('chat-b')).toMatchObject({ status: 'completed', output: { text: `chat-b in ${otherId}` } });
        expect(await read('note-1')).toMatchObject({ status: 'failed', error: { code: 'unknown-source' } });
        expect(await read('note-b', 'work')).toMatchObject({ status: 'failed', error: { code: 'bad-arguments' } });
    });
});
