import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectDocument, ProviderInfo } from '@ruimte/contracts';
import { useDrafts } from '@adecore/agents-react/chat/drafts';
import { focusedCanvas } from '../state/canvas';
import { useDocument } from '../state/document';
import { currentEndpointId } from '../state/keys';
import { providerSinkFor } from '@adecore/agents-react/state/providers';
import { useFiles } from '../state/files';
import { askAgentAboutDiagram, newFileViewsAfter, openSessionInKind, promoteLooseFile } from './views';

function installed(kind: string, name: string) {
    return { kind, name, installed: true, capabilities: { chat: true, terminal: true } } as unknown as ProviderInfo;
}

const document: ProjectDocument = {
    version: 3,
    rev: 1,
    name: 'Atlas',
    color: '#000',
    views: [
        { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] },
        { kind: 'diagram', id: 'flow', name: 'Flow' }
    ]
};

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('asking an agent to write an empty diagram', () => {
    test('puts the diagram and a chat on the canvas with a line from one into the other, and a first question in the prompt', async () => {
        useDocument.getState().load(document, { activeViewId: 'flow', views: {} });
        const chat = await askAgentAboutDiagram('flow');

        expect(chat).not.toBeNull();
        expect(useDocument.getState().activeViewId).toBe('main');
        const canvas = focusedCanvas().getState();
        const mirror = Object.values(canvas.nodes).find((node) => node.kind === 'diagram');
        expect(mirror?.viewId).toBe('flow');
        expect(canvas.nodes[chat!]?.kind).toBe('chat');
        expect(canvas.edges).toEqual([expect.objectContaining({ from: mirror!.id, to: chat })]);
        expect(useDrafts.getState().ids).toContain(chat!);
    });

    test('a view that is not a diagram or a drawing asks nothing', async () => {
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        expect(await askAgentAboutDiagram('main')).toBeNull();
    });
});

describe('the same session in the other kind of view', () => {
    const withChat: ProjectDocument = {
        ...document,
        views: [
            ...document.views,
            { kind: 'chat', id: 'talk', name: 'Claude', node: { provider: 'claude', providerFixed: true } },
            { kind: 'terminal', id: 'shell', name: 'Shell', node: {} }
        ]
    };

    beforeEach(() => {
        providerSinkFor(currentEndpointId()).setProviders([installed('claude', 'Claude Code'), installed('codex', 'Codex')]);
    });

    afterEach(() => {
        providerSinkFor(currentEndpointId()).setProviders([]);
    });

    test('a chat opens as a terminal that resumes its session in the mode it has, right under it', async () => {
        useDocument.getState().load(withChat, { activeViewId: 'talk', views: {} });
        const id = await openSessionInKind('talk', 'terminal', { provider: 'claude', resume: 'sess-1', cwd: '/work' });

        const views = useDocument.getState().views;
        expect(views.map((view) => view.id)).toEqual(['main', 'flow', 'talk', id!, 'shell']);
        const opened = views.find((view) => view.id === id);
        expect(opened).toMatchObject({ kind: 'terminal', name: 'Claude', node: { provider: 'claude', resume: 'sess-1', cwd: '/work' } });
        expect(opened?.kind === 'terminal' ? opened.node.runtimeMode : 'not a terminal').toBeUndefined();
    });

    test('a terminal opens as a chat that cannot be handed to another CLI', async () => {
        useDocument.getState().load(withChat, { activeViewId: 'shell', views: {} });
        const id = await openSessionInKind('shell', 'chat', { provider: 'codex', resume: 'sess-2' });

        const opened = useDocument.getState().views.find((view) => view.id === id);
        expect(opened).toMatchObject({ kind: 'chat', node: { provider: 'codex', resume: 'sess-2', providerFixed: true } });
    });

    test('the account the session ran under goes along, since another account does not hold it', async () => {
        useDocument.getState().load(withChat, { activeViewId: 'shell', views: {} });
        const id = await openSessionInKind('shell', 'chat', { provider: 'codex', resume: 'sess-2', account: 'codex_work' });

        const opened = useDocument.getState().views.find((view) => view.id === id);
        expect(opened).toMatchObject({ kind: 'chat', node: { provider: 'codex', resume: 'sess-2', account: 'codex_work' } });
    });

    test('a view that is gone opens nothing', async () => {
        useDocument.getState().load(withChat, { activeViewId: 'talk', views: {} });
        expect(await openSessionInKind('nowhere', 'terminal', { provider: 'claude', resume: 'sess-3' })).toBeNull();
        expect(useDocument.getState().views).toHaveLength(4);
    });
});

describe('files dropped on the list', () => {
    test('become views in the gap they were let go of, in the order they came', async () => {
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        await newFileViewsAfter(['/elsewhere/a.md', '/elsewhere/b.md'], 'main');
        const views = useDocument.getState().views;
        expect(views.map((view) => view.name)).toEqual(['Main', 'a.md', 'b.md', 'Flow']);
        expect(views[1]).toMatchObject({ kind: 'file', path: '/elsewhere/a.md' });
        expect(useDocument.getState().fileViews()).toEqual(views);
    });

    test('go to the very top from the gap above the first row', async () => {
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        await newFileViewsAfter(['/elsewhere/a.md'], null);
        expect(useDocument.getState().views.map((view) => view.name)).toEqual(['a.md', 'Main', 'Flow']);
    });

    test('a loose file becomes a view of the project, in the cell and the gap it was let go of', async () => {
        useFiles.setState({ tabs: [], recent: [] });
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        const key = useFiles.getState().dropFile('/elsewhere/a.md', 5, { column: 0, cell: 0 }, 'right')!;
        expect(await promoteLooseFile(key, 'main')).toBe(true);
        const views = useDocument.getState().views;
        expect(views.map((view) => view.name)).toEqual(['Main', 'a.md', 'Flow']);
        expect(views[1]).toMatchObject({ kind: 'file', path: '/elsewhere/a.md' });
        expect(useDocument.getState().layout!.columns.map((column) => column.cells.map((cell) => cell.viewId))).toEqual([['main'], [views[1]!.id]]);
        expect(useDocument.getState().activeViewId).toBe(views[1]!.id);
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useFiles.getState().recent).toEqual([]);
        expect(useDocument.getState().fileViews()).toEqual(views);
    });

    test('a loose file inside a host keeps its tab in it', async () => {
        useFiles.setState({ tabs: [], recent: [] });
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        useFiles.getState().open('/elsewhere/a.md', 5);
        useFiles.getState().open('/elsewhere/b.md', 5);
        await promoteLooseFile('/elsewhere/a.md', null);
        const [file] = useDocument.getState().views;
        expect(file).toMatchObject({ kind: 'file', path: '/elsewhere/a.md' });
        expect(useDocument.getState().layout!.columns[0]!.cells[0]).toMatchObject({ viewId: '/elsewhere/b.md', tabs: [file!.id, '/elsewhere/b.md'] });
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/elsewhere/b.md']);
    });

    test('a diff is no file to make a view of', async () => {
        useFiles.setState({ tabs: [], recent: [] });
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        useFiles.getState().open('/repo/a.ts', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        expect(await promoteLooseFile('diff:/repo/a.ts', null)).toBe(false);
        expect(useDocument.getState().views).toHaveLength(2);
        expect(useFiles.getState().tabs).toHaveLength(1);
    });
});
