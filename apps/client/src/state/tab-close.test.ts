import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ProjectCanvasView, ProjectSummary } from '@ruimte/contracts';
import { cellViewIds } from '@/layout/split';
import { useDocument } from './document.ts';
import { useFiles } from './files.ts';
import { endpointKey } from './keys.ts';
import { useProject } from './project.ts';
import { closeTabsAround, tabsToClose } from './tab-close.ts';
import { textDrafts, useTextDrafts } from './text-drafts.ts';
import { useViewPins } from './view-pins.ts';

describe('tabsToClose', () => {
    const none = (): boolean => false;

    test('the others are every tab but the one asked about', () => {
        expect(tabsToClose(['a', 'b', 'c'], 'b', 'others', none)).toEqual(['a', 'c']);
    });

    test('to the right are the tabs after it, and all is every tab', () => {
        expect(tabsToClose(['a', 'b', 'c'], 'a', 'right', none)).toEqual(['b', 'c']);
        expect(tabsToClose(['a', 'b', 'c'], 'c', 'right', none)).toEqual([]);
        expect(tabsToClose(['a', 'b', 'c'], 'b', 'all', none)).toEqual(['a', 'b', 'c']);
    });

    test('a pinned tab stays whichever way the tabs close', () => {
        const pinned = (id: string): boolean => id === 'c';
        expect(tabsToClose(['a', 'b', 'c'], 'a', 'others', pinned)).toEqual(['b']);
        expect(tabsToClose(['a', 'b', 'c'], 'a', 'right', pinned)).toEqual(['b']);
        expect(tabsToClose(['a', 'b', 'c'], 'a', 'all', pinned)).toEqual(['a', 'b']);
    });
});

function canvas(id: string): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] };
}

function tabsOfCells(): string[][] {
    return (useDocument.getState().layout?.columns ?? []).flatMap((column) => column.cells.map(cellViewIds));
}

const PROJECT: ProjectSummary = {
    projectId: 'p',
    name: 'p',
    color: '#000',
    folder: '/p',
    lastOpenedAt: 0,
    available: true,
    icon: { kind: 'initial', value: 'P' },
    nameSource: 'chosen'
};

const saves = spyOn(textDrafts, 'save');

afterAll(() => {
    saves.mockRestore();
    useProject.getState().setCurrent(null, 0, null);
    useViewPins.setState({ pins: {} });
});

describe('closing the tabs of a host', () => {
    beforeEach(() => {
        useFiles.setState({ projectId: null, tabs: [], focusRequest: null, recent: [], unsubmitted: {}, discarding: null });
        useTextDrafts.setState({ rows: {} });
        useViewPins.setState({ pins: {} });
        useProject.getState().setCurrent(PROJECT, 1, 'local');
        saves.mockReset();
        saves.mockResolvedValue(true);
        useDocument
            .getState()
            .load({ version: 3, rev: 1, name: 'p', color: '#000', views: [canvas('a'), canvas('b'), canvas('c')] }, { activeViewId: 'a', views: {} });
        useFiles.getState().open('/p/a.ts', 5);
        useDocument.getState().setActiveView('b');
        useFiles.getState().open('/p/b.ts', 5);
    });

    test('takes the views of the project along with the files, and leaves them in the project', async () => {
        expect(tabsOfCells()).toEqual([['/p/a.ts', 'b', '/p/b.ts']]);
        expect(await closeTabsAround('/p/b.ts', 'others')).toBe(true);
        expect(tabsOfCells()).toEqual([['/p/b.ts']]);
        expect(useDocument.getState().views.map((view) => view.id)).toEqual(['a', 'b', 'c']);
    });

    test('closes every tab and the host goes with the last one', async () => {
        expect(await closeTabsAround('b', 'all')).toBe(true);
        expect(useDocument.getState().layout).toBeNull();
        expect(useFiles.getState().tabs).toEqual([]);
    });

    test('leaves a pinned view of the project and a pinned file where they are', async () => {
        useViewPins.getState().setPinned(endpointKey('local', 'p'), 'b', true);
        useFiles.getState().setPinned('/p/b.ts', true);
        expect(await closeTabsAround('b', 'all')).toBe(true);
        expect(tabsOfCells()).toEqual([['b', '/p/b.ts']]);
    });

    test('to the right closes only what stands after the tab', async () => {
        useFiles.getState().open('/p/c.ts', 5);
        expect(tabsOfCells()).toEqual([['/p/a.ts', 'b', '/p/b.ts', '/p/c.ts']]);
        expect(await closeTabsAround('/p/b.ts', 'right')).toBe(true);
        expect(tabsOfCells()).toEqual([['/p/a.ts', 'b', '/p/b.ts']]);
    });
});
