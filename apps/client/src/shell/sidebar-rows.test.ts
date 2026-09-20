import { describe, expect, test } from 'bun:test';
import type { AgentStatus, NodeKind } from '@ruimte/contracts';
import { buildSidebar, heaviestStatus, isSessionKind, rowAfterArrow, rowOrder, type SidebarNode, type SidebarProject, type SidebarView } from './sidebar-rows';

const node = (id: string, status: AgentStatus | null = null): SidebarNode => ({ id, title: id, kind: 'terminal', provider: null, status, draft: false });

const view = (id: string, nodes: SidebarNode[] = []): SidebarView => ({
    id,
    name: id,
    kind: 'canvas',
    icon: null,
    provider: null,
    path: null,
    shared: false,
    nodes,
    self: null
});

const separator = (id: string): SidebarView => ({
    id,
    name: '',
    kind: 'separator',
    icon: null,
    provider: null,
    path: null,
    shared: false,
    nodes: [],
    self: null
});

const subheader = (id: string): SidebarView => ({ ...separator(id), kind: 'subheader', name: 'Agents' });

const drawing = (id: string): SidebarView => ({ id, name: id, kind: 'drawing', icon: null, provider: null, path: null, shared: false, nodes: [], self: null });

const standalone = (id: string, status: AgentStatus | null = null): SidebarView => ({
    id,
    icon: null,
    name: id,
    kind: 'chat',
    provider: null,
    path: null,
    shared: false,
    nodes: [],
    self: { id, title: id, kind: 'chat', provider: null, status, draft: true }
});

const backend = view('backend', [node('shell'), node('claude', 'needs-you'), node('docs', 'running')]);
const frontend = view('frontend', [node('composer', 'idle')]);

const project = (views: SidebarView[], activeViewId: string | null): SidebarProject => ({
    views,
    activeViewId,
    openViewIds: activeViewId === null ? [] : [activeViewId]
});

const build = (views: SidebarView[], activeViewId: string | null, expanded: string[]) =>
    buildSidebar({ project: project(views, activeViewId), expandedIds: new Set(expanded) });

describe('buildSidebar', () => {
    test('the views come in project order, with the nodes of the canvas that is open under it', () => {
        const [needs, list] = build([backend, frontend], 'backend', ['backend']);
        expect(needs!.label).toBe('Needs you');
        expect(list!.rows.map((row) => row.rowId)).toEqual(['view:backend', 'node:backend:shell', 'node:backend:claude', 'node:backend:docs', 'view:frontend']);
    });

    test('an agent that waits shows up top with the view it lives in named', () => {
        const [needs] = build([frontend, backend], 'frontend', ['frontend']);
        expect(needs!.rows).toHaveLength(1);
        expect(needs!.rows[0]).toMatchObject({ rowId: 'needs:claude', viewName: 'backend' });
    });

    test('the section disappears when nothing waits', () => {
        const sections = build([frontend], 'frontend', ['frontend']);
        expect(sections.map((section) => section.kind)).toEqual(['views']);
    });

    test('a folded canvas keeps the heaviest status of what it holds', () => {
        const [, list] = build([backend, frontend], 'frontend', ['frontend']);
        expect(list!.rows[0]).toMatchObject({ rowId: 'view:backend', expanded: false, expandable: true, status: 'needs-you' });
        expect(list!.rows[0]).toMatchObject({ active: false });
        expect(list!.rows[1]).toMatchObject({ rowId: 'view:frontend', active: true, expanded: true });
    });

    test('an empty canvas has nothing to unfold', () => {
        const [list] = build([view('empty')], 'empty', ['empty']);
        expect(list!.rows[0]).toMatchObject({ expandable: false, expanded: false, status: null });
    });

    test('a divider is a row with nothing behind it, and never the current one', () => {
        const [list] = build([separator('gap'), subheader('agents'), frontend], 'frontend', ['frontend']);
        expect(list!.rows[0]).toMatchObject({ rowId: 'view:gap', index: 0, active: false, expandable: false, status: null, draft: false });
        expect(list!.rows[1]).toMatchObject({ rowId: 'view:agents', index: 1, active: false, expandable: false, status: null, draft: false });
        expect(list!.rows[2]).toMatchObject({ rowId: 'view:frontend', index: 2, active: true });
    });

    test('a separator with a heading right under it gives up the room below its line', () => {
        const tightly = (views: SidebarView[]): boolean[] =>
            build(views, 'frontend', [])[0]!.rows.flatMap((row) => (row.type === 'view' ? [row.headingBelow] : []));
        expect(tightly([separator('gap'), subheader('agents'), frontend])).toEqual([true, false, false]);
        // Only a separator ever says it, and only when the heading is the very next row.
        expect(tightly([separator('gap'), frontend, subheader('agents')])).toEqual([false, false, false]);
    });

    test('every view row knows where it sits in the project list', () => {
        const [, list] = build([backend, separator('gap'), frontend], 'backend', ['backend']);
        const views = list!.rows.filter((row) => row.type === 'view');
        expect(views.map((row) => row.index)).toEqual([0, 1, 2]);
    });

    test('a view that is one node carries that node on its own row and never unfolds', () => {
        const [needs, list] = build([standalone('auth', 'needs-you'), frontend], 'frontend', ['frontend']);
        expect(needs!.rows[0]).toMatchObject({ rowId: 'needs:auth', viewName: 'auth' });
        expect(list!.rows[0]).toMatchObject({ rowId: 'view:auth', expandable: false, status: 'needs-you', draft: true });
    });
});

