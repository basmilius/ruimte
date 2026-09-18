import { describe, expect, test } from 'bun:test';
import { deriveContextSources, deriveProjectContextSources } from './context-sources.ts';
import type { ProjectNode, ProjectView } from './project.ts';

const node = (id: string, kind: ProjectNode['kind'], extra: Partial<ProjectNode> = {}): ProjectNode => ({
    id,
    kind,
    title: id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...extra
});

describe('deriveContextSources', () => {
    const nodes = {
        chat: node('chat', 'chat'),
        shell: node('shell', 'terminal'),
        note: node('note', 'note', { title: 'Plan', body: '# Plan\n\nShip it.' }),
        page: node('page', 'browser', { url: 'https://ruimte.app' }),
        sketch: node('sketch', 'drawing', { title: 'Sketch', viewId: 'drawing-1' }),
        flow: node('flow', 'diagram', { title: 'Flow', viewId: 'diagram-1' }),
        readme: node('readme', 'file', { title: 'README.md', path: 'docs/README.md' }),
        outside: node('outside', 'file', { title: 'hosts', path: '/etc/hosts' }),
        phone: node('phone', 'device', {
            title: 'iPhone 17 Pro',
            device: { platform: 'ios', kind: 'simulator', name: 'iPhone 17 Pro', runtime: 'iOS 26.2' }
        }),
        frame: node('frame', 'group')
    };
    const texts = { t1: { id: 't1', x: 0, y: 0, text: 'First line\nsecond', size: 18 } };

    test('a file is its path on the daemon machine, never its contents', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'readme', to: 'chat' }], '/home/bas/app');
        expect(sources.get('chat')).toEqual([{ id: 'readme', kind: 'file', title: 'README.md', text: '/home/bas/app/docs/README.md' }]);
    });

    test('a file outside the folder keeps the absolute path it was stored with', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'outside', to: 'chat' }], '/home/bas/app');
        expect(sources.get('chat')).toEqual([{ id: 'outside', kind: 'file', title: 'hosts', text: '/etc/hosts' }]);
    });

    test('a file in a project with no folder falls back to what it stored', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'readme', to: 'chat' }]);
        expect(sources.get('chat')).toEqual([{ id: 'readme', kind: 'file', title: 'README.md', text: 'docs/README.md' }]);
    });

    test('a note is a text source with its title and body', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'note', to: 'chat' }]);
        expect(sources.get('chat')).toEqual([{ id: 'note', kind: 'text', title: 'Plan', text: '# Plan\n\nShip it.' }]);
    });

    test('a drawing is read by the view it mirrors, a terminal by its own id', () => {
        const sources = deriveContextSources(nodes, texts, [
            { id: 'e1', from: 'sketch', to: 'chat' },
            { id: 'e2', from: 'shell', to: 'chat' }
        ]);
        expect(sources.get('chat')).toEqual([
            { id: 'drawing-1', kind: 'drawing', title: 'Sketch', nodeId: 'sketch' },
            { id: 'shell', kind: 'terminal', title: 'shell' }
        ]);
    });

    test('a diagram is read by the view it mirrors, like a drawing, and names the node it is linked through', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'flow', to: 'shell' }]);
        expect(sources.get('shell')).toEqual([{ id: 'diagram-1', kind: 'diagram', title: 'Flow', nodeId: 'flow' }]);
    });

    test('a diagram node that mirrors nothing yet is only a line', () => {
        const loose = { ...nodes, empty: node('empty', 'diagram') };
        expect(deriveContextSources(loose, texts, [{ id: 'e1', from: 'empty', to: 'chat' }]).size).toBe(0);
    });

    test('only edges into an agent node become context', () => {
        const edges = [
            { id: 'e1', from: 'shell', to: 'note' },
            { id: 'e2', from: 'note', to: 'frame' },
            { id: 'e3', from: 'page', to: 't1' },
            { id: 'e4', from: 't1', to: 'shell' }
        ];
        const sources = deriveContextSources(nodes, texts, edges);
        expect([...sources.keys()]).toEqual(['shell']);
        expect(sources.get('shell')).toEqual([{ id: 't1', kind: 'text', title: 'First line', text: 'First line\nsecond' }]);
    });

    test('a browser is its own kind and carries the address a read opens with', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'page', to: 'chat' }]);
        expect(sources.get('chat')).toEqual([{ id: 'page', kind: 'browser', title: 'page', text: 'https://ruimte.app' }]);
    });

    test('a device hands over the reference the daemon looks the real device up by', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'phone', to: 'chat' }]);
        expect(sources.get('chat')).toEqual([
            {
                id: 'phone',
                kind: 'device',
                title: 'iPhone 17 Pro',
                device: { platform: 'ios', kind: 'simulator', name: 'iPhone 17 Pro', runtime: 'iOS 26.2' }
            }
        ]);
    });

    test('a device node that points at nothing is only a line', () => {
        const loose = { ...nodes, empty: node('empty', 'device') };
        expect(deriveContextSources(loose, texts, [{ id: 'e1', from: 'empty', to: 'chat' }]).size).toBe(0);
    });
});

