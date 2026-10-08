import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { dismissClose, useUnsavedClose } from '@/shell/panels/unsaved-close';
import { cellViewIds } from '@/shell/split';
import { closeCellGuarded, closeCellsRightOfGuarded, closeOtherCellsGuarded } from './cell-close.ts';
import { useDocument } from './document.ts';
import { useFiles, type DatabaseTab } from './files.ts';
import { currentEndpointId, endpointKey } from './keys.ts';
import { textDrafts, useTextDrafts } from './text-drafts.ts';

const ORDERS: DatabaseTab = { key: 'database:orders', kind: 'table', pinned: false, connectionId: 'shop', schema: 'shop', table: 'orders' };
const saves = spyOn(textDrafts, 'save');

afterAll(() => {
    saves.mockRestore();
});

function canvas(id: string): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] };
}

function cells(): string[][] {
    return (useDocument.getState().layout?.columns ?? []).flatMap((column) => column.cells.map(cellViewIds));
}

function leaveUnsaved(...paths: string[]): void {
    useTextDrafts.setState({
        rows: Object.fromEntries(
            paths.map((path) => [endpointKey(currentEndpointId(), path), { disk: 'on disk', mtime: 1, text: 'edited', saving: false, problem: null }])
        )
    });
}

/* Lets the save a close waits on and the close after it run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
    }
}

describe('closing cells through the guards of their loose tabs', () => {
    beforeEach(() => {
        useFiles.setState({ projectId: null, tabs: [], focusRequest: null, recent: [], unsubmitted: {}, discarding: null });
        useTextDrafts.setState({ rows: {} });
        useUnsavedClose.setState({ pending: null });
        saves.mockReset();
        saves.mockResolvedValue(true);
        useDocument
            .getState()
            .load({ version: 3, rev: 1, name: 'p', color: '#000', views: [canvas('a'), canvas('b'), canvas('c')] }, { activeViewId: 'a', views: {} });
        // Cells: a, then a host with two files.
        useDocument.getState().splitFocused('right', 'b');
        useFiles.getState().open('/p/one.ts', 5);
        useFiles.getState().open('/p/two.ts', 5);
    });

    test('saves a file with unsaved changes first and then closes the cell', async () => {
        leaveUnsaved('/p/one.ts');
        expect(await closeCellGuarded({ column: 1, cell: 0 })).toBe(true);
        expect(saves).toHaveBeenCalledTimes(1);
        expect(cells()).toEqual([['a']]);
        expect(useFiles.getState().tabs).toEqual([]);
    });

    test('stops at a file that would not save when the person keeps it, leaving the cell with what is left', async () => {
        saves.mockResolvedValue(false);
        leaveUnsaved('/p/one.ts');
        const closing = closeCellGuarded({ column: 1, cell: 0 });
        await settle();
        expect(useUnsavedClose.getState().pending?.paths).toEqual(['/p/one.ts']);
        dismissClose();
        expect(await closing).toBe(false);
        expect(cells()).toEqual([['a'], ['/p/one.ts', '/p/two.ts']]);
    });

    test('does not touch the tabs after the one that was kept', async () => {
        saves.mockResolvedValue(false);
        leaveUnsaved('/p/one.ts');
        const closing = closeCellGuarded({ column: 1, cell: 0 });
        await settle();
        dismissClose();
        await closing;
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/p/one.ts', '/p/two.ts']);
    });

    test('closes the cell once the person lets a file that would not save go', async () => {
        saves.mockResolvedValue(false);
        leaveUnsaved('/p/one.ts');
        const closing = closeCellGuarded({ column: 1, cell: 0 });
        await settle();
        useUnsavedClose.getState().pending!.run();
        dismissClose();
        expect(await closing).toBe(true);
        expect(cells()).toEqual([['a']]);
    });

    test('asks before a table with edits nobody submitted goes, and keeps the cell on a no', async () => {
        useFiles.getState().show({ tabs: [...useFiles.getState().tabs, ORDERS], active: ORDERS.key }, 5);
        useFiles.getState().setUnsubmitted(ORDERS.key, true);
        const closing = closeCellGuarded({ column: 1, cell: 0 });
        await settle();
        expect(useFiles.getState().discarding).toBe(ORDERS.key);
        useFiles.getState().cancelDiscard();
        expect(await closing).toBe(false);
        expect(cells()).toEqual([['a'], [ORDERS.key]]);
    });

    test('closes the cell once the person confirms discarding the edits', async () => {
        useFiles.getState().show({ tabs: [...useFiles.getState().tabs, ORDERS], active: ORDERS.key }, 5);
        useFiles.getState().setUnsubmitted(ORDERS.key, true);
        const closing = closeCellGuarded({ column: 1, cell: 0 });
        await settle();
        useFiles.getState().confirmDiscard();
        expect(await closing).toBe(true);
        expect(cells()).toEqual([['a']]);
        expect(useFiles.getState().tabs).toEqual([]);
    });

    test('asks before a database view of the project with edits nobody submitted leaves its cell', async () => {
        const id = useDocument.getState().addDatabaseView('orders', { connectionId: 'shop', schema: 'shop', table: 'orders', mode: 'data' });
        useFiles.getState().setUnsubmitted(id, true);
        const closing = closeCellGuarded(useDocument.getState().layout!.focus);
        await settle();
        expect(useFiles.getState().discarding).toBe(id);
        useFiles.getState().cancelDiscard();
        expect(await closing).toBe(false);
        expect(useDocument.getState().layout!.columns.flatMap((column) => column.cells.flatMap(cellViewIds))).toContain(id);
    });

    test('closes the tab of such a view once the person confirms, and the view stays in the project', async () => {
        const id = useDocument.getState().addDatabaseView('orders', { connectionId: 'shop', schema: 'shop', table: 'orders', mode: 'data' });
        useFiles.getState().setUnsubmitted(id, true);
        useFiles.getState().close(id);
        expect(useFiles.getState().discarding).toBe(id);
        useFiles.getState().confirmDiscard();
        expect(useFiles.getState().unsubmitted[id]).toBeUndefined();
        expect(useDocument.getState().views.some((view) => view.id === id)).toBe(true);
        expect(cells().flat()).not.toContain(id);
    });

    test('a cell of a view of the project closes as it always did', async () => {
        expect(await closeCellGuarded({ column: 0, cell: 0 })).toBe(true);
        expect(cells()).toEqual([['/p/one.ts', '/p/two.ts']]);
    });

    test('closing the last host saves its files before leaving the empty screen', async () => {
        useDocument.getState().closeCellAt({ column: 0, cell: 0 });
        leaveUnsaved('/p/one.ts');
        expect(await closeCellGuarded({ column: 0, cell: 0 })).toBe(true);
        expect(saves).toHaveBeenCalledTimes(1);
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useDocument.getState().layout).toBeNull();
    });

    test('the last database tab stays when edits are kept and closes once discarded', async () => {
        useFiles.getState().show({ tabs: [...useFiles.getState().tabs, ORDERS], active: ORDERS.key }, 5);
        useDocument.getState().closeCellAt({ column: 0, cell: 0 });
        useFiles.getState().setUnsubmitted(ORDERS.key, true);
        const closing = closeCellGuarded({ column: 0, cell: 0 });
        await settle();
        useFiles.getState().cancelDiscard();
        expect(await closing).toBe(false);
        expect(cells()).toEqual([[ORDERS.key]]);
        const again = closeCellGuarded({ column: 0, cell: 0 });
        await settle();
        useFiles.getState().confirmDiscard();
        expect(await again).toBe(true);
        expect(useDocument.getState().layout).toBeNull();
    });

    test('a mixed last host closes completely after its file leaves a plain project view', async () => {
        useDocument.getState().closeCellAt({ column: 0, cell: 0 });
        useDocument.getState().showView('b');
        expect(await closeCellGuarded({ column: 0, cell: 0 })).toBe(true);
        expect(useDocument.getState().layout).toBeNull();
        expect(useDocument.getState().views.some((view) => view.id === 'b')).toBe(true);
    });

    test('closing the other cells goes through the guards of the loose tabs in them and keeps the cell it was asked from', async () => {
        saves.mockResolvedValue(false);
        leaveUnsaved('/p/two.ts');
        const closing = closeOtherCellsGuarded({ column: 0, cell: 0 });
        await settle();
        dismissClose();
        expect(await closing).toBe(false);
        expect(cells()).toHaveLength(2);
        const again = closeOtherCellsGuarded({ column: 0, cell: 0 });
        await settle();
        useUnsavedClose.getState().pending!.run();
        dismissClose();
        expect(await again).toBe(true);
        expect(cells()).toEqual([['a']]);
    });

    test('closing the cells to the right goes through the same guards', async () => {
        useFiles.getState().show({ tabs: [...useFiles.getState().tabs, ORDERS], active: ORDERS.key }, 5);
        useFiles.getState().setUnsubmitted(ORDERS.key, true);
        const closing = closeCellsRightOfGuarded({ column: 0, cell: 0 });
        await settle();
        useFiles.getState().cancelDiscard();
        expect(await closing).toBe(false);
        expect(cells()).toEqual([['a'], [ORDERS.key]]);
        const again = closeCellsRightOfGuarded({ column: 0, cell: 0 });
        await settle();
        useFiles.getState().confirmDiscard();
        expect(await again).toBe(true);
        expect(cells()).toEqual([['a']]);
    });
});
