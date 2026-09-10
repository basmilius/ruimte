import { describe, expect, test } from 'bun:test';
import type { AgentStatus } from '@ruimte/contracts';
import { buildSidebar, heaviestStatus, rowAfterArrow, rowOrder, type SidebarNode, type SidebarView } from './sidebar-rows';

const node = (id: string, status: AgentStatus | null = null): SidebarNode => ({ id, title: id, kind: 'terminal', provider: null, status, draft: false });

const view = (id: string, nodes: SidebarNode[] = []): SidebarView => ({ id, name: id, kind: 'canvas', provider: null, nodes, self: null });

const separator = (id: string): SidebarView => ({ id, name: '', kind: 'separator', provider: null, nodes: [], self: null });

const standalone = (id: string, status: AgentStatus | null = null): SidebarView => ({
    id,
    name: id,
    kind: 'chat',
    provider: null,
    nodes: [],
    self: { id, title: id, kind: 'chat', provider: null, status, draft: true }
});

const backend = view('backend', [node('shell'), node('claude', 'needs-you'), node('docs', 'running')]);
const frontend = view('frontend', [node('composer', 'idle')]);

const build = (views: SidebarView[], activeViewId: string | null, expanded: string[]) => buildSidebar({ views, activeViewId, expandedIds: new Set(expanded) });

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
        expect(sections.map((section) => section.id)).toEqual(['views']);
    });

    test('a folded canvas keeps its count and the heaviest status of what it holds', () => {
        const [, list] = build([backend, frontend], 'frontend', ['frontend']);
        expect(list!.rows[0]).toMatchObject({ rowId: 'view:backend', expanded: false, expandable: true, count: 3, status: 'needs-you' });
        expect(list!.rows[0]).toMatchObject({ active: false });
        expect(list!.rows[1]).toMatchObject({ rowId: 'view:frontend', active: true, expanded: true });
    });

    test('an empty canvas has nothing to unfold', () => {
        const [list] = build([view('empty')], 'empty', ['empty']);
        expect(list!.rows[0]).toMatchObject({ expandable: false, expanded: false, count: 0, status: null });
    });

    test('a separator is a row with nothing behind it, and never the current one', () => {
        const [list] = build([separator('gap'), frontend], 'frontend', ['frontend']);
        expect(list!.rows[0]).toMatchObject({ rowId: 'view:gap', index: 0, active: false, expandable: false, count: 0, status: null, draft: false });
        expect(list!.rows[1]).toMatchObject({ rowId: 'view:frontend', index: 1, active: true });
    });

    test('every view row knows where it sits in the project list', () => {
        const [, list] = build([backend, separator('gap'), frontend], 'backend', ['backend']);
        const views = list!.rows.filter((row) => row.type === 'view');
        expect(views.map((row) => row.index)).toEqual([0, 1, 2]);
    });

    test('a view that is one node carries that node on its own row and never unfolds', () => {
        const [needs, list] = build([standalone('auth', 'needs-you'), frontend], 'frontend', ['frontend']);
        expect(needs!.rows[0]).toMatchObject({ rowId: 'needs:auth', viewName: 'auth' });
        expect(list!.rows[0]).toMatchObject({ rowId: 'view:auth', expandable: false, count: 0, status: 'needs-you', draft: true });
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
