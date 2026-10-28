import { afterEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import { runContext } from '../cli/context.ts';
import { CONTEXT_ENV, routeContextCli } from '../cli/context-test-helpers.ts';
import { ProjectIndex } from '../projects/project-index.ts';
import fixture from '../../../ios/Tests/Fixtures/view-references.json';
import { attachedReferences, referenceNote, referenced, referencedIds, resolveReference, resolveReferences } from './references.ts';
import { handleContextRequest } from './context-route.ts';
import { ContextStore } from './context-store.ts';

const canvas: ProjectCanvasView = {
    id: 'main',
    name: 'Planning',
    kind: 'canvas',
    nodes: [
        { id: 'asker', kind: 'chat', title: 'Planner', x: 0, y: 0, w: 400, h: 300 },
        { id: 'earlier', kind: 'chat', title: 'Auth "rewrite"', x: 500, y: 0, w: 400, h: 300 },
        { id: 'shell', kind: 'terminal', title: 'dev server', x: 0, y: 400, w: 400, h: 300 },
        { id: 'research', kind: 'note', title: 'Research', body: 'The cache is per machine.', x: 500, y: 400, w: 300, h: 200 },
        { id: 'page', kind: 'browser', title: 'Preview', url: 'http://localhost:5173', x: 900, y: 0, w: 400, h: 300 },
        { id: 'flow-node', kind: 'diagram', title: 'Flow', viewId: 'flow', x: 900, y: 400, w: 400, h: 300 },
        { id: 'frame', kind: 'group', title: 'Frame', x: 0, y: 800, w: 400, h: 300 }
    ],
    texts: [{ id: 'label', text: 'Next steps\nand more', x: 0, y: 1200, size: 16 }],
    edges: [],
    layouts: []
};

const views: ProjectView[] = [
    canvas,
    { id: 'standalone', kind: 'chat', name: 'Release notes', node: { provider: 'codex' } },
    { id: 'inline', kind: 'chat', name: 'Inline edit', hidden: true, node: { provider: 'claude' } },
    { id: 'sketch', kind: 'drawing', name: 'Sketch' },
    { id: 'flow', kind: 'diagram', name: 'Onboarding flow' },
    { id: 'docs', kind: 'browser', name: 'Docs', url: 'https://example.com' },
    { id: 'readme', kind: 'file', name: 'README', path: 'README.md' },
    { id: 'line', kind: 'separator' }
] as ProjectView[];

const index = new ProjectIndex();
index.set('project-a', '/work/a', { views });
index.set('project-b', '/work/b', {
    views: [{ id: 'elsewhere', kind: 'chat', name: 'Other project', node: { provider: 'claude' } }]
});

function lookupFor(fromId: string) {
    return (id: string) => index.referenceBeside(fromId, id);
}

const earlierThread: ChatItem[] = [
    { id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Move the tokens to the shell' },
    { id: 'a1', kind: 'assistant', createdAt: 2, turnId: 't1', text: 'The refresh token now stays in the shell.', streaming: false }
];

describe('resolving references', () => {
    test('a view, a node and a text of the same project resolve to their kind, current name and canvas', () => {
        const resolved = resolveReferences(['sketch', 'research', 'label', 'standalone', 'page', 'research'], lookupFor('asker'));
        expect(resolved.map(({ id, kind, name, canvas: on }) => ({ id, kind, name, on: on?.id ?? null }))).toEqual([
            { id: 'sketch', kind: 'drawing', name: 'Sketch', on: null },
            { id: 'research', kind: 'note', name: 'Research', on: 'main' },
            { id: 'label', kind: 'text', name: 'Next steps', on: 'main' },
            { id: 'standalone', kind: 'chat', name: 'Release notes', on: null },
            { id: 'page', kind: 'browser', name: 'Preview', on: 'main' }
        ]);
    });

    test('the asker itself, another project, a hidden chat, a separator, a group and an unknown id do not resolve', () => {
        expect(resolveReferences(['asker', 'elsewhere', 'inline', 'line', 'frame', 'gone'], lookupFor('asker'))).toEqual([]);
        expect(resolveReferences(undefined, lookupFor('asker'))).toEqual([]);
        expect(index.referenceBeside('nobody', 'sketch')).toBeNull();
    });

    test('a design view, and a later chat of a design view or of a design node, resolve as chats', () => {
        const designs = [
            {
                id: 'board',
                kind: 'canvas',
                name: 'Board',
                texts: [],
                edges: [],
                layouts: [],
                nodes: [
                    { id: 'site', kind: 'design', title: 'Site', path: 'site', x: 0, y: 0, w: 400, h: 300, chats: [{ id: 'header', name: 'Header', node: {} }] }
                ]
            },
            { id: 'shop', kind: 'design', name: 'Shop', path: 'shop', node: {}, chats: [{ id: 'cart', name: 'Cart', node: {} }] }
        ] as ProjectView[];
        const resolved = ['shop', 'cart', 'site', 'header'].map((id) => resolveReference(designs, id, '/work'));
        expect(
            resolved.map((reference) => reference && { id: reference.id, kind: reference.kind, name: reference.name, on: reference.canvas?.id ?? null })
        ).toEqual([
            { id: 'shop', kind: 'chat', name: 'Shop', on: null },
            { id: 'cart', kind: 'chat', name: 'Cart', on: null },
            { id: 'site', kind: 'chat', name: 'Site', on: 'board' },
            { id: 'header', kind: 'chat', name: 'Header', on: 'board' }
        ]);
        expect(resolved[3]?.sources).toEqual([{ id: 'header', kind: 'chat', title: 'Header' }]);
        expect(resolved[0]?.sources).toEqual([
            { id: 'shop', kind: 'chat', title: 'Shop' },
            { id: 'cart', kind: 'chat', title: 'Cart' }
        ]);
        expect(resolved[2]?.sources).toEqual([
            { id: 'site', kind: 'chat', title: 'Site' },
            { id: 'header', kind: 'chat', title: 'Header' }
        ]);
    });

    test('a canvas hands over every node and text on it, and a file its path on this machine', () => {
        const [main] = resolveReferences(['main'], lookupFor('standalone'));
        expect(main?.kind).toBe('canvas');
        expect(main?.sources.map((source) => source.id)).toEqual(['asker', 'earlier', 'shell', 'research', 'page', 'flow', 'label']);
        expect(index.referenceBeside('asker', 'readme')?.sources).toEqual([{ id: 'readme', kind: 'file', title: 'README', text: '/work/a/README.md' }]);
    });

    test('only the user items of a thread count, with both @ chats and # references', () => {
        const thread: ChatItem[] = [
            { id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'See this', chats: ['earlier'], references: ['sketch', 'elsewhere'] },
            { id: 'a1', kind: 'assistant', createdAt: 2, turnId: 't1', text: 'Read it.', streaming: false, references: ['shell'] } as ChatItem
        ];
        expect(referencedIds(thread)).toEqual(['earlier', 'sketch', 'elsewhere']);
        expect(referenced(thread, lookupFor('asker')).map((reference) => reference.id)).toEqual(['earlier', 'sketch']);
    });
});

describe('the note in front of a message', () => {
    test('names each reference with its kind, the command that reads it and the one that writes where there is one', () => {
        expect(referenceNote([])).toBeNull();
        const note = referenceNote(
            resolveReferences(['sketch', 'research', 'earlier', 'shell', 'flow', 'page', 'docs', 'label', 'main'], lookupFor('standalone'))
        );
        expect(note).toBe(
            [
                'The person referenced views and nodes of this project in this message. Read each with the command beside it before you answer.',
                '- "Sketch" (drawing): `ruimte-context read sketch` · see its elements with `ruimte-context read sketch --elements` · write with `ruimte-context view drawing sketch --revision R`',
                '- "Research" (note on "Planning"): `ruimte-context read research` · write with `ruimte-context node edit research`',
                '- "Auth \\"rewrite\\"" (chat on "Planning"): `ruimte-context read earlier` · message it with `ruimte-context notify earlier`',
                '- "dev server" (terminal on "Planning"): `ruimte-context read shell` · message it with `ruimte-context notify shell`',
                '- "Onboarding flow" (diagram): `ruimte-context read flow` · write with `ruimte-context view diagram flow`',
                '- "Preview" (browser on "Planning"): `ruimte-context read page` · drive it with `ruimte-context browser go page --url U`',
                '- "Docs" (browser): `ruimte-context read docs`',
                '- "Next steps" (text on "Planning"): `ruimte-context read label`',
                '- "Planning" (canvas): `ruimte-context read main` · read any node on it with `ruimte-context read <id>` · add nodes with `ruimte-context node new <kind> --view main`',
                'When you refer back to one of them, write `#` and its name exactly as listed (#Name), and the person can open it from your answer.'
            ].join('\n')
        );
    });

    test('a diagram node is written under the view it shows', () => {
        expect(referenceNote(resolveReferences(['flow-node'], lookupFor('asker')))).toContain(
            '`ruimte-context read flow-node` · write with `ruimte-context view diagram flow`'
        );
    });
});

describe('reading what a message referenced', () => {
    const threads = new Map<string, ChatItem[]>([
        ['asker', []],
        ['earlier', earlierThread]
    ]);
    const store = new ContextStore({
        sources: () => [],
        referenced: (targetId) => referenced(threads.get(targetId) ?? [], lookupFor(targetId)),
        terminalText: async () => null,
        chatItems: (id) => threads.get(id) ?? null,
        drawingElements: async () => null,
        diagramDocument: async () => null
    });
    const host = {
        projects: { locate: () => null, machineOfNode: () => null },
        context: store
    } as unknown as CanvasHost;
    const restore: Array<() => void> = [];

    afterEach(() => {
        for (const undo of restore.splice(0)) {
            undo();
        }
        threads.set('asker', []);
        index.set('project-a', '/work/a', { views });
    });

    /* The command the note hands the agent, run by the real CLI against the real route. */
    const run = async (note: string): Promise<{ code: number; stdout: string }> => {
        const command = /`ruimte-context (read \S+)`/.exec(note)?.[1];
        expect(command).toBeDefined();
        const cli = routeContextCli((request, pathname) =>
            handleContextRequest(request, pathname, { targetForToken: (token) => (token === 'tok' ? 'asker' : null), host })
        );
        restore.push(cli.restore);
        const code = await runContext(command!.split(' '), CONTEXT_ENV);

        return { code, stdout: cli.output.stdout };
    };

    test('the command in the note reads the conversation once the message is in the thread', async () => {
        const note = referenceNote(resolveReferences(['earlier'], lookupFor('asker')))!;
        expect((await run(note)).code).toBe(3);

        threads.set('asker', [{ id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Carry on from there', chats: ['earlier'] }]);
        const read = await run(note);
        expect(read.code).toBe(0);
        expect(read.stdout).toContain('The refresh token now stays in the shell.');
        expect(store.list('asker')).toEqual([]);
    });

    test('a referenced note reads without a line, and stops reading once the note is gone', async () => {
        threads.set('asker', [{ id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Read #Research', references: ['research'] }]);
        expect(await store.read('asker', 'research')).toBe('The cache is per machine.');
        index.set('project-a', '/work/a', {
            views: views.map((view) => (view.id === 'main' ? { ...canvas, nodes: canvas.nodes.filter((node) => node.id !== 'research') } : view))
        });
        expect(await store.read('asker', 'research')).toBeNull();
    });

    test('a # to a canvas reads every node on it', async () => {
        threads.set('asker', [{ id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'What is on #Planning?', references: ['main'] }]);
        expect(await store.read('asker', 'research')).toBe('The cache is per machine.');
        expect(store.referenced('asker').map((reference) => reference.id)).toEqual(['main']);
    });
});

describe('a reference sent from the iPhone', () => {
    test('gets the note a reference from the desktop gets, from the payload both clients send for the same picks', () => {
        const project = new ProjectIndex();
        project.set('fixture', '/work/fixture', { views: fixture.views as ProjectView[] });
        const attached = attachedReferences(fixture.send, (id) => project.referenceBeside(fixture.chatId, id));
        expect(attached).toEqual({ chats: fixture.send.chats, references: fixture.send.references, note: fixture.note });
    });
});
