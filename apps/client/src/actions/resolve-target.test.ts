import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ActionInput } from '@ruimte/actions';
import type { ProjectCanvasView, ProjectDocument, ProjectNode, ProjectSummary } from '@ruimte/contracts';
import { resolveTarget } from '@/actions/resolve-target';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';

const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const document = (views: ProjectDocument['views']): ProjectDocument => ({ version: 3, rev: 1, name: 'Atlas', color: '#000', views });

const canvasNode = (id: string, title: string, kind: ProjectNode['kind'], x: number): ProjectNode => ({ id, title, kind, x, y: 100, w: 240, h: 160 });

const resolve = (input: Partial<ActionInput<'target.resolve'>> & Pick<ActionInput<'target.resolve'>, 'target'>) =>
    resolveTarget(useDocument, { names: null, nodeKind: null, scope: null, machine: null, ...input });

const load = (views: ProjectDocument['views']): void => {
    useDocument.getState().load(document(views), { activeViewId: 'main', views: {} });
    defaultCanvases
        .of('main')
        .getState()
        .loadView(views[0] as ProjectCanvasView, null);
    defaultCanvases.focus('main');
};

const endpoints = useEndpoints.getState().endpoints;

beforeEach(() => {
    load([main, { kind: 'canvas', id: 'release', name: 'Release', nodes: [], texts: [], edges: [], layouts: [] }]);
});

afterEach(() => {
    useDocument.getState().load(null, null);
    useProjectList.setState({ projects: [] });
    useEndpoints.setState({ endpoints });
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

describe('resolveTarget', () => {
    test('without names it returns the active view', () => {
        expect(resolve({ target: 'view' })).toMatchObject({ found: [{ id: 'main', name: 'Main', kind: 'canvas' }], ambiguous: [], missing: [] });
    });

    test('refuses equally named views instead of choosing the first one', () => {
        load([
            main,
            { kind: 'canvas', id: 'release', name: 'Release', nodes: [], texts: [], edges: [], layouts: [] },
            { kind: 'chat', id: 'release-chat', name: 'release', node: {} }
        ]);
        expect(resolve({ target: 'view', names: ['Release'] })).toMatchObject({
            found: [],
            ambiguous: [{ name: 'Release', candidates: [{ id: 'release' }, { id: 'release-chat' }] }]
        });
    });

    test('returns every candidate for an ambiguous partial name, and an exact name wins', () => {
        load([
            main,
            { kind: 'canvas', id: 'release-plan', name: 'Release Plan', nodes: [], texts: [], edges: [], layouts: [] },
            { kind: 'chat', id: 'release-chat', name: 'Release Chat', node: {} }
        ]);
        expect(resolve({ target: 'view', names: ['Release', 'release plan', 'Nothing'] })).toMatchObject({
            found: [{ id: 'release-plan' }],
            ambiguous: [{ name: 'Release', candidates: [{ id: 'release-plan' }, { id: 'release-chat' }] }],
            missing: ['Nothing']
        });
    });

    test('never chooses between duplicate chat names across views and canvases', () => {
        load([
            { ...main, nodes: [canvasNode('chat-node', 'Research', 'chat', 100)] },
            { kind: 'chat', id: 'chat-view', name: 'Research', node: {} }
        ]);
        expect(resolve({ target: 'chat', names: ['Research'] })).toMatchObject({
            found: [],
            ambiguous: [
                {
                    candidates: [
                        { id: 'chat-node', viewId: 'main' },
                        { id: 'chat-view', viewId: 'chat-view' }
                    ]
                }
            ]
        });
    });

    test('without names a chat is the selected chat node on the active canvas', () => {
        load([{ ...main, nodes: [canvasNode('chat-node', 'Research', 'chat', 100), canvasNode('note', 'Note', 'note', 400)] }]);
        defaultCanvases.of('main').getState().select(['chat-node', 'note']);
        expect(resolve({ target: 'chat' }).found.map((target) => target.id)).toEqual(['chat-node']);
    });

    test('narrows nodes by scope and kind, with the selection when no scope is given', () => {
        const visible = canvasNode('visible', 'Visible note', 'note', 100);
        const far = canvasNode('far', 'Far note', 'note', 4000);
        const terminal = canvasNode('terminal', 'Shell', 'terminal', 300);
        defaultCanvases.of('main').setState({
            nodes: { visible, far, terminal },
            order: ['visible', 'far', 'terminal'],
            selection: ['terminal'],
            viewport: { w: 1200, h: 800 },
            camera: { x: 0, y: 0, zoom: 1 }
        });
        expect(resolve({ target: 'node' }).found.map((target) => target.id)).toEqual(['terminal']);
        expect(resolve({ target: 'node', scope: 'visible', nodeKind: 'note' }).found.map((target) => target.id)).toEqual(['visible']);
        expect(resolve({ target: 'node', scope: 'all', nodeKind: 'note' }).found.map((target) => target.id)).toEqual(['visible', 'far']);
        expect(resolve({ target: 'node', names: ['note'] }).ambiguous[0]?.candidates.map((target) => target.id)).toEqual(['visible', 'far']);
    });

    test('an agent resolves by its name and view when the name alone is shared', () => {
        load([
            { ...main, nodes: [canvasNode('main-chat', 'Research', 'chat', 100)] },
            { kind: 'canvas', id: 'release', name: 'Release', nodes: [canvasNode('release-chat', 'Research', 'chat', 100)], texts: [], edges: [], layouts: [] }
        ]);
        expect(resolve({ target: 'agent', names: ['Research'] }).ambiguous).toHaveLength(1);
        expect(resolve({ target: 'agent', names: ['Research (Release)'] }).found).toMatchObject([{ id: 'release-chat', viewId: 'release' }]);
    });

    test('a project resolves among open projects, narrowed by machine', () => {
        const summary = (projectId: string, name: string, closedAt: number | null): ProjectSummary => ({
            projectId,
            name,
            closedAt,
            color: '#000',
            folder: '/repo',
            lastOpenedAt: 1,
            available: true,
            icon: { kind: 'initial', value: 'F' },
            nameSource: 'chosen'
        });
        useEndpoints.setState({
            endpoints: [
                { ...endpoints[0]!, id: 'one', label: 'Studio' },
                { ...endpoints[0]!, id: 'two', label: 'Laptop' }
            ]
        });
        useProjectList.setState({
            projects: [
                { endpointId: 'one', summary: summary('p1', 'Flux', null) },
                { endpointId: 'two', summary: summary('p2', 'Flux', null) },
                { endpointId: 'one', summary: summary('p3', 'Closed', 1) }
            ]
        });
        expect(resolve({ target: 'project', names: ['Flux'] }).ambiguous[0]?.candidates).toHaveLength(2);
        expect(resolve({ target: 'project', names: ['Flux'], machine: 'laptop' }).found).toMatchObject([{ id: 'p2', endpointId: 'two', machine: 'Laptop' }]);
        expect(resolve({ target: 'project', names: ['Closed'] }).missing).toEqual(['Closed']);
    });
});
