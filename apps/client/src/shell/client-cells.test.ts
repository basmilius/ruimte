import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { clientCellView, DATABASES_VIEW_ID, FILES_VIEW_ID, isClientCell, isClientCellId, isDatabasesView, isFilesView } from './client-cells.ts';

const canvas: ProjectView = { kind: 'canvas', id: 'files-of-mine', name: 'files', nodes: [], texts: [], edges: [], layouts: [] };

describe('the cells of this client', () => {
    test('are known by their reserved ids, never by a view a project names alike', () => {
        expect(isClientCellId(FILES_VIEW_ID)).toBe(true);
        expect(isClientCellId(DATABASES_VIEW_ID)).toBe(true);
        expect(isClientCellId('files-of-mine')).toBe(false);
        expect(isClientCellId(null)).toBe(false);
        expect(isClientCell(canvas)).toBe(false);
        expect(isClientCell(null)).toBe(false);
    });

    test('tell the files from the databases', () => {
        const files = clientCellView(FILES_VIEW_ID, 'Files');
        const databases = clientCellView(DATABASES_VIEW_ID, 'Databases');
        expect(files).toEqual({ kind: 'files', id: 'files', name: 'Files' });
        expect([isFilesView(files), isDatabasesView(files), isClientCell(files)]).toEqual([true, false, true]);
        expect([isFilesView(databases), isDatabasesView(databases), isClientCell(databases)]).toEqual([false, true, true]);
    });
});