describe('deriveContextSources of a group', () => {
    const chat = node('chat', 'chat', { x: 5000, y: 5000 });
    const frame = node('frame', 'group', { title: 'Release', x: 0, y: 0, w: 1000, h: 1000 });
    const inner = node('inner', 'group', { title: 'Inner', x: 400, y: 400, w: 500, h: 500 });
    const plan = node('plan', 'note', { title: 'Plan', body: 'ship', x: 100, y: 100, w: 100, h: 100 });
    const shell = node('shell', 'terminal', { title: 'dev server', x: 500, y: 500, w: 100, h: 100 });
    const outside = node('outside', 'note', { title: 'Later', body: 'not now', x: 4000, y: 0, w: 100, h: 100 });
    const nodes = { chat, frame, plan, shell, outside, inner };
    const texts = { t1: { id: 't1', x: 200, y: 300, text: 'Scope\nwhat we ship', size: 18 } };
    const intoChat = [{ id: 'e1', from: 'frame', to: 'chat' }];

    test('everything inside the frame becomes a source of its own, a text included', () => {
        expect(deriveContextSources(nodes, texts, intoChat).get('chat')).toEqual([
            { id: 'plan', kind: 'text', title: 'Plan', text: 'ship' },
            { id: 'shell', kind: 'terminal', title: 'dev server' },
            { id: 't1', kind: 'text', title: 'Scope', text: 'Scope\nwhat we ship' }
        ]);
    });

    test('a frame inside the frame hands over its own, and never itself', () => {
        const ids = deriveContextSources(nodes, texts, intoChat)
            .get('chat')
            ?.map((source) => source.id);
        expect(ids).not.toContain('inner');
        expect(ids).toContain('shell');
    });

    test('a collapsed frame is what the file says it holds', () => {
        const folded = {
            ...nodes,
            frame: { ...frame, collapsed: true, expandedHeight: 1000, h: 40, memberIds: ['outside'] }
        };
        expect(deriveContextSources(folded, texts, intoChat).get('chat')).toEqual([{ id: 'outside', kind: 'text', title: 'Later', text: 'not now' }]);
    });

    test('the agent standing in the frame is not context for itself', () => {
        const inside = { ...nodes, chat: { ...chat, x: 700, y: 100 } };
        const ids = deriveContextSources(inside, texts, intoChat)
            .get('chat')
            ?.map((source) => source.id);
        expect(ids).not.toContain('chat');
    });

    test('a node reached by a line of its own and by the frame around it is one source', () => {
        const edges = [...intoChat, { id: 'e2', from: 'plan', to: 'chat' }];
        expect(
            deriveContextSources(nodes, texts, edges)
                .get('chat')
                ?.filter((source) => source.id === 'plan')
        ).toHaveLength(1);
    });

    test('two frames that hold each other hand their members over once', () => {
        const overlapping = {
            chat,
            left: node('left', 'group', { x: 0, y: 0, w: 600, h: 600 }),
            right: node('right', 'group', { x: 200, y: 200, w: 600, h: 600 }),
            plan
        };
        const sources = deriveContextSources(overlapping, {}, [{ id: 'e1', from: 'left', to: 'chat' }]).get('chat');
        expect(sources).toEqual([{ id: 'plan', kind: 'text', title: 'Plan', text: 'ship' }]);
    });

    test('an empty frame is a line and nothing more', () => {
        expect(deriveContextSources({ chat, frame }, {}, intoChat).size).toBe(0);
    });
});

describe('deriveProjectContextSources', () => {
    const views: ProjectView[] = [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [node('agent-a', 'terminal'), node('plan', 'note', { title: 'Plan', body: 'ship' })],
            texts: [],
            edges: [{ id: 'e1', from: 'plan', to: 'agent-a' }],
            layouts: []
        },
        { kind: 'terminal', id: 'solo', name: 'Shell', node: {} },
        {
            kind: 'canvas',
            id: 'second',
            name: 'Second',
            nodes: [node('agent-b', 'chat'), node('spec', 'file', { title: 'spec.md', path: 'docs/spec.md' })],
            texts: [],
            edges: [{ id: 'e2', from: 'spec', to: 'agent-b' }],
            layouts: []
        }
    ];

    test('every canvas counts, not only the one on screen', () => {
        const sources = deriveProjectContextSources(views, '/repo');
        expect(sources.get('agent-a')).toEqual([{ id: 'plan', kind: 'text', title: 'Plan', text: 'ship' }]);
        expect(sources.get('agent-b')).toEqual([{ id: 'spec', kind: 'file', title: 'spec.md', text: '/repo/docs/spec.md' }]);
        expect(sources.has('solo')).toBe(false);
    });

    test('an edge from one canvas never reaches a node on another', () => {
        const crossed: ProjectView[] = [
            { ...(views[0] as Extract<ProjectView, { kind: 'canvas' }>), edges: [] },
            { ...(views[2] as Extract<ProjectView, { kind: 'canvas' }>), edges: [{ id: 'e3', from: 'plan', to: 'agent-b' }] }
        ];
        expect(deriveProjectContextSources(crossed, null).size).toBe(0);
    });
});