describe('the list of views', () => {
    test('is the one list of its kind, so nothing stands over it', () => {
        const [, list] = build([backend], 'backend', []);
        expect(list).toMatchObject({ id: 'views', kind: 'views', label: null, viewCount: 1 });
    });
});

describe('heaviestStatus', () => {
    test('what waits beats what failed, what failed beats what runs', () => {
        expect(heaviestStatus([node('a', 'running'), node('b', 'needs-you'), node('c', 'error')])).toBe('needs-you');
        expect(heaviestStatus([node('a', 'running'), node('b', 'error')])).toBe('error');
        expect(heaviestStatus([node('a', 'idle'), node('b', null)])).toBe('idle');
        expect(heaviestStatus([node('a')])).toBeNull();
    });
});

describe('rowOrder', () => {
    test('reads the sections top to bottom, the waiting rows first', () => {
        expect(rowOrder(build([backend], 'backend', ['backend']))).toEqual([
            'needs:claude',
            'view:backend',
            'node:backend:shell',
            'node:backend:claude',
            'node:backend:docs'
        ]);
    });
});

describe('rowAfterArrow', () => {
    const order = ['a', 'b', 'c'];

    test('starts at the top on Down and at the bottom on Up', () => {
        expect(rowAfterArrow(order, null, 1)).toBe('a');
        expect(rowAfterArrow(order, null, -1)).toBe('c');
    });

    test('steps one row', () => {
        expect(rowAfterArrow(order, 'b', 1)).toBe('c');
        expect(rowAfterArrow(order, 'b', -1)).toBe('a');
    });

    test('stops at the ends instead of wrapping', () => {
        expect(rowAfterArrow(order, 'c', 1)).toBe('c');
        expect(rowAfterArrow(order, 'a', -1)).toBe('a');
    });

    test('has nowhere to go in an empty list', () => {
        expect(rowAfterArrow([], null, 1)).toBeNull();
    });
});

describe('a drawing row', () => {
    test('it folds open on nothing and carries no status: a drawing is a file, not a session', () => {
        const [list] = build([drawing('sketch')], 'sketch', ['sketch']);
        expect(list!.rows).toHaveLength(1);
        expect(list!.rows[0]).toMatchObject({ type: 'view', expandable: false, expanded: false, status: null, draft: false, active: true });
    });
});

describe('what counts as a session', () => {
    test('only a terminal, a chat and a browser run; a drawing is a file like a note is paper', () => {
        const kinds: NodeKind[] = ['terminal', 'chat', 'browser'];
        expect(kinds.every(isSessionKind)).toBe(true);
        const rest: NodeKind[] = ['group', 'note', 'drawing'];
        expect(rest.some(isSessionKind)).toBe(false);
    });
});
