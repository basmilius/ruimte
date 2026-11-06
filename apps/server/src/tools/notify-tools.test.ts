import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type CanvasHost } from '../canvas/host.ts';
import { projectReach } from '../canvas/reach.ts';
import { canvasFixture, type CanvasFixture, madeId } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('notify', () => {
    test('refuses a node that runs on another machine, where nothing would ever deliver it', async () => {
        const target = await madeId(fx.invoke('node_new', { kind: 'terminal' }));
        fx.elsewhere.add(target);
        const { status, lines } = await fx.invoke('notify', { id: target, text: 'hi' });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnode-on-other-machine\t');
        expect(fx.notified).toEqual([]);
    });

    test('a message reaches a terminal of the project with no line to it', async () => {
        const [target, , , drawn] = (await fx.invoke('node_new', { kind: 'terminal', title: 'builder' })).lines[0]!.split('\t') as [
            string,
            string,
            string,
            string
        ];
        expect((await fx.invoke('link_delete', { edge_id: [drawn] })).lines[0]).toStartWith('deleted\t');

        const sent = await fx.invoke('notify', { id: target, text: 'the build is green' });
        expect(sent.status).toBe(200);
        expect(sent.lines).toEqual([`notified\t${target}\twaiting\t${fx.knobs.delivery.detail}\tbuilder`]);
        // The sender goes along by id, with its title only so the receiver can read the line.
        expect(fx.notified).toEqual([{ projectId: fx.projectId, targetId: target, from: 'term-1', fromTitle: 'shell', text: 'the build is green' }]);
    });

    test('a later chat of a design node sends along the lines of that node', async () => {
        await fx.withDesignNode([{ id: 'edge-d', from: 'design-1', to: 'term-1' }]);
        const sent = await fx.invoke('notify', { id: 'term-1', text: 'the header is done' }, 'later');
        expect(sent.status).toBe(200);
        // The message signs with the later chat's own name, not the node's.
        expect(fx.notified).toEqual([{ projectId: fx.projectId, targetId: 'term-1', from: 'later-1', fromTitle: 'Header', text: 'the header is done' }]);
    });

    test('a later chat of a design node takes a message, delivered to the chat itself', async () => {
        await fx.withDesignNode([]);
        expect((await fx.invoke('notify', { id: 'later-1', text: 'hi' })).status).toBe(200);
        expect(fx.notified).toEqual([{ projectId: fx.projectId, targetId: 'later-1', from: 'term-1', fromTitle: 'shell', text: 'hi' }]);
    });

    test('says where the message landed, in the words the daemon gave it', async () => {
        const target = await madeId(fx.invoke('node_new', { kind: 'terminal' }));
        fx.knobs.delivery = { at: 'now', wake: false, detail: 'printed on the screen of that terminal' };
        expect((await fx.invoke('notify', { id: target, text: 'look at the log' })).lines).toEqual([
            `notified\t${target}\tnow\tprinted on the screen of that terminal\tTerminal`
        ]);
    });

    test('refuses a node that is not there, is not an agent, or is the caller itself', async () => {
        const unknown = await fx.invoke('notify', { id: 'nowhere', text: 'hi' });
        expect(unknown.lines[0]).toBe('refused\tunknown-node\tnowhere is no terminal or chat of this project');
        const plain = await fx.invoke('notify', { id: 'note-1', text: 'hi' });
        expect(plain.lines[0]).toBe('refused\tnot-an-agent\tnote-1 is a note node; only a terminal or a chat has an agent that could read a message');
        const self = await fx.invoke('notify', { id: 'term-1', text: 'hi' });
        expect(self.lines[0]).toBe('refused\tself-notify\tterm-1 is you; a node needs no message to itself');
        expect(fx.notified).toEqual([]);
    });

    test('a chat that is a view of its own and a node on a canvas write to each other both ways', async () => {
        expect((await fx.invoke('notify', { id: 'chat-1', text: 'look at the diff' })).status).toBe(200);
        expect((await fx.invoke('notify', { id: 'term-1', text: 'the build is green' }, 'chat')).status).toBe(200);
        expect(fx.notified).toEqual([
            { projectId: fx.projectId, targetId: 'chat-1', from: 'term-1', fromTitle: 'shell', text: 'look at the diff' },
            { projectId: fx.projectId, targetId: 'term-1', from: 'chat-1', fromTitle: 'Planner', text: 'the build is green' }
        ]);
    });

    test('the message and its node are present', async () => {
        expect((await fx.invoke('notify', { id: 'note-1' })).lines[0]).toBe('refused\tbad-arguments\tnotify needs text, the message to leave');
        expect((await fx.invoke('notify', { text: 'hi' })).lines[0]).toBe('refused\tbad-arguments\tnotify needs id, the terminal or chat node to message');
        expect(fx.notified).toEqual([]);
    });
});

describe('reaching another open project', () => {
    let other: string;
    let otherId: string;
    let reachOn: boolean;

    beforeEach(async () => {
        reachOn = true;
        other = join(fx.root, 'other');
        await mkdir(other);
        const opened = await fx.store.openProject({ folder: other });
        otherId = opened.summary.projectId;
        await fx.store.save(otherId, opened.document.rev, {
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
        fx.store.hold('client-1', otherId);
        fx.store.letGo('client-1', otherId);
    });

    function reaching(): CanvasHost {
        return {
            ...fx.host(),
            reach: projectReach(fx.store, () => reachOn)
        };
    }

    test('notify project reaches a chat of the other project, signed with the caller and its project', async () => {
        const sent = await fx.invoke('notify', { id: 'chat-b', project: otherId, text: 'Your API changed' }, 'term', reaching());
        expect(sent.status).toBe(200);
        expect(fx.notified).toEqual([{ projectId: otherId, targetId: 'chat-b', from: 'term-1', fromTitle: 'shell in repo', text: 'Your API changed' }]);
        expect((await fx.invoke('notify', { id: 'chat-1', project: otherId, text: 'x' }, 'term', reaching())).lines[0]).toStartWith('refused\tunknown-node\t');
        reachOn = false;
        expect((await fx.invoke('notify', { id: 'chat-b', project: otherId, text: 'x' }, 'term', reaching())).lines[0]).toStartWith(
            'refused\tprojects-not-reachable\t'
        );
        expect(fx.notified).toHaveLength(1);
    });
});
